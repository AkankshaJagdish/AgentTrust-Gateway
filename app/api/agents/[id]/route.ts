import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const {id}=await params;const body=await request.json() as {status?:string};
  if(!["ACTIVE","SUSPENDED","REVOKED"].includes(body.status??""))return NextResponse.json({error:"Invalid agent status."},{status:400});
  const agent=await prisma.agent.findFirst({where:{id,userId:user.id}});if(!agent)return NextResponse.json({error:"Agent not found."},{status:404});
  const updated=await prisma.agent.update({where:{id},data:{status:body.status as "ACTIVE"|"SUSPENDED"|"REVOKED"}});
  if(body.status!=="ACTIVE")await prisma.agentCredential.updateMany({where:{agentId:id},data:{active:false,revokedAt:new Date()}});
  else await prisma.agentCredential.updateMany({where:{agentId:id,revokedAt:null},data:{active:true}});
  await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"AGENT_STATUS_CHANGED",entityType:"Agent",entityId:id,outcome:"SUCCESS",metadata:{status:body.status}});
  return NextResponse.json(updated);
}
