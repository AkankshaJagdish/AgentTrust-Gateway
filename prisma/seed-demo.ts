import { PrismaClient } from "@prisma/client";
import { randomBytes, createHash } from "node:crypto";

/**
 * Creates clearly synthetic gateway data for judge walkthroughs.
 * All sample PaymentOrder IDs are SIMULATED-* and no PayPal API is called.
 * Run against a disposable local database only: npm run db:seed:demo
 */
const prisma = new PrismaClient();

async function main() {
  const email = process.env.DEMO_MERCHANT_EMAIL ?? "judge-demo@example.test";
  const existing = await prisma.user.findUnique({ where: { email } });
  const user = existing ?? await prisma.user.create({
    data: {
      email,
      name: "AgentTrust Demo Merchant (SIMULATED)",
      passwordHash: "DEMO_ONLY_NO_LOGIN_PASSWORD",
    },
  });

  const names = ["Verified Shopping Agent", "Unverified Research Agent", "Expired Travel Agent"];
  const agents = [];
  for (let i = 0; i < names.length; i++) {
    const name = names[i];
    let agent = await prisma.agent.findFirst({ where: { userId: user.id, name } });
    if (!agent) agent = await prisma.agent.create({
      data: {
        userId: user.id,
        name,
        status: i === 2 ? "ACTIVE" : "ACTIVE",
        expiresAt: i === 2 ? new Date(Date.now() - 86_400_000) : null,
      },
    });
    agents.push(agent);
  }

  // The verified agent receives a synthetic credential marker. The plaintext key is
  // intentionally unavailable, so this fixture is not suitable for signed API calls.
  const verifiedCredential = await prisma.agentCredential.findFirst({
    where: { agentId: agents[0].id, keyId: "DEMO-VERIFIED-KEY" },
  });
  if (!verifiedCredential) await prisma.agentCredential.create({
    data: {
      agentId: agents[0].id,
      keyId: "DEMO-VERIFIED-KEY",
      secretHash: createHash("sha256").update(randomBytes(32)).digest("hex"),
      algorithm: "HMAC-SHA256",
      active: true,
    },
  });

  const consent = await prisma.consent.findFirst({
    where: { userId: user.id, agentId: agents[0].id, currency: "USD" },
  }) ?? await prisma.consent.create({
    data: {
      userId: user.id,
      agentId: agents[0].id,
      spendingCap: "250.00",
      currency: "USD",
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });
  const policy = await prisma.spendingPolicy.findFirst({
    where: { userId: user.id, consentId: consent.id, name: "Judge demo policy" },
  }) ?? await prisma.spendingPolicy.create({
    data: {
      userId: user.id,
      consentId: consent.id,
      name: "Judge demo policy",
      maxPerTx: "100.00",
      dailyCap: "200.00",
      requireApprovalAbove: "50.00",
      currency: "USD",
      enabled: true,
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    },
  });

  const scenarios = [
    { label: "allowed", amount: "20.00", decision: "ALLOW", reason: "SIMULATED: inside transaction and daily limits" },
    { label: "blocked", amount: "125.00", decision: "BLOCK", reason: "SIMULATED: exceeds per-transaction limit" },
    { label: "approval-required", amount: "75.00", decision: "REQUIRE_APPROVAL", reason: "SIMULATED: above human approval threshold" },
  ] as const;

  for (const item of scenarios) {
    const requestId = `SIMULATED-${item.label.toUpperCase()}`;
    const old = await prisma.agentRequest.findUnique({ where: { requestId } });
    if (!old) await prisma.agentRequest.create({
      data: {
        agentId: agents[0].id,
        consentId: consent.id,
        policyId: policy.id,
        requestId,
        nonce: `SIMULATED-NONCE-${item.label}`,
        timestamp: new Date(),
        signatureValid: true,
        status: "EVALUATED",
        amount: item.amount,
        currency: "USD",
        decision: item.decision,
        reason: item.reason,
        ipAddress: "127.0.0.1 (SIMULATED)",
      },
    });
  }

  // This record is a local fixture only. paypalOrderId is null and no remote call occurs.
  const allowedRequest = await prisma.agentRequest.findUnique({
    where: { requestId: "SIMULATED-ALLOWED" },
  });
  if (allowedRequest && !(await prisma.paymentOrder.findUnique({ where: { agentRequestId: allowedRequest.requestId } }))) {
    const order = await prisma.paymentOrder.create({
      data: {
        agentId: agents[0].id,
        agentRequestId: allowedRequest.requestId,
        merchantId: user.id,
        status: "CREATED",
        amount: "20.00",
        currency: "USD",
        approvalUrl: null,
      },
    });
    await prisma.paymentStateTransition.create({
      data: {
        paymentOrderId: order.id,
        toStatus: "CREATED",
        source: "DEMO_SEED",
        reason: "SIMULATED ONLY: not a PayPal sandbox order.",
      },
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: user.id,
      actorType: "DEMO_SEED",
      actorId: "local-seed-script",
      action: "DEMO_DATA_SEEDED",
      entityType: "DemoFixture",
      entityId: "SIMULATED",
      outcome: "CREATED",
      reason: "Synthetic fixture rows only; no PayPal sandbox transactions were created.",
    },
  });

  console.log(JSON.stringify({
    seeded: true,
    merchantEmail: email,
    labels: ["SIMULATED", "NOT REAL PAYPAL TRANSACTIONS"],
    agents: agents.map((agent, i) => ({ id: agent.id, name: names[i], fixtureType: i === 0 ? "verified-marker" : i === 1 ? "unverified" : "expired" })),
    requests: scenarios.map((x) => ({ id: `SIMULATED-${x.label.toUpperCase()}`, decision: x.decision })),
    warning: "Demo data is synthetic. The marker credential cannot authenticate API calls. No PayPal network request was made.",
  }, null, 2));
}

main().catch((error) => {
  console.error("Demo seed failed:", error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
