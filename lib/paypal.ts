import "server-only";
import { prisma } from "@/lib/prisma";
import { money } from "@/lib/money";

const base = () => process.env.PAYPAL_ENVIRONMENT === "LIVE" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
let cached: { token: string; expires: number } | undefined;
export class PayPalError extends Error { constructor(message: string, readonly status?: number) { super(message); } }
async function token() {
  if (cached && Date.now() < cached.expires) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PayPalError("PayPal credentials are not configured.");
  const response = await fetch(`${base()}/v1/oauth2/token`, { method:"POST", headers:{Authorization:`Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,"Content-Type":"application/x-www-form-urlencoded"}, body:"grant_type=client_credentials", cache:"no-store" });
  if (!response.ok) throw new PayPalError("PayPal OAuth failed.", response.status);
  const data = await response.json() as {access_token:string; expires_in:number};
  cached = {token:data.access_token, expires:Date.now() + Math.max(60,data.expires_in-120)*1000};
  return cached.token;
}
async function paypal<T>(path:string, init:RequestInit = {}): Promise<T> {
  const response = await fetch(`${base()}${path}`, { ...init, headers:{Authorization:`Bearer ${await token()}`,"Content-Type":"application/json",...(init.headers ?? {})}, cache:"no-store" });
  const data = await response.json().catch(()=>({}));
  if (!response.ok) throw new PayPalError("PayPal request failed: " + JSON.stringify(data).slice(0,300), response.status);
  return data as T;
}
export async function createPayPalOrder(input:{agentId:string;agentRequestId:string;amount:string;currency:string;returnUrl:string;cancelUrl:string}) {
  const amount = money(input.amount);
  const order = await paypal<{id:string;status:string;links?:{rel:string;href:string}[]}>("/v2/checkout/orders", {
    method:"POST", headers:{"PayPal-Request-Id":input.agentRequestId},
    body:JSON.stringify({intent:"AUTHORIZE",purchase_units:[{reference_id:input.agentRequestId,amount:{currency_code:input.currency,value:amount.toFixed(2)},custom_id:input.agentId}],payment_source:{paypal:{experience_context:{return_url:input.returnUrl,cancel_url:input.cancelUrl,user_action:"CONTINUE"}}}]})
  });
  const approvalUrl = order.links?.find(x=>x.rel==="payer-action" || x.rel==="approve")?.href ?? null;
  const payment = await prisma.paymentOrder.create({data:{agentId:input.agentId,agentRequestId:input.agentRequestId,paypalOrderId:order.id,status:"CREATED",amount,currency:input.currency,approvalUrl}});
  return { ...payment, paypalStatus:order.status, approvalUrl };
}
export async function authorizePayPalOrder(orderId:string) {
  const data = await paypal<{id:string;status:string;purchase_units?:{payments?:{authorizations?:{id:string;status:string;amount:{value:string;currency_code:string}}[]}}[]}>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`,{method:"POST",body:"{}"});
  const order = await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
  if (order) {
    const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
    await prisma.paymentOrder.update({where:{id:order.id},data:{status:"AUTHORIZED"}});
    if(auth) await prisma.paymentAuthorization.create({data:{paymentOrderId:order.id,paypalAuthorizationId:auth.id,status:auth.status,amount:money(auth.amount.value)}});
  }
  return data;
}
export async function captureAuthorization(authorizationId:string, orderId:string) {
  const data = await paypal<{id:string;status:string;amount:{value:string;currency_code:string}}>(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,{method:"POST",body:JSON.stringify({})});
  const order = await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}});
  if(order) {
    await prisma.paymentOrder.update({where:{id:order.id},data:{status:"CAPTURED"}});
    await prisma.paymentCapture.create({data:{paymentOrderId:order.id,paypalCaptureId:data.id,status:data.status,amount:money(data.amount.value)}});
  }
  return data;
}
