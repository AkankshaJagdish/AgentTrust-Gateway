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

Agent enrollment returns a one-time secret and key ID. The server stores only SHA-256(secret). The HMAC-SHA256 key used for signing is that SHA-256 digest. Canonical payload:

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
The policy engine checks active agent, unexpired matching human consent, currency and consent cap, active policy, per-transaction cap, UTC-day total and approval threshold. A policy ALLOW creates a PayPal Orders v2 order with `intent: AUTHORIZE`. After buyer approval is confirmed against the live PayPal order, the gateway authorizes it and persists the authorization ID. A separate merchant capture approval rechecks agent, consent, policy, amount, currency, merchant and order associations before capture.

PayPal REST OAuth client ID/secret are server-side; mode defaults to SANDBOX. PayPal Identity/Log in with PayPal is not represented as verified: local Gateway accounts are not PayPal identity claims. A real OIDC flow requires merchant app configuration, scopes, redirect URI and verified tokens. Webhook verification and reconciliation plus explicit capture and void APIs are implemented; they require PayPal sandbox credentials and a registered webhook ID.

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


## PayPal sandbox payment operations (expanded implementation)

The payment flow is intentionally a two-stage money movement flow:

1. An active, signed agent request receives deterministic `ALLOW`.
2. The gateway creates an Orders v2 order with `intent: AUTHORIZE` and returns the PayPal approval URL.
3. The buyer approves on PayPal Checkout and is redirected to `/api/paypal/return`. The gateway retrieves the live order, checks PayPal reports `APPROVED`, revalidates agent + consent + original decision and checks order reference, custom agent ID, merchant payee, amount and currency before calling `POST /v2/checkout/orders/{id}/authorize`.
4. The authorization ID, amount, currency, status and payment state transition are stored.
5. A merchant logs into the dashboard and explicitly issues a 10-minute Capture Approval. The gateway verifies agent status, live consent, policy expiry/enabled state, amount, currency, merchant identity, order association and authorization association.
6. The merchant confirms capture using that approval. The gateway atomically claims the approval token, revalidates the preconditions, and calls `POST /v2/payments/authorizations/{authorization_id}/capture` with a stable `PayPal-Request-Id`.
7. An eligible uncaptured authorization can be voided through `POST /v2/payments/authorizations/{authorization_id}/void`.

Buyer checkout return and human capture approval are separate. A webhook never creates a human approval.

### PayPal webhook configuration

Register the HTTPS endpoint in the PayPal Developer Dashboard for the sandbox REST app:

```text
https://YOUR_PUBLIC_HOST/api/paypal/webhook
```

Select the order, authorization and capture events required for reconciliation. Store the webhook ID in `PAYPAL_WEBHOOK_ID`. The endpoint reads the original request body as text, passes it with PayPal transmission headers to `/v1/notifications/verify-webhook-signature`, and accepts only `verification_status: SUCCESS`. It stores the PayPal event ID with a unique constraint before processing so repeated deliveries are idempotent. Verified events update only reconciliation state; a webhook event is not proof of buyer or merchant consent.

The sandbox endpoint defaults to `https://api-m.sandbox.paypal.com`. Set `PAYPAL_ENVIRONMENT=LIVE` only in an intentionally separate production deployment; this project was requested for sandbox testing.

### Payment API

- `POST /api/agent/checkout` — signed agent checkout request; returns the PayPal approval URL only after policy ALLOW.
- `GET /api/paypal/return?token={ORDER_ID}` — buyer return; confirms PayPal approval and authorizes the order.
- `GET /api/paypal/cancel?token={ORDER_ID}` — records buyer cancellation.
- `POST /api/payments/capture-approval` — authenticated merchant approval request.
- `POST /api/payments/capture` — execute capture using a short-lived capture approval ID.
- `POST /api/payments/void` — void an uncaptured authorization.
- `POST /api/paypal/webhook` — verified webhook reconciliation.
- `GET /api/paypal/order/{id}` — retrieve a merchant-owned order with PayPal state.

All state-changing operations are server-side. PayPal idempotency request IDs and payment transition records are used for order creation, authorization, capture, and void.

