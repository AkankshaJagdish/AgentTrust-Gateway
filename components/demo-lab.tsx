"use client";
import { useEffect, useState } from "react";
import { demoEligibility } from "@/lib/demo-lab-eligibility";

type Agent = { id: string; name: string; status: string; expiresAt?: string | null };
type Consent = { id: string; agentId: string; status: string; spendingCap: string; currency: string; expiresAt: string; createdAt: string };
type Policy = { id: string; consentId: string | null; enabled: boolean; maxPerTx: string; dailyCap: string; currency: string; createdAt: string; expiresAt?: string | null; requireApprovalAbove?: string | null };
type Audit = { id: string; action: string; outcome: string; reason: string | null; createdAt: string };
type Result = {
  scenario: "A" | "B" | "C"; httpStatus: number; decision: string | null;
  reason: string | null; requestId: string | null; auditRecords: Audit[];
  orderId: string | null; approvalUrl: string | null; orderStatus: string | null;
};
type Order = { paypalOrderId: string | null; status: string; authorizations: { paypalAuthorizationId: string; status: string }[] };
const scenarios = [
  { id: "A", title: "Unsigned request", amount: "$25.00", expected: "403 · BLOCK", detail: "Send an agent checkout without signing headers. The production verifier rejects it." },
  { id: "B", title: "Over consent cap", amount: "$75.00", expected: "403 · BLOCK", detail: "Send a valid HMAC-signed request above the human's $50.00 consent cap." },
  { id: "C", title: "Within policy limits", amount: "$25.00", expected: "201 · ALLOW", detail: "Send a valid signed request through the policy engine and create a genuine PayPal Sandbox order." },
] as const;

