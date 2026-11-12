#!/usr/bin/env node
import { createHash, createHmac, randomBytes } from "node:crypto";

const baseUrl = process.env.AGENTTRUST_BASE_URL?.replace(/\/$/, "");
const keyId = process.env.AGENT_KEY_ID;
const secret = process.env.AGENT_SECRET;
const currency = process.env.DEMO_CURRENCY || "USD";
const blockedAmount = process.env.DEMO_BLOCKED_AMOUNT || "300.00";
const allowedAmount = process.env.DEMO_ALLOWED_AMOUNT || "25.00";
const endpoint = "/api/agent/checkout";

if (!baseUrl || !keyId || !secret) {
  console.error("Set AGENTTRUST_BASE_URL, AGENT_KEY_ID, and AGENT_SECRET. Never commit these values.");
  process.exit(2);
}

function signedHeaders(body) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(16).toString("hex");
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = ["POST", endpoint, timestamp, nonce, bodyHash].join("\n");
  const hmacKey = createHash("sha256").update(secret).digest();
  const signature = createHmac("sha256", hmacKey).update(canonical).digest("hex");
  return {
    "content-type": "application/json",
    "x-agent-key-id": keyId,
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": signature,
  };
}

async function call(label, amount, signed, expectedStatus) {
  const body = JSON.stringify({ amount, currency });
  const response = await fetch(`${baseUrl}${endpoint}`, {
    method: "POST",
    headers: signed ? signedHeaders(body) : { "content-type": "application/json" },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  console.log(JSON.stringify({
    scenario: label,
    signed,
    httpStatus: response.status,
    expectedStatus,
    result: payload,
  }, null, 2));
  if (response.status !== expectedStatus) {
    throw new Error(`${label}: expected HTTP ${expectedStatus}, received ${response.status}`);
  }
  return payload;
}

try {
  await call("A_UNSIGNED_REQUEST_REJECTED", allowedAmount, false, 403);
  await call("B_VERIFIED_REQUEST_ABOVE_CONSENT_CAP_BLOCKED", blockedAmount, true, 403);
  const allowed = await call("C_VERIFIED_ALLOWED_REQUEST_CREATES_PAYPAL_ORDER", allowedAmount, true, 201);
  if (!allowed.orderId || !allowed.approvalUrl) {
    throw new Error("Scenario C did not return a PayPal order ID and buyer approval URL.");
  }
  console.log("\nScenario C is ready. Open the returned approvalUrl, approve with a PayPal sandbox buyer, then follow Scenario D in docs/HACKATHON-SUBMISSION.md.");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
