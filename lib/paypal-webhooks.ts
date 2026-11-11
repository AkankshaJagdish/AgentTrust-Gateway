import "server-only";
import { getPayPalAccessToken, markOrderStatus, PayPalError, getPayPalOrder } from "@/lib/paypal";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

type WebhookHeaders = {
  transmissionId: string | null;
  transmissionTime: string | null;
  transmissionSig: string | null;
  certUrl: string | null;
  authAlgo: string | null;
};
type PayPalWebhook = {
  id: string;
  event_type: string;
  summary?: string;
  resource?: { id?: string; status?: string; amount?: { value?: string; currency_code?: string }; supplementary_data?: { related_ids?: { order_id?: string } }; [key:string]: unknown };
};
const trustedCertHosts = new Set(["api.paypal.com","api.sandbox.paypal.com","api-m.paypal.com","api-m.sandbox.paypal.com"]);
const recentCertificates = new Map<string,{pem:string;expiresAt:number}>();

function webhookId() {
  const id=process.env.PAYPAL_WEBHOOK_ID;
  if(!id)throw new PayPalError("PAYPAL_WEBHOOK_ID is required to verify PayPal notifications.");
  return id;
}
function validateCertUrl(value:string) {
  const url=new URL(value);
  if(url.protocol!=="https:"||!trustedCertHosts.has(url.hostname)||!url.pathname.startsWith("/v1/notifications/certs/")) {
    throw new PayPalError("PayPal certificate URL is not a trusted PayPal certificate endpoint.");
  }
  return url;
}
async function certificate(urlValue:string) {
  const url=validateCertUrl(urlValue);
  const cached=recentCertificates.get(url.href);
  if(cached&&cached.expiresAt>Date.now())return cached.pem;
  const response=await fetch(url,{headers:{Accept:"application/x-pem-file, application/octet-stream"},cache:"no-store"});
  if(!response.ok)throw new PayPalError("Unable to retrieve PayPal webhook certificate.",response.status);
  const pem=await response.text();
  if(!pem.includes("-----BEGIN CERTIFICATE-----")||!pem.includes("-----END CERTIFICATE-----"))throw new PayPalError("PayPal certificate response was not a PEM certificate.");
  recentCertificates.set(url.href,{pem,expiresAt:Date.now()+6*60*60*1000});
  return pem;
}

export async function verifyPayPalWebhook(headers:WebhookHeaders,rawBody:string):Promise<boolean> {
  const id=webhookId();
  if(!headers.transmissionId||!headers.transmissionTime||!headers.transmissionSig||!headers.certUrl||!headers.authAlgo)return false;
  if(headers.authAlgo!=="SHA256withRSA")return false;
  const timestamp=Date.parse(headers.transmissionTime);
  if(!Number.isFinite(timestamp)||Math.abs(Date.now()-timestamp)>5*60*1000)return false;
  const token=await getPayPalAccessToken();
  const verification=await fetch(`${process.env.PAYPAL_ENVIRONMENT==="LIVE"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com"}/v1/notifications/verify-webhook-signature`,{
    method:"POST",
    headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify({
      auth_algo:headers.authAlgo,
      cert_url:headers.certUrl,
      transmission_id:headers.transmissionId,
      transmission_sig:headers.transmissionSig,
      transmission_time:headers.transmissionTime,
      webhook_id:id,
      webhook_event:JSON.parse(rawBody),
    }),
    cache:"no-store",
  });
  if(!verification.ok)return false;
  const result=await verification.json() as {verification_status?:string};
  return result.verification_status==="SUCCESS";
}

function relatedOrderId(event:PayPalWebhook):string|undefined {
  const resource=event.resource;
  const rel=resource?.supplementary_data?.related_ids?.order_id;
  if(typeof rel==="string")return rel;
  const maybe=resource?.links;
  if(Array.isArray(maybe)){
    const item=maybe.find((x:any)=>x?.rel==="up"&&typeof x.href==="string");
    if(item){const match=String(item.href).match(/\/v2\/checkout\/orders\/([^/?]+)/);if(match)return decodeURIComponent(match[1]);}
  }
  return undefined;
}

