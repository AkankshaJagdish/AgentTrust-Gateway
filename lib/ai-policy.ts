import "server-only";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { PolicySpecSchema,RiskAssessmentSchema } from "@/lib/policy-spec";
import type { PolicySpec,RiskAssessment } from "@/lib/policy-spec";
export { PolicySpecSchema,RiskAssessmentSchema,validatePolicySpec } from "@/lib/policy-spec";
export type { PolicySpec,RiskAssessment } from "@/lib/policy-spec";

let client: OpenAI | null = null;
function openai() {
  if (!process.env.OPENAI_API_KEY) throw new Error("AI policy assistance is unavailable until OPENAI_API_KEY is configured.");
  client ??= new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}
const model = () => process.env.OPENAI_MODEL || "gpt-5.6-mini";

export async function draftPolicyFromNaturalLanguage(input: { description:string; currency:string; consentCap:string }) {
  const response = await openai().responses.parse({
    model: model(),
    store: false,
    input: [
      { role:"system", content:[
        "You translate merchant-authored natural-language agent security rules into a policy proposal.",
        "Return only the schema. Do not create or change a policy, do not call tools, and do not authorize payments.",
        "The merchant's currency and human-consent cap are hard constraints. Never propose a transaction or daily cap above the consent cap.",
        "requireVerifiedAgents and blockExpiredAgents are mandatory security invariants and must always be true. Never suggest disabling them.",
        "Do not invent missing amounts, thresholds, expiry dates, agent identities, or transaction context. Use null for unspecified monetary limits and explain what must be clarified.",
        "A phrase such as 'up to $50 per transaction' maps to maxPerTx=50. 'Maximum daily budget of $150' maps to dailyCap=150.",
        "Human approval 'above $30' maps to requireApprovalAbove=30; the backend uses a strict greater-than threshold for future agent requests.",
        "Return money as plain decimal strings with two fractional digits and no currency symbols.",
        "If a request conflicts with mandatory verification, expired-agent blocking, currency or consent cap, preserve the mandatory invariant and explain the conflict in clarifications."
      ].join("\n") },
      { role:"user", content: JSON.stringify({merchantRules:input.description,consentCurrency:input.currency,humanConsentSpendingCap:input.consentCap}) }
    ],
    text: { format: zodTextFormat(PolicySpecSchema,"agenttrust_policy_draft") },
  });
  if (!response.output_parsed) throw new Error("The AI did not return a complete structured policy. Please clarify the rules and try again.");
  return PolicySpecSchema.parse(response.output_parsed);
}

export async function assessTransactionRisk(input: {
  amount:string; currency:string; description?:string; agentName:string;
  agentStatus:string; latestStoredRequestSignatureVerified:boolean; consentActive:boolean;
  consentCap:string|null; policyMaxPerTx:string|null; policyDailyCap:string|null;
  deterministicDecision:string; deterministicReason:string;
}) {
  const response = await openai().responses.parse({
    model:model(),
    store:false,
    input:[
      {role:"system",content:[
        "You are a transaction risk analyst for AgentTrust Gateway.",
        "Assess only the supplied facts. Do not invent fraud signals, identity verification, merchant history, or external facts.",
        "The latestStoredRequestSignatureVerified field describes only the latest stored agent request, not cryptographic verification of this hypothetical transaction.",
        "Your output is advisory and never authorizes, captures, voids, blocks, or moves money.",
        "The deterministic gateway decision and reason are authoritative. If they say BLOCK or REQUIRE_APPROVAL, do not recommend bypassing them.",
        "List missing information explicitly. A LOW risk score is not a payment authorization."
      ].join("\n")},
      {role:"user",content:JSON.stringify(input)}
    ],
    text:{format:zodTextFormat(RiskAssessmentSchema,"agenttrust_risk_assessment")}
  });
  if(!response.output_parsed)throw new Error("The AI did not return a complete risk assessment.");
  return RiskAssessmentSchema.parse(response.output_parsed);
}

