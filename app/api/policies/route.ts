import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { currency,money } from "@/lib/money";
const schema=z.object({consentId:z.string(),name:z.string().min(2).max(80),maxPerTx:z.string(),dailyCap:z.string(),currency:z.string().default("USD"),requireApprovalAbove:z.string().optional(),expiresAt:z.string().optional()});
const snapshot=(p:{name:string;maxPerTx:{toString():string};dailyCap:{toString():string};currency:string;requireApprovalAbove:{toString():string}|null;enabled:boolean;expiresAt:Date|null})=>JSON.stringify({name:p.name,maxPerTx:p.maxPerTx.toString(),dailyCap:p.dailyCap.toString(),currency:p.currency,requireApprovalAbove:p.requireApprovalAbove?.toString()??null,enabled:p.enabled,expiresAt:p.expiresAt?.toISOString()??null});
export async function GET(){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});return NextResponse.json(await prisma.spendingPolicy.findMany({where:{userId:user.id},include:{consent:{include:{agent:true}},versions:{orderBy:{version:"desc"}}},orderBy:{createdAt:"desc"}}));}
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const b=schema.parse(await request.json());
  const consent=await prisma.consent.findFirst({where:{id:b.consentId,userId:user.id,status:"ACTIVE",expiresAt:{gt:new Date()}}});
  if(!consent)return NextResponse.json({error:"An active consent is required."},{status:400});
  const code=currency(b.currency),maxPerTx=money(b.maxPerTx),dailyCap=money(b.dailyCap),threshold=b.requireApprovalAbove?money(b.requireApprovalAbove):null;
  if(code!==consent.currency)return NextResponse.json({error:"Policy currency must match the consent currency."},{status:400});
  if(!maxPerTx.gt(0)||!dailyCap.gt(0)||maxPerTx.gt(consent.spendingCap)||dailyCap.gt(consent.spendingCap))return NextResponse.json({error:"Policy limits must be positive and cannot exceed the human consent cap."},{status:400});
  if(threshold&&(!threshold.gt(0)||threshold.gte(maxPerTx)))return NextResponse.json({error:"Approval threshold must be positive and strictly below the per-transaction limit."},{status:400});
  const policy=await prisma.$transaction(async tx=>{
   const p=await tx.spendingPolicy.create({data:{userId:user.id,consentId:consent.id,name:b.name,maxPerTx,dailyCap,currency:code,requireApprovalAbove:threshold,expiresAt:b.expiresAt?new Date(b.expiresAt):null}});
   await tx.spendingPolicyVersion.create({data:{policyId:p.id,version:1,snapshot:snapshot(p),actorUserId:user.id}});
   return p;
  });
  await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"SPENDING_POLICY_CREATED",entityType:"SpendingPolicy",entityId:policy.id,outcome:"SUCCESS"});
  return NextResponse.json(policy,{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid policy."},{status:400});}
}
