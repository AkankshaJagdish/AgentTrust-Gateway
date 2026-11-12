import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";

/**
 * Synthetic judge fixtures only. No PayPal endpoint is called and every sample
 * request/order is labelled SIMULATED. Run only against a disposable local DB.
 */
const prisma = new PrismaClient();
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

async function main() {
  const email = process.env.DEMO_MERCHANT_EMAIL ?? "judge-demo@example.test";
  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "AgentTrust Demo Merchant (SIMULATED)",
      passwordHash: "DEMO_ONLY_NO_LOGIN_PASSWORD",
    },
  });

  const verified = await prisma.agent.upsert({
    where: { id: "demo-agent-verified" },
    update: {},
    create: { id: "demo-agent-verified", userId: user.id, name: "SIMULATED Verified Shopping Agent" },
  });
  const unverified = await prisma.agent.upsert({
    where: { id: "demo-agent-unverified" },
    update: {},
    create: { id: "demo-agent-unverified", userId: user.id, name: "SIMULATED Unverified Research Agent" },
  });
  const expired = await prisma.agent.upsert({
    where: { id: "demo-agent-expired" },
    update: { expiresAt: new Date(Date.now() - 86_400_000) },
    create: {
      id: "demo-agent-expired",
      userId: user.id,
      name: "SIMULATED Expired Travel Agent",
      expiresAt: new Date(Date.now() - 86_400_000),
    },
  });

  const existingCredential = await prisma.agentCredential.findFirst({
    where: { agentId: verified.id, keyId: "DEMO-VERIFIED-KEY" },
  });
  let oneTimeDemoSecret: string | undefined;
  if (!existingCredential) {
    oneTimeDemoSecret = randomBytes(32).toString("base64url");
    await prisma.agentCredential.create({
      data: {
        agentId: verified.id,
        keyId: "DEMO-VERIFIED-KEY",
        secretHash: hash(oneTimeDemoSecret),
        algorithm: "HMAC-SHA256",
      },
    });
  }

  const consent = await prisma.consent.upsert({
    where: { id: "demo-consent" },
    update: {},
    create: {
      id: "demo-consent",
      userId: user.id,
      agentId: verified.id,
      spendingCap: "250.00",
      currency: "USD",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  const policy = await prisma.spendingPolicy.upsert({
    where: { id: "demo-policy" },
    update: {},
    create: {
      id: "demo-policy",
      userId: user.id,
      consentId: consent.id,
      name: "SIMULATED Judge Demo Policy",
      maxPerTx: "100.00",
      dailyCap: "200.00",
      requireApprovalAbove: "50.00",
      currency: "USD",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  const scenarios = [
    ["SIMULATED-ALLOWED", "20.00", "ALLOW", "Inside per-transaction and daily caps"],
    ["SIMULATED-BLOCKED", "125.00", "BLOCK", "Exceeds per-transaction cap"],
    ["SIMULATED-APPROVAL-REQUIRED", "75.00", "REQUIRE_APPROVAL", "Above human approval threshold"],
  ] as const;

  for (const [requestId, amount, decision, reason] of scenarios) {
    await prisma.agentRequest.upsert({
      where: { requestId },
      update: {},
      create: {
        agentId: verified.id,
        consentId: consent.id,
        policyId: policy.id,
        requestId,
        nonce: `SIMULATED-NONCE-${requestId}`,
        timestamp: new Date(),
        // This is a fixture flag for dashboard display, not evidence of a real signed call.
        signatureValid: true,
        status: "EVALUATED",
        amount,
        currency: "USD",
        decision,
        reason: `SIMULATED: ${reason}`,
        ipAddress: "127.0.0.1 (SIMULATED)",
      },
    });
  }

  const request = await prisma.agentRequest.findUnique({ where: { requestId: "SIMULATED-ALLOWED" } });
  if (request) {
    await prisma.paymentOrder.upsert({
      where: { agentRequestId: request.requestId },
      update: {},
      create: {
        id: "demo-payment-simulated",
        agentId: verified.id,
        agentRequestId: request.requestId,
        merchantId: user.id,
        status: "CREATED",
        amount: "20.00",
        currency: "USD",
        approvalUrl: null,
      },
    });
    const demoOrder = await prisma.paymentOrder.findUnique({ where: { id: "demo-payment-simulated" } });
    if (demoOrder) {
      await prisma.paymentStateTransition.upsert({
        where: { id: "demo-payment-transition" },
        update: {},
        create: {
          id: "demo-payment-transition",
          paymentOrderId: demoOrder.id,
          toStatus: "CREATED",
          source: "DEMO_SEED",
          reason: "SIMULATED ONLY. paypalOrderId is null; no PayPal transaction exists.",
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      actorType: "DEMO_SEED",
      actorId: "seed-demo",
      action: "SIMULATED_DEMO_FIXTURES_CREATED",
      entityType: "DemoFixture",
      entityId: "SIMULATED",
      outcome: "CREATED",
      reason: "Synthetic records only. No sandbox PayPal orders, approvals, authorizations, captures, or voids.",
    },
  });

  console.log(JSON.stringify({
    simulated: true,
    merchantEmail: email,
    agents: [
      { id: verified.id, type: "verified-demo-credential" },
      { id: unverified.id, type: "unverified-no-credential" },
      { id: expired.id, type: "expired" },
    ],
    requests: scenarios.map(([requestId, amount, decision]) => ({ requestId, amount, decision })),
    payment: { id: "demo-payment-simulated", paypalOrderId: null, status: "CREATED", simulated: true },
    oneTimeDemoSecret: oneTimeDemoSecret ?? "Credential already exists; not displayed again.",
    warning: "Synthetic gateway fixtures only. Not genuine PayPal sandbox transactions. The demo secret is shown only at initial seed creation.",
  }, null, 2));
}

main().catch((error) => {
  console.error("Demo seed failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
