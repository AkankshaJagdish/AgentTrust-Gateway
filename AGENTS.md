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


## AI policy and MCP safety

- Always consult the OpenAI developer documentation MCP at https://developers.openai.com/mcp for current OpenAI API, Responses API, Structured Outputs, SDK, and Codex configuration questions when that MCP is available.
- Project-scoped MCP configuration is in .codex/config.toml. It is optional development tooling; the application must run if either MCP server is unavailable.
- PayPal sandbox MCP uses Streamable HTTP at https://mcp.sandbox.paypal.com/http. Authenticate interactively through Codex; never commit OAuth tokens, client secrets, or local MCP auth files.
- The PayPal MCP server can expose money-moving tools. Its project configuration starts with an empty tool allow-list. Inspect the actual tool catalogue and enable only read-only lookup tools by exact name. Do not enable create, authorize, capture, void, refund, invoice-send, or other state-changing actions for autonomous agent use.
- The @paypal/agent-toolkit TypeScript integration is restricted to the documented PayPalAgentToolkit constructor and getTools() interface with actions.orders.get enabled only. Never pass toolkit tools to the policy-writing or risk-assessment model. Never add a payment tool to an LLM tool list.
- AI policy output is a proposal only. Validate it on the server, persist a short-lived draft, require authenticated merchant confirmation, and enforce the resulting policy deterministically. Never authorize, capture, void, refund, or otherwise move money using model output.
- Treat AI risk assessments as advisory. The deterministic gateway decision is authoritative.
- Run npm run db:generate, npm run typecheck, npm run lint, npm test, and npm run build after changes. Do not claim these passed unless their output is available.
- Do not assume a cloud Codex task inherits workstation MCP configuration or OAuth. Verify MCP initialization in the actual cloud session; if unavailable, continue using repository code and official public documentation without blocking application work.
