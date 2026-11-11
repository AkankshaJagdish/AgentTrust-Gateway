import { NextResponse } from "next/server";
import { authorizePayPalOrder } from "@/lib/paypal";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
export async function GET(request:Request){
  const url=new URL(request.url),token=url.searchParams.get("token");
  const redirect=(state:string)=>NextResponse.redirect(new URL(`/dashboard?payment=${state}`,url.origin));
  if(!token)return redirect("missing-token");
  try{
    const order=await prisma.paymentOrder.findUnique({where:{paypalOrderId:token},include:{agent:{include:{consents:true}}}});
    if(!order)return redirect("unknown-order");
    const consent=await prisma.consent.findFirst({where:{agentId:order.agentId,userId:order.agent.userId??"",status:"ACTIVE",expiresAt:{gt:new Date()},currency:order.currency}});
    if(!consent || order.amount.gt(consent.spendingCap))return redirect("consent-revoked");
    const decision=await prisma.agentRequest.findUnique({where:{requestId:order.agentRequestId}});
    if(!decision||decision.decision!=="ALLOW")return redirect("policy-blocked");
    await authorizePayPalOrder(token);
    await audit({actorType:"PAYPAL",action:"ORDER_AUTHORIZED",entityType:"PaymentOrder",entityId:order.id,outcome:"AUTHORIZED"});
    return redirect("authorized");
  }catch{return redirect("error");}
}
