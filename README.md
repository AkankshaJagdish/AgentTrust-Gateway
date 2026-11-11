# AgentTrust Gateway

Merchant-side infrastructure for verifying AI agents, enforcing human-linked spending policies, and giving merchants a live command center for agent traffic and PayPal payments.

## MVP capabilities
- Agent registration with one-time secret display, HMAC-SHA256 signed request verification, timestamp freshness (±5 minutes), one-use nonce protection, and HTTP 403 for unsigned or invalid requests.
- Merchant registration and login, bcrypt password hashes, HTTP-only session cookies stored by token hash.
- Consent creation/revocation, currency-specific cap and expiry.
- Deterministic ALLOW / BLOCK / REQUIRE_APPROVAL policy engine using decimal amounts, per-transaction and UTC-day caps, and plain-English reasons.
- PayPal Orders v2 server-side OAuth integration. Orders are created with AUTHORIZE intent only after a deterministic ALLOW result.
- AG Grid console for metrics, agents, request verification and outcomes, policies, orders, payment states and audit history. Includes sorting, filtering, quick search, pinned columns and pagination.
- AI is not permitted to authorize, capture, refund, or move funds.

## Quick start
Requires Node.js 20.9+ and npm. PayPal sandbox credentials are optional for the app/dashboard and required to call PayPal.

```bash
git clone https://github.com/AkankshaJagdish/AgentTrust-Gateway.git
cd AgentTrust-Gateway
npm install
cp .env.example .env
```

Configure `DATABASE_URL`, `SESSION_SECRET`, and for PayPal sandbox calls set `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`. Keep secrets out of source control.

```bash
npx prisma generate
npx prisma db push
npm run dev
```

Go to http://localhost:3000 and create a merchant account. The console reads persisted SQLite records; it does not show fictitious traffic.

## Agent signing contract

Agent enrollment returns a one-time secret and key ID. The server stores only SHA-256(secret). The HMAC-SHA256 key used for signing is SHA256(secret). Canonical payload:

```text
METHOD
PATH
TIMESTAMP
NONCE
SHA256(rawBody)
```

Headers: `X-Agent-Key-Id`, `X-Agent-Timestamp`, `X-Agent-Nonce`, `X-Agent-Signature`.

```ts
import { createHash, createHmac, randomBytes } from "node:crypto";
const body = JSON.stringify({ amount: "18.75", currency: "USD" });
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(16).toString("hex");
const canonical = ["POST","/api/agent/checkout",timestamp,nonce,createHash("sha256").update(body).digest("hex")].join("\\n");
const key = createHash("sha256").update(AGENT_SECRET).digest();
const signature = createHmac("sha256",key).update(canonical).digest("hex");
```

A request is accepted only inside a five-minute timestamp window; each nonce can be used once per agent.

## Policy and PayPal
The policy engine checks active agent, unexpired matching human consent, currency and consent cap, active policy, per-transaction cap, UTC-day total and approval threshold. A policy ALLOW creates a PayPal Orders v2 order with `intent: AUTHORIZE`. The PayPal return path authorizes; no automatic capture is performed. A future capture operation must rerun policy and consent checks and require explicit approval.

PayPal REST OAuth client ID/secret are server-side; mode defaults to SANDBOX. PayPal Identity/Log in with PayPal is not represented as verified: local Gateway accounts are not PayPal identity claims. A real OIDC flow requires merchant app configuration, scopes, redirect URI and verified tokens. Webhook signature verification, reconciliation and capture remain integrations requiring PayPal sandbox credentials and callback URL.

## PayPal tools and APIMatic
Official PayPal AI Toolkit supports Codex marketplace installation:

```bash
codex plugin marketplace add paypal/AI-Toolkit
codex plugin add paypal@paypal-ai-toolkit
```

PayPal MCP exposes order/payment, invoice, subscription, dispute, catalog, shipment and reporting tools. Keep the access token server-side and never bypass the gateway policy.

APIMatic's PayPal context plugin install for a supported coding environment:

```bash
npx context-plugins install paypal
```

A local npx install does not configure a hosted Codex session; use the official Codex plugin marketplace route when available.

## Validation

```bash
npm run lint
npm run typecheck
npm test
npx playwright test
npx prisma db push
npm run build
```

Vitest covers decimal, signature and policy boundary behavior. Playwright includes account registration/dashboard smoke coverage. These commands have not been executed in this GitHub-only session because no Node shell is exposed.

## External credentials and remaining integrations
- PayPal sandbox client ID and secret for live sandbox order create/authorize.
- PayPal Identity OIDC integration is not wired and no PayPal identity claims are fabricated.
- PayPal webhook ID plus public HTTPS endpoint for webhook registration, verification and reconciliation.
- OpenAI key is optional for future policy explanation only, never payment authorization.

## Upstream references
[PayPal AG Grid hackathon boilerplate](https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate), [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit), [PayPal AI Toolkit](https://github.com/paypal/AI-Toolkit), and [PayPal MCP Server](https://github.com/paypal/paypal-mcp-server).

## License
MIT. See [LICENSE](LICENSE).
