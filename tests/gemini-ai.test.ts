import { beforeEach,describe,it,expect,vi } from "vitest";
const generateContent=vi.fn();
vi.mock("server-only",()=>({}));
vi.mock("@google/genai",()=>({GoogleGenAI:class{models={generateContent};}}));
import {draftPolicyFromNaturalLanguage,assessTransactionRisk} from "@/lib/ai-policy";
import {validatePolicySpec} from "@/lib/policy-spec";
const input={description:"Allow $25 per transaction and $50 daily",currency:"USD",consentCap:"50.00"};
const policy={name:"Procurement",summary:"Limited",currency:"USD",maxPerTx:"25.00",dailyCap:"50.00",requireApprovalAbove:null,requireVerifiedAgents:true,blockExpiredAgents:true,clarifications:[]};
beforeEach(()=>{vi.clearAllMocks();process.env.GEMINI_API_KEY="test-key";delete process.env.GEMINI_MODEL;});
describe("Gemini structured responses",()=>{
 it("valid proposal",async()=>{generateContent.mockResolvedValue({text:JSON.stringify(policy)});const p=await draftPolicyFromNaturalLanguage(input);expect(validatePolicySpec(p,{currency:"USD",spendingCap:"50.00"}).maxPerTx.toString()).toBe("25");});
 it("malformed JSON",async()=>{generateContent.mockResolvedValue({text:"{bad"});await expect(draftPolicyFromNaturalLanguage(input)).rejects.toMatchObject({status:502});});
 it("invalid schema",async()=>{generateContent.mockResolvedValue({text:JSON.stringify({name:"Bad"})});await expect(draftPolicyFromNaturalLanguage(input)).rejects.toMatchObject({status:502});});
 it("over-cap proposal fails deterministic validation",async()=>{generateContent.mockResolvedValue({text:JSON.stringify({...policy,maxPerTx:"75.00"})});const p=await draftPolicyFromNaturalLanguage(input);expect(()=>validatePolicySpec(p,{currency:"USD",spendingCap:"50.00"})).toThrow(/consent spending cap/);});
 it("quota error",async()=>{generateContent.mockRejectedValue({status:429,message:"secret upstream"});await expect(draftPolicyFromNaturalLanguage(input)).rejects.toMatchObject({status:429});});
 it("risk is advisory",async()=>{generateContent.mockResolvedValue({text:JSON.stringify({level:"LOW",summary:"Limited data",factors:[],missingInformation:["History"],recommendation:"NO_ADDITIONAL_REVIEW"})});const result=await assessTransactionRisk({amount:"25.00",currency:"USD",agentName:"Demo",agentStatus:"ACTIVE",latestStoredRequestSignatureVerified:true,consentActive:true,consentCap:"50.00",policyMaxPerTx:"25.00",policyDailyCap:"50.00",deterministicDecision:"ALLOW",deterministicReason:"Within limits"});expect(result.level).toBe("LOW");expect(generateContent.mock.calls[0][0]).not.toHaveProperty("tools");});
});
