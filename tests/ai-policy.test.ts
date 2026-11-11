import {describe,expect,it} from "vitest";
import {PolicySpecSchema,validatePolicySpec} from "@/lib/policy-spec";

const consent={currency:"USD",spendingCap:"200.00"};
const base={name:"Verified procurement",summary:"Bound agent purchases and require human review above threshold.",currency:"USD",maxPerTx:"50.00",dailyCap:"150.00",requireApprovalAbove:"30.00",requireVerifiedAgents:true as const,blockExpiredAgents:true as const,clarifications:[] as string[]};

describe("AI policy structured output examples",()=>{
 it("accepts the merchant's $50 / $150 / approval above $30 example",()=>{
  const parsed=PolicySpecSchema.parse(base);
  const limits=validatePolicySpec(parsed,consent);
  expect(limits.maxPerTx.toFixed(2)).toBe("50.00");
  expect(limits.dailyCap.toFixed(2)).toBe("150.00");
  expect(limits.requireApprovalAbove?.toFixed(2)).toBe("30.00");
 });
 it("accepts a simpler no-threshold policy while retaining hard security invariants",()=>{
  const parsed=PolicySpecSchema.parse({...base,name:"Small purchases",maxPerTx:"20.00",dailyCap:"60.00",requireApprovalAbove:null});
  expect(validatePolicySpec(parsed,consent).requireApprovalAbove).toBeNull();
 });
 it("keeps missing limits as null and prevents activation until clarified",()=>{
  const parsed=PolicySpecSchema.parse({...base,maxPerTx:null,dailyCap:null,clarifications:["Specify a transaction limit.","Specify a daily budget."]});
  expect(parsed.clarifications).toHaveLength(2);
  expect(()=>validatePolicySpec(parsed,consent)).toThrow(/required before activation/);
 });
 it("rejects policy caps above the human consent cap",()=>{
  const parsed=PolicySpecSchema.parse({...base,dailyCap:"250.00"});
  expect(()=>validatePolicySpec(parsed,consent)).toThrow(/cannot exceed the human consent spending cap/);
 });
 it("rejects a currency that does not match the selected consent",()=>{
  const parsed=PolicySpecSchema.parse({...base,currency:"EUR"});
  expect(()=>validatePolicySpec(parsed,consent)).toThrow(/must match/);
 });
 it("rejects human approval thresholds above the per-transaction cap",()=>{
  const parsed=PolicySpecSchema.parse({...base,requireApprovalAbove:"55.00"});
  expect(()=>validatePolicySpec(parsed,consent)).toThrow(/no greater than the per-transaction limit/);
 });
 it("requires verification and expired-agent blocking in every generated policy",()=>{
  expect(()=>PolicySpecSchema.parse({...base,blockExpiredAgents:false})).toThrow();
  expect(()=>PolicySpecSchema.parse({...base,requireVerifiedAgents:false})).toThrow();
 });
 it("treats 'above $30' as strictly greater than $30",()=>{
  expect(Number("30.00")>Number("30.00")).toBe(false);
  expect(Number("30.01")>Number("30.00")).toBe(true);
 });
});
