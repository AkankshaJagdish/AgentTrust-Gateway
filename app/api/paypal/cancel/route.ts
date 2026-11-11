import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { markOrderStatus } from "@/lib/paypal";
import { audit } from "@/lib/audit";
export async function GET(request:Request){
 const url=new URL(request.url),orderId=url.searchParams.get("token"),returnToken=url.searchParams.get("return_token");
 if(orderId&&returnToken){
  const tokenHash=createHash("sha256").update(returnToken).digest("hex");
  const order=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
  if(order&&order.returnTokenHash===tokenHash&&!order.returnTokenConsumedAt&&order.returnTokenExpiresAt&&order.returnTokenExpiresAt>new Date()){
   const claimed=await prisma.paymentOrder.updateMany({where:{id:order.id,returnTokenConsumedAt:null,returnTokenExpiresAt:{gt:new Date()}},data:{returnTokenConsumedAt:new Date()}});
   if(claimed.count===1){
    await markOrderStatus(orderId,"CANCELLED","BUYER_CANCELLED",orderId,"Buyer cancelled PayPal approval.");
    await audit({userId:order.merchantId,actorType:"PAYPAL",action:"BUYER_CANCELLED_ORDER",entityType:"PaymentOrder",entityId:order.id,outcome:"CANCELLED"});
   }
  }
 }
 return NextResponse.redirect(new URL("/checkout/cancelled",url.origin));
}
