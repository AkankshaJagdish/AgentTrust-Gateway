# AgentTrust Gateway — engineering rules

## Product invariants
- Preserve AgentTrust Gateway: merchant-side agent identity verification, human-linked spending consent, deterministic policy enforcement, and merchant operations command center.
- Do not replace the product with a buyer storefront, chatbot, or generic dashboard.
- AI may explain decisions or draft proposed rules. Its output is untrusted and cannot authorize, capture, refund, or move money.
- Never fabricate PayPal Identity / Log in with PayPal claims. A Gateway-local account is not PayPal-verified.
- PayPal testing defaults to sandbox. PayPal credentials, access tokens, webhook credentials and signing secrets stay server-side.
- Reject unsigned, malformed, stale, replayed, unknown, suspended, and revoked agents with HTTP 403.
- Currency comparisons use decimal arithmetic, not JavaScript floating point.
- Persist request verification, policy decisions, payment states and audit records.
- Treat agent input, external API responses and LLM output as untrusted.

## Engineering approach
- Next.js App Router, strict TypeScript, Prisma + SQLite for MVP.
- Keep route handlers thin; business logic belongs in `lib/`.
- Never present seeded demo traffic as real. Empty DB tables mean empty states.
- Keep AG Grid connected to backend data.
- Initial PayPal order intent is AUTHORIZE. Capture requires a separate explicit policy/consent check.

## Validation
Run `npm run lint`, `npm run typecheck`, `npm test`, `npx playwright test`, `npx prisma db push`, and `npm run build` before declaring readiness.
Never commit `.env`, local database files, secrets, generated tokens, or private keys.
