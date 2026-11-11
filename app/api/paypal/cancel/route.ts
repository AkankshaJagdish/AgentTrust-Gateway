import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { markOrderStatus } from "@/lib/paypal";
import { audit } from "@/lib/audit";
export async function GET(request:Request){
 const url=new URL(request.url),orderId=url.searchParams.get("token"),user=await currentUser();
 if(orderId){
  const order=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
  if(order&&user?.id===order.merchantId){
   await markOrderStatus(orderId,"CANCELLED","BUYER_CANCELLED",orderId,"Buyer cancelled PayPal approval.");
   await audit({userId:user.id,actorType:"PAYPAL",action:"BUYER_CANCELLED_ORDER",entityType:"PaymentOrder",entityId:order.id,outcome:"CANCELLED"});
  }
 }
 return NextResponse.redirect(new URL("/dashboard?payment=cancelled",url.origin));
}
