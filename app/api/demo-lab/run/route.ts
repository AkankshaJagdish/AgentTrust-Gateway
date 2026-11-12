import { NextResponse } from "next/server";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { signAgentRequest } from "@/lib/agent-signatures";
import { POST as productionCheckout } from "@/app/api/agent/checkout/route";
import { isAgentExpired } from "@/lib/agent-expiry";
import { demoEligibility } from "@/lib/demo-lab-eligibility";

// Demo Lab calls the real checkout handler, including signature verification,
// nonce replay checks, policy evaluation, audit logging and PayPal Orders v2.
const inputSchema = z.object({
  agentId: z.string().min(1),
  scenario: z.enum(["A", "B", "C"]),
  consentId: z.string().nullable().optional(),
  policyId: z.string().nullable().optional(),
});
const path = "/api/agent/checkout";
const limitPerDay = 20;
const intervalMs = 30_000;

export async function POST(request: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (process.env.PAYPAL_ENVIRONMENT !== "SANDBOX") {
    return NextResponse.json({ error: "Demo Lab is restricted to PayPal SANDBOX." }, { status: 403 });
  }
  let input: z.infer<typeof inputSchema>;
  try { input = inputSchema.parse(await request.json()); }
  catch { return NextResponse.json({ error: "Invalid Demo Lab request." }, { status: 400 }); }

  const agent = await prisma.agent.findFirst({ where: { id: input.agentId, userId: user.id, status: "ACTIVE" } });
  if (!agent || isAgentExpired(agent.expiresAt)) {
    return NextResponse.json({ error: "Select an active agent belonging to your merchant account." }, { status: 403 });
  }

  // Match the deterministic policy engine's newest-consent and newest-policy selection.
  // Scenario A needs only an active merchant-owned agent and sandbox restrictions.
  const consents = input.scenario === "A" ? [] : await prisma.consent.findMany({
    where:{agentId:agent.id,userId:user.id,status:"ACTIVE",currency:"USD",expiresAt:{gt:new Date()}},
    orderBy:{createdAt:"desc"}
  });
  const policies = input.scenario === "A" ? [] : await prisma.spendingPolicy.findMany({
    where:{userId:user.id,consent:{agentId:agent.id},enabled:true,currency:"USD"},
    orderBy:{createdAt:"desc"}
  });
  const eligibility = demoEligibility(agent,consents,policies,input.scenario);
  if(!eligibility.ready)return NextResponse.json({error:eligibility.missing.join(" "),missingRequirements:eligibility.missing},{status:409});
  if(input.scenario!=="A"&&(input.consentId!==eligibility.consentId||input.policyId!==eligibility.policyId)){
    return NextResponse.json({error:"Demo setup changed. Refresh the dashboard and retry."},{status:409});
  }

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const count = await prisma.usedNonce.count({
    where: { agentId: agent.id, nonce: { startsWith: "demo-lab:" }, createdAt: { gte: since } },
  });
  if (count >= limitPerDay) return NextResponse.json({ error: "Daily Demo Lab limit reached (20 runs per agent)." }, { status: 429 });
  const bucket = Math.floor(Date.now() / intervalMs);
  try {
    await prisma.usedNonce.create({
      data: { agentId: agent.id, nonce: `demo-lab:${input.scenario}:${bucket}`, expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
    });
  } catch {
    return NextResponse.json({ error: "Wait 30 seconds before rerunning this scenario." }, { status: 429 });
  }

  const amount = input.scenario === "B" ? "75.00" : "25.00";
  const body = JSON.stringify({ amount, currency: "USD" });
  const headers = new Headers({ "content-type": "application/json" });
  let credentialId: string | undefined;
  try {
    if (input.scenario !== "A") {
      // One-time signing credential. Only the SHA-256 digest is persisted,
      // matching the existing verifier; the plaintext never reaches the client.
      const secret = randomBytes(32).toString("base64url");
      const keyId = `atg_demo_${randomBytes(12).toString("hex")}`;
      const credential = await prisma.agentCredential.create({
        data: { agentId: agent.id, keyId, secretHash: (await import("node:crypto")).createHash("sha256").update(secret).digest("hex") },
      });
      credentialId = credential.id;
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = randomUUID();
      headers.set("x-agent-key-id", keyId);
      headers.set("x-agent-timestamp", timestamp);
      headers.set("x-agent-nonce", nonce);
      headers.set("x-agent-signature", signAgentRequest(secret, "POST", path, timestamp, nonce, body));
    }
    // Internal invocation avoids external loopback and still exercises the
    // actual production route with its complete verification/security checks.
    const url = new URL(path, process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || request.url);
    const response = await productionCheckout(new Request(url, { method: "POST", headers, body }));
    const payload = await response.json() as {
      decision?: string; reason?: string; requestId?: string;
      orderId?: string; approvalUrl?: string; status?: string; error?: string;
    };
    const auditRecords = payload.requestId
      ? await prisma.auditLog.findMany({
          where: { entityType: "AgentRequest", entityId: payload.requestId },
          select: { id: true, action: true, outcome: true, reason: true, createdAt: true },
          orderBy: { createdAt: "asc" },
        })
      : [];
    const order = payload.orderId
      ? await prisma.paymentOrder.findFirst({ where: { paypalOrderId: payload.orderId, merchantId: user.id }, select: { id: true, status: true } })
      : null;
    return NextResponse.json({
      scenario: input.scenario, httpStatus: response.status,
      decision: payload.decision ?? (response.status === 403 ? "BLOCK" : null),
      reason: payload.reason ?? payload.error ?? null, requestId: payload.requestId ?? null,
      auditRecords, orderId: order ? payload.orderId : null,
      approvalUrl: order ? payload.approvalUrl : null,
      orderStatus: order?.status ?? null,
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Demo execution failed." }, { status: 500 });
  } finally {
    if (credentialId) {
      await prisma.agentCredential.update({
        where: { id: credentialId },
        data: { active: false, revokedAt: new Date() },
      });
    }
  }
}
