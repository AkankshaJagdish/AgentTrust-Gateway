# PayPal AI Hackathon submission pack

## Project title

**AgentTrust Gateway — Trust and Spending Controls for AI-Agent Commerce**

## Short description

AgentTrust Gateway is merchant-side infrastructure that verifies AI-agent requests,
enforces human-linked spending limits, and routes approved purchases through PayPal
sandbox checkout with explicit merchant capture approval and an auditable payment
history.

## Full Devpost description

### The problem

As AI agents begin discovering products and initiating purchases, merchants need a
reliable way to distinguish an authorized agent acting within a human's intent from
an unsigned, replayed, expired, or over-budget request. A generic chatbot checkout
does not provide the identity, spending controls, or operational audit trail needed
to trust agentic commerce.

### The solution

AgentTrust Gateway sits between an AI agent and a merchant's PayPal checkout. Each
agent is registered with a one-time credential and signs checkout requests using
HMAC-SHA256. The gateway verifies the signature, timestamp, nonce, agent status,
human consent, currency, transaction cap, daily cap, and policy expiry before a
payment order can be created.

Merchants manage agents, consent, policies, requests, payment state, and audit
history in an AG Grid command center. They can write spending rules in natural
language; the OpenAI Responses API converts those rules into a structured policy
proposal. The server validates the proposal against the selected consent and
requires the merchant to confirm activation. AI risk assessments are advisory.
The deterministic policy engine remains authoritative.

When a request is allowed, the server creates a PayPal Orders v2 order using
AUTHORIZE intent. The buyer completes PayPal sandbox approval. AgentTrust verifies
PayPal's live order status and associations before authorizing. A separate,
short-lived merchant capture approval is required before the gateway captures the
authorization. The merchant can instead void an eligible uncaptured authorization.
Verified PayPal webhooks reconcile payment state and are recorded idempotently.

### Why it matters

AgentTrust addresses the merchant-side trust gap in agentic commerce: a business
needs to know which agent is acting, which human consent applies, what the agent is
allowed to spend, and whether a payment has actually been approved and captured.
It provides a practical control layer without delegating money movement to an LLM.

### What is distinctive

- Cryptographic agent identity and replay protection.
- Human-linked consent with currency-specific spending caps and expiry.
- Deterministic ALLOW, BLOCK, and REQUIRE_APPROVAL decisions.
- Natural-language policy authoring with structured, validated previews.
- Explicit human confirmation before policy activation.
- PayPal Orders v2 AUTHORIZE, buyer approval, separate merchant capture approval,
  capture and void.
- Verified webhook reconciliation and immutable payment/audit history.
- An operational AG Grid dashboard that exposes agent and payment state.

### AI usage

The application uses the OpenAI JavaScript SDK and Responses API with Structured
Outputs generated from a Zod schema. A merchant describes a policy in natural
language; the model returns a typed proposal. Server-side validation checks
currency, consent cap, transaction/daily limits, approval threshold, and mandatory
agent-security invariants. The merchant sees the preview and must explicitly
activate it. A second AI capability produces an advisory risk assessment from
supplied gateway facts. Neither capability can call PayPal tools or make payment
decisions. All payment decisions and money-moving operations remain deterministic
server-side code.

### PayPal integration

The server authenticates to PayPal REST using sandbox OAuth credentials and creates
Orders v2 orders with AUTHORIZE intent only after a signed request receives a
deterministic ALLOW. The buyer is redirected to PayPal sandbox checkout. On return,
the gateway retrieves the order from PayPal, confirms APPROVED status and verifies
the order/agent/amount/currency/payee associations before authorization. A merchant
then explicitly creates a short-lived capture approval and confirms capture.
Uncaptured authorizations can be voided. Webhook signatures are verified through
PayPal's verification API before reconciliation. The dashboard records PayPal
order, authorization, and capture identifiers.

### Technology

- Next.js App Router, React, TypeScript
- Prisma ORM and SQLite (Render persistent disk deployment profile)
- AG Grid Community for the merchant command center
- PayPal REST OAuth and Orders v2
- PayPal webhooks and signature verification
- OpenAI Responses API, Structured Outputs, Zod (default model: GPT-6 Luna)
- Vitest and Playwright

## Setup instructions

The public source repository is:
https://github.com/AkankshaJagdish/AgentTrust-Gateway

For local setup:

```bash
git clone https://github.com/AkankshaJagdish/AgentTrust-Gateway.git
cd AgentTrust-Gateway
npm install
cp .env.example .env
```

Set at least `DATABASE_URL=file:./dev.db` and a random `SESSION_SECRET`.
For live sandbox checkout, also set `PAYPAL_ENVIRONMENT=SANDBOX`,
`PAYPAL_CLIENT_ID`, and `PAYPAL_CLIENT_SECRET`. For AI policy previews set
`OPENAI_API_KEY`.

```bash
npx prisma generate
npm run db:push
npm run dev
```

Open http://localhost:3000 and register a merchant account. Detailed Render setup,
environment variables, public PayPal redirect URLs, webhook registration, and
deployment verification are in [RENDER-DEPLOYMENT.md](RENDER-DEPLOYMENT.md).

## Judge testing instructions

### Prepare the merchant

1. Register a merchant account and log in.
2. Register a new agent from the dashboard. Copy its one-time key ID and secret.
3. Create an active USD human consent with a spending cap of **$50.00** and a
   future expiry.
4. Create an enabled policy whose per-transaction limit is **$50.00**, daily cap
   is at least **$100.00**, and approval threshold is below the allowed test
   amount (or leave the threshold unset).
5. Set the environment variables below in the terminal. Do not put secrets in Git.

