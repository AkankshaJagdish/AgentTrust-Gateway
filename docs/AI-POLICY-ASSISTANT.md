# AI Policy Assistant

## Runtime design

The application uses the OpenAI JavaScript SDK Responses API with Structured Outputs (responses.parse + zodTextFormat). The model returns a schema-checked policy proposal. AgentTrust then validates all amounts, currency and the selected human-consent cap with decimal arithmetic.

The assistant never receives PayPal tools or payment endpoints. It has no function-calling tools. The policy preview endpoint persists a 30-minute draft. Only an authenticated merchant can activate that draft, and activation re-checks the draft expiry, one-time use, current consent status, currency and consent cap. The activation action is separately audited.

The deterministic policy engine enforces active agent identity, signed agent requests, active and unexpired human consent, per-transaction cap, UTC-day spending cap, and the human approval threshold. A rule phrased “above $30” uses a strict greater-than comparison: $30.00 does not trigger the threshold; $30.01 does. Verified-agent requirements and expired-agent blocking are hard-coded invariants and cannot be disabled through natural language.

AI risk assessments receive only transaction and gateway information available to the server. The result is advisory and shown alongside the authoritative deterministic decision. It cannot change that decision or trigger payment operations.

## Workflow

1. Merchant chooses active, unexpired human consent and enters plain-language rules.
2. POST /api/ai/policy/preview asks OpenAI for a structured proposal and stores a short-lived PolicyDraft.
3. Dashboard shows JSON, limits, clarifications and validation errors.
4. Merchant explicitly confirms activation.
5. POST /api/ai/policy/activate revalidates and atomically consumes the draft while creating an enabled policy and version 1 snapshot.
6. PATCH /api/policies/{id} edits or toggles a policy and creates an immutable SpendingPolicyVersion snapshot. GET /api/policies/{id} returns version history.

A preview is not active and cannot affect enforcement.

## OpenAI configuration

Set OPENAI_API_KEY in the deployment secret store. OPENAI_MODEL is optional and defaults to gpt-6-luna. Without the key, the dashboard, existing manual policies, deterministic enforcement and PayPal operations remain available; AI preview/risk endpoints return a clear 503 configuration error.

## Endpoints

- POST /api/ai/policy/preview — { consentId, description }.
- POST /api/ai/policy/activate — { draftId }; authenticated merchant confirmation required.
- POST /api/ai/risk/assess — { agentId, amount, currency, description? }; advisory only.
- GET /api/policies/{id} — policy and immutable version history.
- PATCH /api/policies/{id} — merchant edit or enable/disable; every update creates a new version.

## Policy examples

With a USD human consent cap of at least $150:

**Procurement with approval threshold**

> Allow verified agents to purchase up to $50 per transaction, with a maximum daily budget of $150. Require human approval for anything above $30. Block expired agents.

Expected: maxPerTx=50.00, dailyCap=150.00, requireApprovalAbove=30.00, currency=USD; verified agents required and expired agents blocked.

**Small recurring office purchases**

> Allow signed agents to spend up to $20 per transaction and $60 per day. No additional human approval threshold. Reject expired agents.

Expected: maxPerTx=20.00, dailyCap=60.00, requireApprovalAbove=null.

**Clarification case**

> Allow agents to buy office supplies when appropriate.

Expected: missing-limit clarifications. The preview cannot be activated until transaction and daily limits are specified.

**Consent-cap conflict**

> Allow purchases up to $500 per transaction and $700 per day.

If the selected consent cap is $150, server validation rejects activation. The model cannot override the consent cap.

## Codex MCP configuration

Optional project-scoped configuration is .codex/config.toml:
- PayPal sandbox Streamable HTTP: https://mcp.sandbox.paypal.com/http.
- OpenAI documentation Streamable HTTP: https://developers.openai.com/mcp.

In a supported Codex environment:
1. Trust the repository so project-scoped configuration can load.
2. Run codex mcp list.
3. Authenticate PayPal interactively with the Codex MCP authentication flow or codex mcp login paypal.
4. Verify PayPal MCP initializes in the actual Codex session. Cloud Codex does not automatically inherit local workstation configuration or OAuth.
5. The PayPal MCP allow-list intentionally starts empty until its actual tool names are inspected. Enable only verified read-only lookup tools. Never enable payment mutation tools for autonomous use.
6. Verify OpenAI Docs MCP is available and use it for OpenAI SDK/API documentation.

These MCPs are development aids, not runtime dependencies. The app does not call them, and missing MCP connectivity must not disable the dashboard.

## APIMatic PayPal context plugin

In a supported Codex development environment, run:

    npx context-plugins install paypal

Confirm installation and tool availability in that environment before relying on it. Plugin installation/authentication is not performed by the web application and no plugin credentials belong in Git. This GitHub-connected cloud task does not expose a Codex plugin runtime or MCP session, so it cannot truthfully report that the APIMatic plugin or either remote MCP server was connected here.

## PayPal Agent Toolkit allow-list

The official TypeScript documentation identifies the PayPalAgentToolkit import from @paypal/agent-toolkit/ai-sdk, constructor options clientId/clientSecret/configuration, read-only order lookup action configuration.actions.orders.get=true, and tool discovery method getTools().

AgentTrust keeps the action map to { orders: { get: true } }. It does not set ALL_TOOLS_ENABLED and does not pass toolkit tools into OpenAI policy/risk requests. All payment mutations remain behind deterministic AgentTrust REST services and explicit human capture approval.
