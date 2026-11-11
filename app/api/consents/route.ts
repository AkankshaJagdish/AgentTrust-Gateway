import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { currency, money } from "@/lib/money";
const schema=z.object({agentId:z.string(),spendingCap:z.string(),currency:z.string().default("USD"),expiresAt:z.string()});
export async function GET(){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});return NextResponse.json(await prisma.consent.findMany({where:{userId:user.id},include:{agent:true,policies:true},orderBy:{createdAt:"desc"}}));}
export async function POST(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});try{const b=schema.parse(await request.json());const agent=await prisma.agent.findFirst({where:{id:b.agentId,userId:user.id}});if(!agent)return NextResponse.json({error:"Agent not found in this account."},{status:404});const cap=money(b.spendingCap);const code=currency(b.currency);const expiresAt=new Date(b.expiresAt);if(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date())return NextResponse.json({error:"Consent expiry must be in the future."},{status:400});const consent=await prisma.consent.create({data:{userId:user.id,agentId:agent.id,spendingCap:cap,currency:code,expiresAt}});await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"CONSENT_CREATED",entityType:"Consent",entityId:consent.id,outcome:"SUCCESS"});return NextResponse.json(consent,{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid consent."},{status:400});}}
