import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
export async function GET(){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const orders=await prisma.paymentOrder.findMany({where:{merchantId:user.id},include:{agent:true,authorizations:true,captures:true,agentRequest:true,transitions:{orderBy:{createdAt:"asc"}}},orderBy:{createdAt:"desc"}});
 return NextResponse.json(orders);
}