export function DemoLab({ agents, consents, policies, onCompleted }: {
  agents: Agent[]; consents: Consent[]; policies: Policy[]; onCompleted: () => void;
}) {
  const [agentId, setAgentId] = useState("");
  const [results, setResults] = useState<Partial<Record<"A" | "B" | "C", Result>>>({});
  const [errors, setErrors] = useState<Partial<Record<"A" | "B" | "C", string>>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);
  const activeAgents = agents.filter(a => a.status === "ACTIVE" && (!a.expiresAt || new Date(a.expiresAt) > new Date()));
  useEffect(() => {
    if (!activeAgents.some(a => a.id === agentId)) setAgentId(activeAgents[0]?.id ?? "");
  }, [agentId, agents]);
  const selectedAgent = activeAgents.find(a => a.id === agentId);
  const readiness = {
    A: demoEligibility(selectedAgent, consents, policies, "A"),
    B: demoEligibility(selectedAgent, consents, policies, "B"),
    C: demoEligibility(selectedAgent, consents, policies, "C"),
  };
  const allowed = results.C;
  const relevantOrder = orders.find(o => o.paypalOrderId === allowed?.orderId);

  async function refreshOrders() {
    const response = await fetch("/api/orders", { cache: "no-store" });
    if (response.ok) setOrders(await response.json() as Order[]);
  }
  useEffect(() => { if (allowed?.orderId) void refreshOrders(); }, [allowed?.orderId]);
  async function run(scenario: "A" | "B" | "C") {
    if (busy) return;
    const state = readiness[scenario];
    if (!state.ready) { setErrors(prev => ({ ...prev, [scenario]: state.missing.join(" ") })); return; }
    setBusy(scenario);
    setErrors(prev => ({ ...prev, [scenario]: "" }));
    try {
      const response = await fetch("/api/demo-lab/run", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agentId, scenario, consentId: state.consentId, policyId: state.policyId }),
      });
      const data = await response.json().catch(() => ({ error: `Server returned HTTP ${response.status} without JSON.` }));
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${data.error ?? "Demo request failed."}`);
      setResults(prev => ({ ...prev, [scenario]: data as Result }));
      onCompleted();
      if (scenario === "C") await refreshOrders();
    } catch (error) {
      setErrors(prev => ({ ...prev, [scenario]: error instanceof Error ? error.message : "Demo request failed." }));
    } finally { setBusy(null); }
  }
  return <section className="panel demo-lab" id="demo-lab">
    <div className="demo-lab-heading">
      <div><div className="panel-title">Demo Lab · Live gateway scenarios</div>
        <div className="panel-meta" style={{ marginTop: 5 }}>Real HMAC verification, consent enforcement, audit events and PayPal Orders v2</div></div>
      <span className="demo-lab-sandbox">PAYPAL SANDBOX · No real money</span>
    </div>
    <div className="demo-lab-controls">
      <label htmlFor="demo-agent" className="metric-label">Merchant-owned agent</label>
      <select id="demo-agent" value={agentId} onChange={e => { setAgentId(e.target.value); setResults({}); setErrors({}); }}>
        <option value="">Select an active agent</option>
        {activeAgents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <button className="btn secondary" onClick={() => setGuide(v => !v)} aria-expanded={guide}>{guide ? "Hide walkthrough" : "Judge walkthrough"}</button>
    </div>
    {guide && <div className="inline-note demo-lab-guide">
      <strong>Judge walkthrough</strong>
      <ol>
        <li>Register or select an active agent in the merchant dashboard.</li>
        <li>Create an active USD $50 human consent for the agent, then an enabled policy permitting $25 transactions and at least $25 of daily spending. No approval threshold below $25.</li>
        <li>Run A to observe unsigned-request rejection; run B for a signed request blocked by consent; run C to create a real PayPal Sandbox order.</li>
        <li>Open the PayPal approval link, log in as a Sandbox buyer and approve. Return to this dashboard and refresh payment status.</li>
        <li>Use the existing <strong>PayPal authorization &amp; capture</strong> panel below to review authorization, separately approve capture and confirm capture as the merchant.</li>
      </ol>
      Each execution uses the production checkout handler. No transaction is simulated. The $25 allowed request counts toward the active daily cap.
    </div>}
    {!agentId && <div className="notice" role="status">Register an active agent to run the Demo Lab.</div>}
    {agentId && !readiness.C.ready && <div className="notice" style={{ marginTop: 12 }} role="status">
      <strong>Payment scenario setup:</strong>
      <ul>{readiness.C.missing.map(item => <li key={item}>{item}</li>)}</ul>
      Scenario A can run without consent or policy.
    </div>}
    <div className="demo-lab-scenarios">
      {scenarios.map(s => {
        const result = results[s.id];
        return <article key={s.id} className="demo-lab-scenario">
          <h3>{s.id}. {s.title}</h3>
          <div className="panel-meta">{s.amount} · Expected HTTP {s.expected}</div>
          <p>{s.detail}</p>
          <button className="btn" disabled={busy !== null || !readiness[s.id].ready} onClick={() => void run(s.id)}>
            {busy === s.id ? "Running…" : `Run scenario ${s.id}`}
          </button>
          {!readiness[s.id].ready && <div className="event-sub" style={{ marginTop: 8 }}>Unavailable: {readiness[s.id].missing.join(" ")}</div>}
          {errors[s.id] && <div className="demo-lab-error" role="alert">{errors[s.id]}</div>}
          {result && <div className="demo-lab-result" aria-live="polite">
            <dl>
              <dt>HTTP status</dt><dd><strong>{result.httpStatus}</strong> (expected {s.id === "C" ? 201 : 403})</dd>
              <dt>Decision</dt><dd><span className={`pill ${result.decision === "ALLOW" ? "green" : "red"}`}>{result.decision ?? "—"}</span></dd>
              <dt>Reason</dt><dd>{result.reason ?? "—"}</dd>
              <dt>Request ID</dt><dd><code>{result.requestId ?? "—"}</code></dd>
              <dt>Audit events</dt><dd>{result.auditRecords.length}</dd>
            </dl>
            {result.auditRecords.map(a => <div key={a.id} className="demo-lab-audit">
              <strong>{a.action.replaceAll("_", " ")}</strong> · {a.outcome}
              {a.reason && <div>{a.reason}</div>}
              <div>{new Date(a.createdAt).toLocaleString()}</div>
            </div>)}
          </div>}
        </article>;
      })}
    </div>
    {allowed?.orderId && <div className="demo-lab-order">
      <strong>PayPal Sandbox order:</strong> <code>{allowed.orderId}</code>
      <div style={{ marginTop: 6 }}>Status: <strong>{relevantOrder?.status ?? allowed.orderStatus ?? "Pending refresh"}</strong></div>
      {relevantOrder?.authorizations.map(a => <div key={a.paypalAuthorizationId} style={{ marginTop: 6 }}>
        Authorization: <code>{a.paypalAuthorizationId}</code> · {a.status}
      </div>)}
      {allowed.approvalUrl && (!relevantOrder || relevantOrder.status === "CREATED") && <div>
        <a className="btn" href={allowed.approvalUrl} target="_blank" rel="noreferrer">Approve with PayPal Sandbox buyer</a>
      </div>}
      <div style={{ marginTop: 10 }}>
        <button className="btn secondary" onClick={() => void refreshOrders()}>Refresh authorization status</button>
      </div>
      <div className="event-sub" style={{ marginTop: 8 }}>Merchant capture approval and capture remain in the existing PayPal authorization &amp; capture panel below.</div>
    </div>}
  </section>;
}
