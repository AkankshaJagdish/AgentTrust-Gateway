import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
export async function DELETE(_request:Request,{params}:{params:Promise<{id:string}>}){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const {id}=await params;const consent=await prisma.consent.findFirst({where:{id,userId:user.id}});if(!consent)return NextResponse.json({error:"Consent not found."},{status:404});const revoked=await prisma.consent.update({where:{id},data:{status:"REVOKED",revokedAt:new Date()}});await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"CONSENT_REVOKED",entityType:"Consent",entityId:id,outcome:"SUCCESS"});return NextResponse.json(revoked);}
