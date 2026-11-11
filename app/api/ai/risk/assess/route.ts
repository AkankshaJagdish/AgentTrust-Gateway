import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { evaluatePolicy } from "@/lib/policy";
import { assessTransactionRisk } from "@/lib/ai-policy";
import { audit } from "@/lib/audit";

const schema=z.object({agentId:z.string(),amount:z.string(),currency:z.string(),description:z.string().max(1000).optional()});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const input=schema.parse(await request.json());
  const agent=await prisma.agent.findFirst({where:{id:input.agentId,userId:user.id}});
  if(!agent)return NextResponse.json({error:"Agent not found in this merchant account."},{status:404});
  const evaluation=await evaluatePolicy({agentId:agent.id,amount:input.amount,currency:input.currency});
  const latestRequest=await prisma.agentRequest.findFirst({where:{agentId:agent.id},orderBy:{createdAt:"desc"}});
  const consent=await prisma.consent.findFirst({where:{agentId:agent.id,userId:user.id,status:"ACTIVE",expiresAt:{gt:new Date()},currency:input.currency},orderBy:{createdAt:"desc"}});
  const policy=consent?await prisma.spendingPolicy.findFirst({where:{consentId:consent.id,userId:user.id,enabled:true,currency:input.currency,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},orderBy:{createdAt:"desc"}}):null;
  const assessment=await assessTransactionRisk({
   amount:input.amount,currency:input.currency,description:input.description,agentName:agent.name,agentStatus:agent.expiresAt&&agent.expiresAt<=new Date()?"EXPIRED":agent.status,
   signatureVerified:latestRequest?.signatureValid??false,consentActive:!!consent,consentCap:consent?.spendingCap.toString()??null,
   policyMaxPerTx:policy?.maxPerTx.toString()??null,policyDailyCap:policy?.dailyCap.toString()??null,
   deterministicDecision:evaluation.decision,deterministicReason:evaluation.reason
  });
  await audit({userId:user.id,actorType:"AI",actorId:"openai",action:"AI_TRANSACTION_RISK_ASSESSED",entityType:"Agent",entityId:agent.id,outcome:assessment.level,reason:assessment.summary,metadata:{deterministicDecision:evaluation.decision,amount:input.amount,currency:input.currency}});
  return NextResponse.json({assessment,deterministicDecision:evaluation.decision,deterministicReason:evaluation.reason,advisoryOnly:true});
 }catch(e){const message=e instanceof Error?e.message:"Unable to assess transaction risk.";return NextResponse.json({error:message},{status:message.includes("OPENAI_API_KEY")?503:400});}
}
