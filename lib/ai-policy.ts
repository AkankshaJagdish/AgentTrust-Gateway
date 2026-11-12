import "server-only";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { PolicySpecSchema, RiskAssessmentSchema } from "@/lib/policy-spec";
import type { PolicySpec, RiskAssessment } from "@/lib/policy-spec";
export { PolicySpecSchema, RiskAssessmentSchema, validatePolicySpec } from "@/lib/policy-spec";
export type { PolicySpec, RiskAssessment } from "@/lib/policy-spec";
export const geminiModel = () => process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash";
export class AIServiceError extends Error {
 constructor(public status:429|502|503,message:string){super(message);this.name="AIServiceError";}
}
export function aiErrorResponse(e:unknown){return e instanceof AIServiceError?{status:e.status,message:e.message}:{status:502,message:"Gemini is temporarily unavailable. Please try again."};}
async function generate<T extends z.ZodTypeAny>(schema:T,instruction:string,input:unknown):Promise<z.infer<T>>{
 const apiKey=process.env.GEMINI_API_KEY;
 if(!apiKey)throw new AIServiceError(503,"AI assistance requires GEMINI_API_KEY.");
 const model=geminiModel();
 if(!/^gemini-[a-z0-9][a-z0-9.-]*$/.test(model))throw new AIServiceError(503,"Invalid GEMINI_MODEL.");
 try{
  const response=await new GoogleGenAI({apiKey}).models.generateContent({
   model,contents:JSON.stringify(input),
   config:{systemInstruction:instruction,responseMimeType:"application/json",responseJsonSchema:z.toJSONSchema(schema),temperature:0.1}
  });
  if(!response.text)throw new AIServiceError(502,"Gemini returned no structured output.");
  return schema.parse(JSON.parse(response.text));
 }catch(e){
  if(e instanceof AIServiceError)throw e;
  if(e instanceof z.ZodError||e instanceof SyntaxError)throw new AIServiceError(502,"Gemini returned invalid structured output.");
  const status=e&&typeof e==="object"&&"status" in e?e.status:null;
  if(status===429)throw new AIServiceError(429,"Gemini free-tier quota reached. Please retry later.");
  if(status===401||status===403)throw new AIServiceError(503,"Gemini credentials or API access are invalid.");
  if(status===400||status===404)throw new AIServiceError(502,"Configured Gemini model or JSON schema was rejected.");
  throw new AIServiceError(502,"Gemini is temporarily unavailable. Please try again.");
 }
}
export async function draftPolicyFromNaturalLanguage(input:{description:string;currency:string;consentCap:string}):Promise<PolicySpec>{
 return generate(PolicySpecSchema,["You translate merchant-authored natural-language agent security rules into a policy proposal.",
        "Return only the schema. Do not create or change a policy, do not call tools, and do not authorize payments.",
        "The merchant's currency and human-consent cap are hard constraints. Never propose a transaction or daily cap above the consent cap.",
        "requireVerifiedAgents and blockExpiredAgents are mandatory security invariants and must always be true. Never suggest disabling them.",
        "Do not invent missing amounts, thresholds, expiry dates, agent identities, or transaction context. Use null for unspecified monetary limits and explain what must be clarified.",
        "A phrase such as 'up to $50 per transaction' maps to maxPerTx=50. 'Maximum daily budget of $150' maps to dailyCap=150.",
        "Human approval 'above $30' maps to requireApprovalAbove=30; the backend uses a strict greater-than threshold for future agent requests.",
        "Return money as plain decimal strings with two fractional digits and no currency symbols.",
        "If a request conflicts with mandatory verification, expired-agent blocking, currency or consent cap, preserve the mandatory invariant and explain the conflict in clarifications."].join("\n"),{merchantRules:input.description,consentCurrency:input.currency,humanConsentSpendingCap:input.consentCap});
}
export async function assessTransactionRisk(input:{
 amount:string;currency:string;description?:string;agentName:string;agentStatus:string;
 latestStoredRequestSignatureVerified:boolean;consentActive:boolean;consentCap:string|null;
 policyMaxPerTx:string|null;policyDailyCap:string|null;deterministicDecision:string;deterministicReason:string;
}):Promise<RiskAssessment>{
 return generate(RiskAssessmentSchema,["You are a transaction risk analyst for AgentTrust Gateway.",
        "Assess only the supplied facts. Do not invent fraud signals, identity verification, merchant history, or external facts.",
        "The latestStoredRequestSignatureVerified field describes only the latest stored agent request, not cryptographic verification of this hypothetical transaction.",
        "Your output is advisory and never authorizes, captures, voids, blocks, or moves money.",
        "The deterministic gateway decision and reason are authoritative. If they say BLOCK or REQUIRE_APPROVAL, do not recommend bypassing them.",
        "List missing information explicitly. A LOW risk score is not a payment authorization."].join("\n"),input);
}
