import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {id}=await params;const body=await request.json() as {status?:string;expiresAt?:string|null};
  if(body.status!==undefined&&!["ACTIVE","SUSPENDED","REVOKED"].includes(body.status))return NextResponse.json({error:"Invalid agent status."},{status:400});
  if(body.status===undefined&&body.expiresAt===undefined)return NextResponse.json({error:"Provide an agent status or expiry update."},{status:400});
  const agent=await prisma.agent.findFirst({where:{id,userId:user.id}});if(!agent)return NextResponse.json({error:"Agent not found."},{status:404});
  const expiresAt=body.expiresAt===undefined?agent.expiresAt:body.expiresAt?new Date(body.expiresAt):null;
  if(expiresAt&&(!Number.isFinite(expiresAt.getTime())||expiresAt<=new Date()))return NextResponse.json({error:"Agent expiry must be in the future."},{status:400});
  if(body.status==="ACTIVE"&&expiresAt&&expiresAt<=new Date())return NextResponse.json({error:"An expired agent cannot be activated."},{status:400});
  const updated=await prisma.agent.update({where:{id},data:{...(body.status?{status:body.status as "ACTIVE"|"SUSPENDED"|"REVOKED"}:{}),...(body.expiresAt!==undefined?{expiresAt}:{})}});
  if(body.status==="SUSPENDED")await prisma.agentCredential.updateMany({where:{agentId:id,revokedAt:null},data:{active:false}});
  if(body.status==="REVOKED")await prisma.agentCredential.updateMany({where:{agentId:id},data:{active:false,revokedAt:new Date()}});
  if(body.status==="ACTIVE")await prisma.agentCredential.updateMany({where:{agentId:id,revokedAt:null},data:{active:true}});
  await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"AGENT_STATUS_CHANGED",entityType:"Agent",entityId:id,outcome:"SUCCESS",metadata:{status:body.status,expiresAt:expiresAt?.toISOString()??null}});
  return NextResponse.json(updated);
}
