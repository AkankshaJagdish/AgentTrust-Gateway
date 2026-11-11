import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { PolicySpecSchema,validatePolicySpec } from "@/lib/ai-policy";

const schema=z.object({draftId:z.string().min(1)});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const {draftId}=schema.parse(await request.json());
  const draft=await prisma.policyDraft.findFirst({where:{id:draftId,userId:user.id,consumedAt:null,expiresAt:{gt:new Date()}}});
  if(!draft)return NextResponse.json({error:"Policy preview not found, expired, or already activated. Generate a new preview."},{status:404});
  const spec=PolicySpecSchema.parse(JSON.parse(draft.structuredPolicy));
  if(spec.clarifications.length)return NextResponse.json({error:"Resolve all AI clarifications before activating this policy.",clarifications:spec.clarifications},{status:400});
  const consent=await prisma.consent.findFirst({where:{id:draft.consentId,userId:user.id,status:"ACTIVE",expiresAt:{gt:new Date()}}});
  if(!consent)return NextResponse.json({error:"Human consent was revoked or expired. Policy cannot be activated."},{status:409});
  const limits=validatePolicySpec(spec,{currency:consent.currency,spendingCap:consent.spendingCap.toString()});
  const created=await prisma.$transaction(async tx=>{
   const claimed=await tx.policyDraft.updateMany({where:{id:draft.id,userId:user.id,consumedAt:null,expiresAt:{gt:new Date()}},data:{consumedAt:new Date()}});
   if(claimed.count!==1)throw new Error("This preview has already been activated.");
   const policy=await tx.spendingPolicy.create({data:{
    userId:user.id,consentId:consent.id,name:spec.name.slice(0,80),maxPerTx:limits.maxPerTx,
    dailyCap:limits.dailyCap,currency:limits.currency,requireApprovalAbove:limits.requireApprovalAbove,
    enabled:true,version:1,naturalLanguage:draft.sourceText,aiGenerated:true
   }});
   await tx.spendingPolicyVersion.create({data:{policyId:policy.id,version:1,snapshot:JSON.stringify({name:policy.name,maxPerTx:policy.maxPerTx.toString(),dailyCap:policy.dailyCap.toString(),currency:policy.currency,requireApprovalAbove:policy.requireApprovalAbove?.toString()??null,enabled:policy.enabled}),sourceText:draft.sourceText,actorUserId:user.id}});
   return policy;
  });
  await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"AI_POLICY_CONFIRMED_AND_ACTIVATED",entityType:"SpendingPolicy",entityId:created.id,outcome:"SUCCESS",metadata:{draftId:draft.id,version:1}});
  return NextResponse.json(created,{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Unable to activate policy."},{status:400});}
}
