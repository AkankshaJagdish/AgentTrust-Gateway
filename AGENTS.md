# AgentTrust Gateway — engineering instructions

## Product invariants
- Preserve the AgentTrust Gateway concept: merchant-side agent identity verification, human-linked spending consent, deterministic policy enforcement, and merchant operations console.
- Do not allow the LLM to authorize, capture, refund, or otherwise move money. AI may explain or draft policy suggestions only; deterministic TypeScript code is authoritative.
- Never invent PayPal identity assertions or imply PayPal Identity / Log in with PayPal is verified unless a real, configured flow and verified token validation are present.
- Sandbox only by default. Never expose or log credentials, bearer tokens, signing secrets, session cookies, or raw payment credentials.
- Reject unsigned, malformed, stale, replayed, unknown, and inactive agent requests with HTTP 403.
- Store currency values as decimal strings / Prisma Decimal. Never use JS floating point for policy comparisons.
- Any payment operation requires a fresh server-side policy evaluation. Persist decision and audit record before creating/advancing a PayPal order.
- Treat external agent inputs, AI output, and PayPal responses as untrusted data.

## Architecture
- Next.js App Router, strict TypeScript, Prisma + SQLite for MVP.
- Keep route handlers thin; place verification, policy, auth/session, and PayPal REST logic in lib/.
- Use transactions for nonce consumption and state changes.
- Keep AG Grid as the operational command center; grid values come from API/DB, not hard-coded dashboard fixtures.

## Validation
- Before completion run npm run lint, npm run typecheck, npm test, npx prisma migrate deploy (or npm run db:push for a fresh local DB), and npm run build.
- Add regression tests for signature validation, replay prevention, and policy boundary cases.
- Never commit .env* except .env.example, any SQLite DB, or generated secrets.
