import { NextResponse } from "next/server";
import { authorizePayPalOrderFromBuyerReturn, markOrderStatus, PayPalError } from "@/lib/paypal";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";

export async function GET(request:Request) {
  const url=new URL(request.url);
  const orderId=url.searchParams.get("token");
  const returnToken=url.searchParams.get("return_token");
  const redirect=(state:string)=>NextResponse.redirect(new URL(state==="authorized"?`/dashboard?payment=${state}`:`/checkout/failed?payment=${state}`,url.origin));
  if(!orderId||!returnToken)return redirect("missing-return-token");
  try {
    const order=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
    if(!order)return redirect("unknown-order");
    const authorization=await authorizePayPalOrderFromBuyerReturn(orderId,returnToken);
    await audit({
      userId:order.merchantId,actorType:"PAYPAL",action:"BUYER_APPROVED_ORDER_AUTHORIZED",
      entityType:"PaymentOrder",entityId:order.id,outcome:"AUTHORIZED",
      metadata:{authorizationId:authorization?.paypalAuthorizationId??authorization?.id},
    });
    return redirect("authorized");
  } catch(error) {
    const payment=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
    const terminal=payment?.status==="CAPTURED"||payment?.status==="VOIDED";
    if(payment&&!terminal)await markOrderStatus(orderId,"FAILED","PAYPAL_RETURN",undefined,error instanceof Error?error.message:"Authorization failed").catch(()=>undefined);
    await audit({
      userId:payment?.merchantId,actorType:"PAYPAL",action:"ORDER_AUTHORIZATION_FAILED",
      entityType:"PaymentOrder",entityId:payment?.id,outcome:"FAILED",
      reason:error instanceof Error?error.message:"Authorization failed",
    }).catch(()=>undefined);
    return redirect(error instanceof PayPalError?"authorization-failed":"error");
  }
}
