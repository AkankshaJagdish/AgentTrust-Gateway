// Shared pure eligibility rules. The gateway's newest active USD consent is authoritative.
export type DemoAgent={id:string;status:string;expiresAt?:string|Date|null};
export type DemoConsent={id:string;agentId:string;status:string;currency:string;spendingCap:string|number;expiresAt:string|Date;createdAt:string|Date};
export type DemoPolicy={id:string;consentId:string|null;enabled:boolean;currency:string;maxPerTx:string|number;dailyCap:string|number;requireApprovalAbove?:string|number|null;expiresAt?:string|Date|null;createdAt:string|Date};
export type Scenario="A"|"B"|"C";
export function demoEligibility(agent:DemoAgent|null|undefined,consents:DemoConsent[],policies:DemoPolicy[],scenario:Scenario,now=new Date()){
 const missing:string[]=[];
 if(!agent)missing.push("Select an active merchant-owned agent.");
 else if(agent.status!=="ACTIVE")missing.push("Agent must be active.");
 else if(agent.expiresAt&&new Date(agent.expiresAt)<=now)missing.push("Agent identity has expired.");
 if(scenario==="A")return {ready:missing.length===0,missing,consentId:null as string|null,policyId:null as string|null};
 if(!agent)return {ready:false,missing,consentId:null as string|null,policyId:null as string|null};
 const eligible=consents.filter(c=>c.agentId===agent.id&&c.status==="ACTIVE"&&c.currency==="USD"&&new Date(c.expiresAt)>now)
  .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime());
 const consent=eligible[0];
 if(!consent){missing.push("Create an active, unexpired USD human consent for this agent.");return {ready:false,missing,consentId:null,policyId:null};}
 if(Number(consent.spendingCap)!==50)missing.push("The newest active USD consent must have an exact $50.00 spending cap (currently $"+Number(consent.spendingCap).toFixed(2)+").");
 const policy=policies.filter(p=>p.consentId===consent.id&&p.enabled&&p.currency==="USD"&&(!p.expiresAt||new Date(p.expiresAt)>now))
  .sort((a,b)=>new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())[0];
 if(!policy)missing.push("Create an enabled, unexpired USD policy linked to the newest active USD consent.");
 else{
  if(Number(policy.maxPerTx)<25)missing.push("Policy per-transaction limit must be at least $25.00.");
  if(Number(policy.dailyCap)<25)missing.push("Policy daily cap must be at least $25.00.");
  if(policy.requireApprovalAbove!==null&&policy.requireApprovalAbove!==undefined&&Number(policy.requireApprovalAbove)<25)missing.push("Policy approval threshold must be at least $25.00, or unset.");
 }
 return {ready:missing.length===0,missing,consentId:consent.id,policyId:policy?.id??null};
}
