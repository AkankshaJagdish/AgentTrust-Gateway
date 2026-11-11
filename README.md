# AgentTrust Gateway

**Merchant-side trust infrastructure for agentic commerce.** AgentTrust Gateway provides an identity verification boundary, human-linked spending consent, deterministic spending policies, and a live merchant command center for AI-agent traffic and PayPal payments.

The product remains the AgentTrust Gateway concept. It is not a buyer storefront or a generic chatbot.

## Implemented

- Agent registration with a one-time 256-bit secret, HMAC-SHA256 request signing and verification, five-minute timestamp validation, nonce/replay protection, and HTTP 403 rejection for unsigned, invalid, stale, replayed, revoked or inactive agents.
- Merchant accounts with bcrypt password hashes and database-backed HTTP-only cookie sessions.
- Human consent creation/revocation with spending cap, currency, and expiration.
- Deterministic `ALLOW`, `BLOCK`, and `REQUIRE_APPROVAL` policy outcomes with decimal arithmetic, plain-English reasons, transaction/daily caps, and audit history.
- PayPal Orders v2 REST integration with server-side OAuth and `intent: AUTHORIZE`; only an allowed request creates an order.
- AG Grid merchant command center with metrics, agent traffic, verification/policy outcomes, agents, consents, policies, orders, payment states, and audit history. Grids support sorting, filtering, quick search, pinned columns, pagination, and status formatting.
- No LLM can authorize, capture, refund, or move money.

## Requirements

Node.js 20.9+, npm, and a PayPal Developer sandbox REST app for live PayPal sandbox calls. An OpenAI API key is not required for the deterministic MVP.

## Quick start

```bash
git clone https://github.com/AkankshaJagdish/AgentTrust-Gateway.git
cd AgentTrust-Gateway
npm install
cp .env.example .env
```

Set `SESSION_SECRET` to a random 32+ byte value. For PayPal operations set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` from a sandbox REST app. Never expose the PayPal secret in browser code.

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Open http://localhost:3000 and create a merchant account. The dashboard reads the SQLite database; empty database tables are shown as empty states rather than fabricated traffic.

## Environment variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | SQLite connection, default `file:./dev.db` |
| `SESSION_SECRET` | Deployment secret; sessions use separate random tokens stored as hashes |
| `AGENT_SIGNING_SECRET` | Reserved for deployment-level signing integrations |
| `PAYPAL_ENVIRONMENT` | `SANDBOX` by default; `LIVE` only after deliberate production setup |
| `PAYPAL_CLIENT_ID` | PayPal app client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal app secret, server-only |
| `PAYPAL_WEBHOOK_ID` | Reserved for PayPal webhook signature verification |
| `OPENAI_API_KEY` | Optional future policy explanations only |
| `OPENAI_MODEL` | Optional model identifier |
| `APP_URL` | Public origin used in PayPal return/cancel URLs |

Never commit `.env`, `.env.local`, real credentials, tokens, signing secrets, private keys, or SQLite database files.

## Agent request signing

The agent registration API returns a key ID and one-time random secret. The secret is returned once, while only its SHA-256 hash is stored. The HMAC key used by this MVP is SHA-256(secret).

Canonical UTF-8 request payload:

```text
METHOD
PATH
TIMESTAMP
NONCE
SHA256(rawBody)
```

Required headers:

- `X-Agent-Key-Id`
- `X-Agent-Timestamp` (Unix seconds or milliseconds)
- `X-Agent-Nonce` (unique random value)
- `X-Agent-Signature` (hex HMAC-SHA256)

Example:

```ts
import { createHash, createHmac, randomBytes } from "node:crypto";

const body = JSON.stringify({ amount: "18.75", currency: "USD" });
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(16).toString("hex");
const canonical = [
  "POST", "/api/agent/checkout", timestamp, nonce,
  createHash("sha256").update(body).digest("hex"),
].join("\\n");

const hmacKey = createHash("sha256").update(AGENT_SECRET).digest();
const signature = createHmac("sha256", hmacKey).update(canonical).digest("hex");

const response = await fetch("http://localhost:3000/api/agent/checkout", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-agent-key-id": AGENT_KEY_ID,
    "x-agent-timestamp": timestamp,
    "x-agent-nonce": nonce,
    "x-agent-signature": signature,
  },
  body,
});
```

The gateway checks ±5 minute timestamp skew, validates the signature with a constant-time comparison, and consumes a nonce through a unique `(agentId, nonce)` database constraint before evaluation. Replayed requests return HTTP 403.

## Policy rules

A valid signature alone never authorizes payment. The deterministic policy engine checks:

1. Agent exists and is active.
2. Matching human consent is active, unexpired, and for the requested currency.
3. Amount is within the consent spending cap.
4. An enabled, unexpired policy exists; no matching policy means approval is required.
5. Per-transaction and UTC-day aggregate caps are respected.
6. Configured approval thresholds produce `REQUIRE_APPROVAL`.

Every request stores the verification status, policy result, and plain-English reason. The AI model is not part of the payment authorization chain.

## PayPal Orders v2

PayPal API mode defaults to sandbox. The server requests a client-credentials OAuth token and caches it with early refresh. Only a policy `ALLOW` creates an Orders v2 order with `intent: AUTHORIZE`. The approval URL is persisted.

The return handler authorizes the order but does not capture funds. Capture must be a separate explicit operation, preceded by fresh consent/policy evaluation and human/merchant approval. PayPal webhook registration, signature verification, reconciliation and the dedicated capture operation remain follow-on integration work.

## PayPal Toolkit, MCP and APIMatic

The official [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit) documents OpenAI Codex plugin installation. In a Codex-enabled environment:

```bash
codex plugin marketplace add paypal/AI-Toolkit
codex plugin add paypal@paypal-ai-toolkit
```

The PayPal MCP package documents order/payment tools such as `create_order`, `get_order`, `pay_order`, and `create_refund`, as well as invoices, subscriptions, disputes, catalog, shipment, and reporting. Keep MCP credentials server-side. MCP use does not replace deterministic gateway policy checks.

APIMatic PayPal Context Plugin can be installed in supported local coding environments with:

```bash
npx context-plugins install paypal
```

For hosted/cloud Codex, use the official Codex marketplace/plugin route when available in that environment. A local npx installation does not configure a cloud Codex session.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npx playwright test
npx prisma db push
npm run build
```

Vitest includes decimal, HMAC/tamper and policy boundary tests. Playwright includes a merchant registration/dashboard smoke test. These commands have not been run in this GitHub-only session because no Node.js shell/runner is available here.

## External integrations requiring credentials

- PayPal sandbox client ID and secret for actual sandbox order creation and authorization.
- PayPal Identity / Log in with PayPal is not claimed as verified. Gateway-local accounts and consent rows are not PayPal identity claims. A genuine OIDC flow requires PayPal app configuration, redirect URIs, approved scopes, and token/ID-token validation.
- PayPal webhook ID and public HTTPS URL for webhook registration, verification and reconciliation.
- OpenAI key only if optional policy explanation is added; AI must not authorize payment.

## Reference implementations

The AG Grid application layout is informed by the [PayPal hackathon AG Grid boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate). PayPal integration references include [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit), [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit), and [PayPal MCP Server](https://github.com/paypal/paypal-mcp-server). Check upstream licenses before copying source.

## License

MIT. See [LICENSE](LICENSE).
