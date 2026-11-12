import {describe,it,expect} from "vitest";
import {demoEligibility} from "@/lib/demo-lab-eligibility";
const now=new Date("2026-11-12T12:00:00Z");
const agent={id:"a",status:"ACTIVE"};
const consent=(id:string,cap:string,createdAt:string)=>({id,agentId:"a",status:"ACTIVE",currency:"USD",spendingCap:cap,createdAt,expiresAt:"2026-12-01T00:00:00Z"});
const policy=(consentId:string,extra:Record<string,unknown>={})=>({id:"p",consentId,enabled:true,currency:"USD",maxPerTx:"25.00",dailyCap:"50.00",requireApprovalAbove:null,createdAt:"2026-11-12T00:00:00Z",...extra});
describe("Demo Lab eligibility",()=>{
 it("A requires agent only",()=>expect(demoEligibility(agent,[],[],"A",now).ready).toBe(true));
 it("no agent prevents A",()=>expect(demoEligibility(null,[],[],"A",now).ready).toBe(false));
 it("B and C need consent and policy",()=>{for(const s of ["B","C"] as const)expect(demoEligibility(agent,[],[],s,now).ready).toBe(false);});
 it("newest consent matches gateway, not first array entry",()=>{const old=consent("old","50.00","2026-11-10T00:00:00Z");const newest=consent("new","75.00","2026-11-11T00:00:00Z");const r=demoEligibility(agent,[old,newest],[policy("old")],"C",now);expect(r.ready).toBe(false);expect(r.consentId).toBe("new");expect(r.missing.join(" ")).toMatch(/newest active USD consent/);});
 it("valid newest consent and linked policy ready",()=>{const c=consent("c","50.00","2026-11-11T00:00:00Z");for(const s of ["B","C"] as const)expect(demoEligibility(agent,[c],[policy("c")],s,now).ready).toBe(true);});
 it("expired policy blocks readiness",()=>{const c=consent("c","50.00","2026-11-11T00:00:00Z");expect(demoEligibility(agent,[c],[policy("c",{expiresAt:"2026-11-01T00:00:00Z"})],"C",now).ready).toBe(false);});
 it("threshold below 25 blocks readiness",()=>{const c=consent("c","50.00","2026-11-11T00:00:00Z");expect(demoEligibility(agent,[c],[policy("c",{requireApprovalAbove:"20.00"})],"C",now).ready).toBe(false);});
});
