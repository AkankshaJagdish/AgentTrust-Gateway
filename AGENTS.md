# AgentTrust Gateway instructions

- Preserve the AgentTrust Gateway product: merchant-side agent identity verification, human-linked spending consent, deterministic policy enforcement, and merchant command center.
- Never replace this with a buyer storefront, chatbot, or generic payment dashboard.
- AI may explain or draft policy but cannot authorize, capture, refund, or move money.
- Do not fabricate PayPal Identity / Log in with PayPal claims. A local account is not PayPal-verified.
- Sandbox by default. Keep all PayPal and signing secrets server-side.
- Reject unsigned, malformed, stale, replayed, unknown, suspended and revoked agents with HTTP 403.
- Use decimal arithmetic for all currency comparisons.
- Persist verification results, policy decisions, payment state and audit history.
- Keep Next.js handlers thin and business logic in lib/. AG Grid must read backend records; no fake live traffic.
- PayPal Orders start with AUTHORIZE intent. Captures need separate explicit fresh policy/consent checks.
- Before declaring ready run lint, typecheck, Vitest, Playwright, Prisma db push/migrate and production build.
- Never commit .env, credentials, tokens, local SQLite files or private keys.
