import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { aiErrorResponse, geminiModel } from "@/lib/ai-policy";
import { draftPolicyFromNaturalLanguage,validatePolicySpec } from "@/lib/ai-policy";

const requestSchema=z.object({consentId:z.string().min(1),description:z.string().min(12).max(6000)});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const input=requestSchema.parse(await request.json());
  const consent=await prisma.consent.findFirst({where:{id:input.consentId,userId:user.id,status:"ACTIVE",expiresAt:{gt:new Date()}},include:{agent:true}});
  if(!consent)return NextResponse.json({error:"Select an active, unexpired human consent belonging to this merchant."},{status:400});
  const spec=await draftPolicyFromNaturalLanguage({description:input.description,currency:consent.currency,consentCap:consent.spendingCap.toString()});
  let validation:string|null=null;
  try{validatePolicySpec(spec,{currency:consent.currency,spendingCap:consent.spendingCap.toString()});}catch(e){validation=e instanceof Error?e.message:"Policy validation failed.";}
  const draft=await prisma.policyDraft.create({data:{
   userId:user.id,consentId:consent.id,sourceText:input.description,
   structuredPolicy:JSON.stringify(spec),expiresAt:new Date(Date.now()+30*60_000)
  }});
  await audit({userId:user.id,actorType:"AI",actorId:"gemini",action:"AI_POLICY_DRAFT_CREATED",entityType:"PolicyDraft",entityId:draft.id,outcome:validation?"NEEDS_CLARIFICATION":"PREVIEWED",reason:validation??undefined,metadata:{provider:"gemini",model:geminiModel(),consentId:consent.id}});
  return NextResponse.json({draftId:draft.id,policy:spec,canActivate:!validation&&spec.clarifications.length===0,validationError:validation,expiresAt:draft.expiresAt,consent:{id:consent.id,agentName:consent.agent.name,currency:consent.currency,spendingCap:consent.spendingCap.toString()}},{status:201});
 }catch(e){if(e instanceof z.ZodError)return NextResponse.json({error:"Invalid request."},{status:400});const result=aiErrorResponse(e);return NextResponse.json({error:result.message},{status:result.status});}
}