```bash
export AGENTTRUST_BASE_URL="https://<your-render-host>"
export AGENT_KEY_ID="<one-time-agent-key-id>"
export AGENT_SECRET="<one-time-agent-secret>"
export DEMO_BLOCKED_AMOUNT="75.00"
export DEMO_ALLOWED_AMOUNT="25.00"
export DEMO_CURRENCY="USD"
npm run demo:scenarios
```

The script sends the first three scenarios and asserts their expected HTTP status.
It uses the actual checkout endpoint and cryptographic signing for the signed
requests. Scenario C returns a real PayPal sandbox order ID and approval URL only
when valid sandbox credentials are configured.

### Scenario A — unsigned agent

The script posts an unsigned checkout request. Expected result: **HTTP 403** with
a missing-signature rejection. No PayPal order should be created.

### Scenario B — verified agent above human consent cap

The script signs a $75.00 request while the human consent cap is $50.00. Expected
result: **HTTP 403 / BLOCK** with a consent-cap reason. No PayPal order should be
created.

### Scenario C — verified allowed request

The script signs a $25.00 request within consent and policy limits. Expected
result: **HTTP 201**, decision ALLOW, a PayPal sandbox order ID, and a buyer approval
URL. Open the approval URL and sign in using a PayPal sandbox personal/buyer
account. Approve the payment. PayPal redirects to
`/api/paypal/return`; the gateway verifies the live order and stores the
authorization ID.

### Scenario D — explicit merchant capture approval

After buyer approval, return to the AgentTrust dashboard. In **PayPal
authorization & capture**, confirm the PayPal order and authorization IDs. Click
**Approve capture as merchant**, then **Confirm capture**. This is a separate
human approval from buyer checkout approval. The dashboard refreshes and shows the
captured state, PayPal capture ID, payment transitions, and audit history. Do not
describe a buyer approval or webhook as the merchant's capture approval.

### Simulated seed data

For dashboard exploration only, a disposable local database can be populated with:

```bash
npm run db:seed:demo
```

Seeded requests and the seeded payment row are synthetic. The seeded payment has
no PayPal order ID and is not a genuine sandbox transaction. Use the live scenario
runner above for genuine PayPal transaction identifiers.

## Demo script (target duration: 2 minutes 45 seconds)

**0:00–0:20 — Problem and product**
"AI agents can initiate purchases, but merchants need to verify who is acting and
what the human actually authorized. AgentTrust Gateway is a merchant-side trust
and spending-control layer for PayPal agentic commerce."

**0:20–0:45 — Dashboard and identity**
Show the AG Grid dashboard. Register or select the verified agent and show its
human consent cap and policy. Explain that each checkout request is HMAC-signed,
time-bounded, and protected against nonce replay.

**0:45–1:05 — Scenario A**
Run the unsigned request. Show HTTP 403 and the audit entry. State that no PayPal
order was created.

**1:05–1:25 — Scenario B**
Run the signed $75 request against a $50 human cap. Show BLOCK and the reason.
Explain that the deterministic gateway rejects it before PayPal order creation.

**1:25–1:50 — Scenario C**
Run the signed $25 request. Show ALLOW, the actual PayPal sandbox order ID, and
the approval URL. Open PayPal checkout and approve with the sandbox buyer.

**1:50–2:25 — Scenario D**
Return to the dashboard. Show the authorization ID. Click the merchant capture
approval action and then confirm capture. Show the capture ID and CAPTURED state.

**2:25–2:45 — AI and safety**
Show the natural-language policy preview and explain that OpenAI produces a
validated proposal, not a payment decision. End by showing the audit trail and
stating that no LLM tool can move money.

Record the actual IDs returned by the sandbox during the take. Do not display
client secrets, buyer passwords, access tokens, or personal account details.

## Video storyboard

| Time | Screen / shot | Narration / proof |
|---|---|---|
| 0:00–0:20 | Dashboard title and agent overview | Problem, target merchant, product value |
| 0:20–0:45 | Agent registry, consent, policy | Identity verification and human limits |
| 0:45–1:05 | Terminal + audit grid | Unsigned request returns 403 |
| 1:05–1:25 | Terminal + request row | Verified over-cap request is BLOCKED |
| 1:25–1:50 | Terminal then PayPal sandbox checkout | Real order ID, buyer approval |
| 1:50–2:25 | Dashboard payment operations | Authorization ID, explicit capture approval, capture ID |
| 2:25–2:45 | AI policy preview + audit history | AI role boundaries, deterministic enforcement, traceability |

## Submission checklist

- [ ] Confirm the GitHub repository is public and the MIT `LICENSE` is visible.
- [ ] Merge the deployment/submission PR and verify the exact `main` commit.
- [ ] Deploy the Render Blueprint and publish the real service URL.
- [ ] Verify the production build and `/api/health`.
- [ ] Configure sandbox REST app credentials and webhook ID in Render.
- [ ] Complete scenarios A–D with a real sandbox buyer and seller.
- [ ] Record PayPal order, authorization, capture IDs and matching audit entries.
- [ ] Record a public YouTube video under three minutes and add its URL to Devpost.
- [ ] Paste the short and full descriptions, technology list, and AI tool explanation
  into the Devpost project form.
- [ ] Confirm all demo credentials and personal data are hidden from the video; use no copyrighted music or unlicensed third-party material.
- [ ] Submit before **November 13, 2026 at 1:30 a.m. IST** (deadline stated in the supplied hackathon brief).

## Current verification status

This document is a prepared submission draft and test procedure. It does not claim
that Render has been provisioned, that a public deployment URL exists, that
PayPal sandbox transactions have been completed, that the full demo script has
passed, or that a YouTube video or Devpost entry has been submitted.