export async function receivePayPalWebhook(headers:WebhookHeaders,rawBody:string) {
  const verified=await verifyPayPalWebhook(headers,rawBody);
  if(!verified)throw new PayPalError("PayPal webhook signature verification failed.",401);
  const event=JSON.parse(rawBody) as PayPalWebhook;
  if(!event.id||!event.event_type)throw new PayPalError("PayPal webhook payload is missing its event ID or event type.",400);
  const existing=await prisma.paymentEvent.findUnique({where:{paypalEventId:event.id}});
  if(existing)return {duplicate:true,eventId:event.id};
  const orderId=relatedOrderId(event);
  const order=orderId?await prisma.paymentOrder.findUnique({where:{paypalOrderId:orderId}}):null;
  const eventRecord=await prisma.paymentEvent.create({data:{
    paypalEventId:event.id,eventType:event.event_type,resourceId:event.resource?.id,
    resourceType:event.event_type.split(".")[0],summary:event.summary,rawBody,
    verifiedAt:new Date(),paymentOrderId:order?.id,
  }}).catch(async error=>{
    const duplicate=await prisma.paymentEvent.findUnique({where:{paypalEventId:event.id}});
    if(duplicate)return null;
    throw error;
  });
  if(!eventRecord)return {duplicate:true,eventId:event.id};
  try{
    if(orderId&&order){
      const type=event.event_type;
      if(type==="CHECKOUT.ORDER.APPROVED"&&order.status==="CREATED"){
        // Event receipt is only a signal. Confirm live PayPal state before marking buyer approval.
        const liveOrder=await getPayPalOrder(orderId);
        if(liveOrder.status==="APPROVED")await markOrderStatus(orderId,"APPROVED","PAYPAL_WEBHOOK_RECONCILED",event.id);
      }else if(type==="CHECKOUT.PAYMENT-APPROVAL.REVERSED"){
        await markOrderStatus(orderId,"FAILED","PAYPAL_WEBHOOK",event.id,"Buyer/payment approval was reversed.");
      }else if(type==="PAYMENT.AUTHORIZATION.CREATED"&&event.resource?.id){
        // Keep the event for reconciliation; never use webhook receipt as buyer consent or capture consent.
        await audit({actorType:"PAYPAL_WEBHOOK",action:"AUTHORIZATION_EVENT_RECEIVED",entityType:"PaymentOrder",entityId:order.id,outcome:"RECEIVED",metadata:{eventId:event.id,authorizationId:event.resource.id}});
      }else if(type==="PAYMENT.AUTHORIZATION.VOIDED"){
        const authorization=event.resource?.id?await prisma.paymentAuthorization.findUnique({where:{paypalAuthorizationId:event.resource.id}}):null;
        if(authorization&&authorization.paymentOrderId===order.id&&order.status==="AUTHORIZED"){
          await prisma.paymentAuthorization.update({where:{id:authorization.id},data:{status:"VOIDED"}});
          await markOrderStatus(orderId,"VOIDED","PAYPAL_WEBHOOK",event.id);
        }
      }else if(type==="PAYMENT.CAPTURE.COMPLETED"){
        await markOrderStatus(orderId,"CAPTURED","PAYPAL_WEBHOOK",event.id);
        const capture=event.resource;
        if(capture?.id&&capture.amount?.value&&capture.amount.currency_code){
          const authorizationId=typeof (capture as any).processor_response?.authorization_id==="string"?(capture as any).processor_response.authorization_id:undefined;
          const authorization=authorizationId?await prisma.paymentAuthorization.findUnique({where:{paypalAuthorizationId:authorizationId}}):null;
          await prisma.paymentCapture.upsert({
            where:{paypalCaptureId:capture.id},
            create:{paymentOrderId:order.id,authorizationId:authorization?.id,paypalCaptureId:capture.id,status:"COMPLETED",amount:capture.amount.value,currency:capture.amount.currency_code},
            update:{status:"COMPLETED",authorizationId:authorization?.id},
          });
        }
      }else if(type==="PAYMENT.CAPTURE.PENDING"){
        if(order.status==="AUTHORIZED")await markOrderStatus(orderId,"PENDING","PAYPAL_WEBHOOK",event.id);
      }else if(type==="PAYMENT.CAPTURE.DENIED"){
        if(order.status==="AUTHORIZED"||order.status==="PENDING")await markOrderStatus(orderId,"FAILED","PAYPAL_WEBHOOK",event.id,"PayPal reports that the capture was denied.");
      }else if(type==="PAYMENT.CAPTURE.REFUNDED"){
        await audit({actorType:"PAYPAL_WEBHOOK",action:"CAPTURE_REFUNDED_EVENT",entityType:"PaymentOrder",entityId:order.id,outcome:"REFUNDED",metadata:{eventId:event.id}});
      }
    }
    await prisma.paymentEvent.update({where:{id:eventRecord.id},data:{processedAt:new Date()}});
    await audit({actorType:"PAYPAL_WEBHOOK",action:"PAYPAL_WEBHOOK_PROCESSED",entityType:"PaymentEvent",entityId:eventRecord.id,outcome:"VERIFIED",metadata:{eventId:event.id,eventType:event.event_type,paymentOrderId:order?.id}});
    return {duplicate:false,eventId:event.id,processed:true};
  }catch(error){
    await prisma.paymentEvent.update({where:{id:eventRecord.id},data:{processingError:error instanceof Error?error.message:"Webhook processing failed."}});
    await audit({actorType:"PAYPAL_WEBHOOK",action:"PAYPAL_WEBHOOK_PROCESSING_FAILED",entityType:"PaymentEvent",entityId:eventRecord.id,outcome:"FAILED",reason:error instanceof Error?error.message:"Webhook processing failed."});
    throw error;
  }
}
