import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export type AgentSignatureHeaders = {
  keyId?: string | null; timestamp?: string | null; nonce?: string | null; signature?: string | null;
};
export type VerifiedAgent = { ok: true; agentId: string; requestId: string } | { ok: false; status: 403; reason: string; requestId: string };
const WINDOW_MS = 5 * 60 * 1000;
const signaturePayload = (method: string, path: string, timestamp: string, nonce: string, body: string) =>
  [method.toUpperCase(), path, timestamp, nonce, createHash("sha256").update(body).digest("hex")].join("\n");
export function signAgentRequest(secret: string, method: string, path: string, timestamp: string, nonce: string, body: string) {
  return createHmac("sha256", secret).update(signaturePayload(method, path, timestamp, nonce, body)).digest("hex");
}
export function verifySignature(secret: string, expected: string, supplied: string) {
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const a = Buffer.from(expected, "hex"); const b = Buffer.from(supplied, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
export async function verifyAgentRequest(headers: AgentSignatureHeaders, method: string, path: string, body: string): Promise<VerifiedAgent> {
  const requestId = crypto.randomUUID();
  const fail = async (reason: string): Promise<VerifiedAgent> => {
    await prisma.agentRequest.create({ data: { requestId, status: "REJECTED", reason, signatureValid: false } }).catch(() => undefined);
    await audit({ actorType: "AGENT", action: "AGENT_REQUEST_REJECTED", entityType: "AgentRequest", entityId: requestId, outcome: "BLOCKED", reason });
    return { ok: false, status: 403, reason, requestId };
  };
  const { keyId, timestamp, nonce, signature } = headers;
  if (!keyId || !timestamp || !nonce || !signature) return fail("Missing agent signature headers.");
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(nonce)) return fail("Nonce format is invalid.");
  const time = Number(timestamp);
  if (!Number.isSafeInteger(time)) return fail("Timestamp is invalid.");
  const millis = time < 1e12 ? time * 1000 : time;
  if (Math.abs(Date.now() - millis) > WINDOW_MS) return fail("Request timestamp is outside the five-minute acceptance window.");
  const credential = await prisma.agentCredential.findUnique({ where: { keyId }, include: { agent: true } });
  if (!credential || !credential.active || credential.revokedAt || credential.agent.status !== "ACTIVE") return fail("Agent credential is unknown, revoked, or inactive.");
  // MVP uses a high-entropy shared secret provisioned once at enrollment; only its hash is stored.
  const configuredSecret = process.env.AGENT_SIGNING_SECRET;
  if (!configuredSecret) return fail("Gateway signing verifier is not configured.");
  const expected = signAgentRequest(configuredSecret + ":" + keyId, method, path, timestamp, nonce, body);
  if (!verifySignature(configuredSecret + ":" + keyId, expected, signature)) return fail("Agent signature is invalid.");
  try {
    await prisma.usedNonce.create({ data: { agentId: credential.agentId, nonce, expiresAt: new Date(millis + WINDOW_MS) } });
  } catch {
    return fail("Replay detected: this nonce has already been used.");
  }
  await prisma.agentRequest.create({ data: { requestId, agentId: credential.agentId, nonce, timestamp: new Date(millis), signatureValid: true, status: "VERIFIED" } });
  await audit({ actorType: "AGENT", actorId: credential.agentId, action: "AGENT_REQUEST_VERIFIED", entityType: "AgentRequest", entityId: requestId, outcome: "VERIFIED" });
  return { ok: true, agentId: credential.agentId, requestId };
}
