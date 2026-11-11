import { NextResponse } from "next/server";
import { authorizePayPalOrder, getPayPalOrder, markOrderStatus, PayPalError } from "@/lib/paypal";
import { currentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
export async function GET(request:Request){
 const url=new URL(request.url),orderId=url.searchParams.get("token");
 const user=await currentUser();
 const redirect=(state:string)=>NextResponse.redirect(new URL(`/dashboard?payment=${state}`,url.origin));
 if(!orderId)return redirect("missing-token");
 if(!user)return NextResponse.redirect(new URL(`/login?returnTo=${encodeURIComponent(url.pathname+url.search)}`,url.origin));
 try{
  const payment=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId},include:{agent:true,agentRequest:true}});
  if(!payment||payment.merchantId!==user.id||payment.agent.userId!==user.id)return redirect("unknown-order");
  if(!payment.agentRequest.signatureValid||payment.agentRequest.decision!=="ALLOW")return redirect("policy-blocked");
  const consent=await prisma.consent.findFirst({where:{id:payment.agentRequest.consentId??undefined,userId:user.id,agentId:payment.agentId,status:"ACTIVE",expiresAt:{gt:new Date()},currency:payment.currency}});
  const policy=await prisma.spendingPolicy.findFirst({where:{id:payment.agentRequest.policyId??undefined,userId:user.id,enabled:true,currency:payment.currency,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]}});
  if(!consent||!policy||payment.amount.gt(consent.spendingCap)||payment.amount.gt(policy.maxPerTx))return redirect("consent-or-policy-invalid");
  const state=await getPayPalOrder(orderId);
  if(state.status!=="APPROVED")return redirect("not-approved");
  const auth=await authorizePayPalOrder(orderId,user.id);
  await audit({userId:user.id,actorType:"PAYPAL",action:"BUYER_APPROVED_ORDER_AUTHORIZED",entityType:"PaymentOrder",entityId:payment.id,outcome:"AUTHORIZED",metadata:{authorizationId:auth?.paypalAuthorizationId??auth?.id}});
  return redirect("authorized");
 }catch(error){
  const payment=await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
  if(payment)await markOrderStatus(orderId,"FAILED","PAYPAL_RETURN",undefined,error instanceof Error?error.message:"Authorization failed").catch(()=>undefined);
  await audit({userId:user.id,actorType:"PAYPAL",action:"ORDER_AUTHORIZATION_FAILED",entityType:"PaymentOrder",entityId:payment?.id,outcome:"FAILED",reason:error instanceof Error?error.message:"Authorization failed"}).catch(()=>undefined);
  return redirect(error instanceof PayPalError?"authorization-failed":"error");
 }
}
