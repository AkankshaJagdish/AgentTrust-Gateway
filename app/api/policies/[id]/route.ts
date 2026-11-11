import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { currency,money } from "@/lib/money";
const editSchema=z.object({
 enabled:z.boolean().optional(),name:z.string().min(2).max(80).optional(),
 maxPerTx:z.string().optional(),dailyCap:z.string().optional(),currency:z.string().optional(),
 requireApprovalAbove:z.string().nullable().optional(),expiresAt:z.string().nullable().optional()
}).refine(v=>Object.keys(v).length>0);
const snapshot=(p:{name:string;maxPerTx:{toString():string};dailyCap:{toString():string};currency:string;requireApprovalAbove:{toString():string}|null;enabled:boolean;expiresAt:Date|null})=>JSON.stringify({name:p.name,maxPerTx:p.maxPerTx.toString(),dailyCap:p.dailyCap.toString(),currency:p.currency,requireApprovalAbove:p.requireApprovalAbove?.toString()??null,enabled:p.enabled,expiresAt:p.expiresAt?.toISOString()??null});
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {id}=await params;const policy=await prisma.spendingPolicy.findFirst({where:{id,userId:user.id},include:{consent:{include:{agent:true}},versions:{orderBy:{version:"desc"}}}});
 if(!policy)return NextResponse.json({error:"Policy not found."},{status:404});
 return NextResponse.json(policy);
}
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {id}=await params;
 try{
  const body=editSchema.parse(await request.json());
  const policy=await prisma.spendingPolicy.findFirst({where:{id,userId:user.id},include:{consent:true}});
  if(!policy)return NextResponse.json({error:"Policy not found."},{status:404});
  if(!policy.consentId)return NextResponse.json({error:"Policy has no linked human consent."},{status:409});
  const consent=await prisma.consent.findFirst({where:{id:policy.consentId,userId:user.id,status:"ACTIVE",expiresAt:{gt:new Date()}}});
  const disableOnly=body.enabled===false&&Object.keys(body).length===1;
  if(!consent&&!disableOnly)return NextResponse.json({error:"Human consent is revoked or expired; policy cannot be edited or enabled."},{status:409});
  if(!consent&&disableOnly){
   const disabled=await prisma.$transaction(async tx=>{
    const next=await tx.spendingPolicy.update({where:{id},data:{enabled:false,version:{increment:1}}});
    await tx.spendingPolicyVersion.create({data:{policyId:id,version:next.version,snapshot:snapshot(next),sourceText:next.naturalLanguage??undefined,actorUserId:user.id}});
    return next;
   });
   await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"SPENDING_POLICY_VERSION_UPDATED",entityType:"SpendingPolicy",entityId:id,outcome:"SUCCESS",metadata:{version:disabled.version,changedFields:["enabled"]}});
   return NextResponse.json(disabled);
  }
  const code=currency(body.currency??policy.currency);
  const maxPerTx=body.maxPerTx!==undefined?money(body.maxPerTx):policy.maxPerTx;
  const dailyCap=body.dailyCap!==undefined?money(body.dailyCap):policy.dailyCap;
  const threshold=body.requireApprovalAbove===undefined?policy.requireApprovalAbove:body.requireApprovalAbove===null||body.requireApprovalAbove===""?null:money(body.requireApprovalAbove);
  if(code!==consent.currency||maxPerTx.lte(0)||dailyCap.lte(0)||maxPerTx.gt(consent.spendingCap)||dailyCap.gt(consent.spendingCap))return NextResponse.json({error:"Policy currency must match consent and positive limits must remain within its cap."},{status:400});
  if(threshold&&(!threshold.gt(0)||threshold.gt(maxPerTx)))return NextResponse.json({error:"Approval threshold must be positive and no greater than the transaction limit."},{status:400});
  const updated=await prisma.$transaction(async tx=>{
   const next=await tx.spendingPolicy.update({where:{id},data:{
    name:body.name??policy.name,maxPerTx,dailyCap,currency:code,requireApprovalAbove:threshold,
    enabled:body.enabled??policy.enabled,expiresAt:body.expiresAt===undefined?policy.expiresAt:body.expiresAt?new Date(body.expiresAt):null,
    version:{increment:1}
   }});
   await tx.spendingPolicyVersion.create({data:{policyId:id,version:next.version,snapshot:snapshot(next),sourceText:next.naturalLanguage??undefined,actorUserId:user.id}});
   return next;
  });
  await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"SPENDING_POLICY_VERSION_UPDATED",entityType:"SpendingPolicy",entityId:id,outcome:"SUCCESS",metadata:{version:updated.version,changedFields:Object.keys(body)}});
  return NextResponse.json(updated);
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid policy update."},{status:400});}
}