### PayPal Agent Toolkit and APIMatic context

The package `@paypal/agent-toolkit` is included and configured narrowly for sandbox order lookup only. State-changing tools remain disabled: create/authorize/capture/refund decisions are routed through deterministic AgentTrust Gateway policies and explicit merchant consent. The [PayPal Agent Toolkit](https://github.com/paypal/agent-toolkit) documentation explains the toolkit's TypeScript and sandbox configuration. APIMatic PayPal Context Plugin install command for a supported developer shell:

```bash
npx context-plugins install paypal
```

Toolkit installation in the development environment and APIMatic context plugin installation are separate from runtime payment credentials.

### Payment tests

Run:

```bash
npm test
npm run lint
npm run typecheck
npx prisma generate
npx prisma db push
npm run build
```

Added Vitest coverage includes Orders v2 AUTHORIZE payload, inactive agent / non-ALLOW denial, raw-body webhook verification postback, duplicate event ID handling, invalid signature and stale transmission, plus exact decimal/currency/consent policy boundaries. Playwright smoke tests remain available for local application testing.

Sandbox end-to-end results must be recorded only after a sandbox REST app and webhook ID are configured and the actual buyer approval/merchant capture path has been executed. No sandbox credentials are committed.


## AI policy assistant

Merchants can describe agent security and spending rules in natural language in the dashboard. The OpenAI Responses API uses Structured Outputs generated from a Zod schema; AgentTrust validates the result with decimal arithmetic and the selected active human-consent cap.

The workflow is deliberately proposal-first:
1. Choose an active, unexpired consent and describe the rules.
2. Generate a structured JSON preview with any clarification requests.
3. Inspect the proposed limits and hard security invariants.
4. Explicitly confirm activation. The server atomically consumes the 30-minute draft, rechecks consent/currency/caps, creates the enabled policy and stores immutable version 1.
5. Edit an active policy from the dashboard. Every edit or enable/disable action creates a new immutable version; the history view shows prior snapshots.

Verified-agent requirements and expired-agent blocking are mandatory. They cannot be disabled by an AI-generated policy. The deterministic policy engine remains the only authority for ALLOW / BLOCK / REQUIRE_APPROVAL. “Above $30” means strictly greater than $30: $30.00 does not trigger the threshold; $30.01 does.

The AI risk assessment uses supplied transaction and stored gateway facts. It is advisory and displayed alongside the deterministic policy result. It cannot authorize or move money. The OpenAI client is never given PayPal tools.

### AI configuration

Set `OPENAI_API_KEY` in the deployment secret store. `OPENAI_MODEL` is optional and defaults to `gpt-5.6-mini`. Without an API key, all existing dashboard, manual policy, deterministic enforcement and PayPal features continue to work; only AI endpoints report that AI is not configured.

API routes:
- `POST /api/ai/policy/preview`
- `POST /api/ai/policy/activate` (merchant confirmation required)
- `POST /api/ai/risk/assess` (advisory only)
- `GET /api/policies/{id}` (including version history)
- `PATCH /api/policies/{id}` (merchant edit; creates a new version)

See [AI Policy Assistant documentation](docs/AI-POLICY-ASSISTANT.md) for examples and setup.

### Optional Codex development MCP

The project-scoped `.codex/config.toml` configures the PayPal sandbox Streamable HTTP MCP at `https://mcp.sandbox.paypal.com/http` and OpenAI Docs MCP at `https://developers.openai.com/mcp`. The PayPal MCP tool allow-list starts empty until its live tool names are inspected; enable only read-only lookup tools. Authenticate interactively with `codex mcp login paypal` and verify using `codex mcp list`. Cloud Codex does not inherit workstation credentials automatically.

In a supported Codex environment, APIMatic PayPal context plugin installation is:

```bash
npx context-plugins install paypal
```

MCP and APIMatic are optional development aids, not application runtime dependencies. A cloud Codex session must verify its own remote connections; this GitHub-only session cannot claim those connections were authenticated or that the APIMatic plugin was installed.

