import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(){
  const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
  const [agents,consents,policies,requests,orders,audits,verified,blocked,spent]=await Promise.all([
    prisma.agent.findMany({where:{userId:user.id},include:{_count:{select:{requests:true,orders:true}}},orderBy:{createdAt:"desc"}}),
    prisma.consent.findMany({where:{userId:user.id},include:{agent:true,policies:true},orderBy:{createdAt:"desc"}}),
    prisma.spendingPolicy.findMany({where:{userId:user.id},include:{consent:{include:{agent:true}}},orderBy:{createdAt:"desc"}}),
    prisma.agentRequest.findMany({where:{agent:{userId:user.id}},include:{agent:true},orderBy:{createdAt:"desc"},take:100}),
    prisma.paymentOrder.findMany({where:{agent:{userId:user.id}},include:{agent:true,authorizations:true,captures:true,agentRequest:true},orderBy:{createdAt:"desc"},take:100}),
    prisma.auditLog.findMany({where:{userId:user.id},orderBy:{createdAt:"desc"},take:100}),
    prisma.agentRequest.count({where:{agent:{userId:user.id},signatureValid:true}}),
    prisma.agentRequest.count({where:{agent:{userId:user.id},decision:"BLOCK"}}),
    prisma.paymentOrder.aggregate({where:{agent:{userId:user.id},status:"CAPTURED"},_sum:{amount:true}})
  ]);
  return NextResponse.json({agents,consents,policies,requests,orders,audits,stats:{agents:agents.length,verified,blocked,orders:orders.length,capturedValue:spent._sum.amount?.toString()??"0"}});
}
