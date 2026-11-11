import { NextResponse } from "next/server";
import { receivePayPalWebhook } from "@/lib/paypal-webhooks";
import { PayPalError } from "@/lib/paypal";
export const runtime="nodejs";
export async function POST(request:Request){
  // Preserve the exact bytes sent by PayPal. Do not parse and reserialize before verification.
  const rawBody=await request.text();
  try{
    const result=await receivePayPalWebhook({
      transmissionId:request.headers.get("paypal-transmission-id"),
      transmissionTime:request.headers.get("paypal-transmission-time"),
      transmissionSig:request.headers.get("paypal-transmission-sig"),
      certUrl:request.headers.get("paypal-cert-url"),
      authAlgo:request.headers.get("paypal-auth-algo"),
    },rawBody);
    return NextResponse.json({received:true,...result},{status:200});
  }catch(error){
    const status=error instanceof PayPalError?error.status??400:500;
    return NextResponse.json({error:error instanceof Error?error.message:"Webhook processing failed."},{status});
  }
}
