import {describe,expect,it,vi,beforeEach} from "vitest";

const db={
  paymentEvent:{findUnique:vi.fn(),create:vi.fn(),update:vi.fn()},
  paymentOrder:{findUnique:vi.fn()},
  $transaction:vi.fn(),
};
vi.mock("@/lib/prisma",()=>({prisma:db}));
vi.mock("@/lib/audit",()=>({audit:vi.fn().mockResolvedValue({})}));
vi.mock("@/lib/paypal",()=>({getPayPalAccessToken:vi.fn().mockResolvedValue("sandbox-token"),markOrderStatus:vi.fn().mockResolvedValue({}),getPayPalOrder:vi.fn().mockResolvedValue({status:"APPROVED"})}));
import {receivePayPalWebhook} from "@/lib/paypal-webhooks";
describe("PayPal webhook handling",()=>{
 beforeEach(()=>{vi.clearAllMocks();process.env.PAYPAL_WEBHOOK_ID="sandbox-webhook-id";db.paymentEvent.findUnique.mockResolvedValue(null);db.paymentEvent.create.mockResolvedValue({id:"event-row-1"});db.paymentOrder.findUnique.mockResolvedValue(null);db.paymentEvent.update.mockResolvedValue({});global.fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>({verification_status:"SUCCESS"})}) as any;});
 const headers={transmissionId:"tx-123",transmissionTime:new Date().toISOString(),transmissionSig:"signature",certUrl:"https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-1",authAlgo:"SHA256withRSA"};
 const body=JSON.stringify({id:"WH-1",event_type:"CHECKOUT.ORDER.APPROVED",resource:{id:"ORDER-1"}});
 it("verifies exact raw body by posting the event to PayPal",async()=>{const result=await receivePayPalWebhook(headers,body);expect(result.duplicate).toBe(false);const call=(global.fetch as any).mock.calls[0];expect(String(call[0])).toContain("/v1/notifications/verify-webhook-signature");expect(JSON.parse(call[1].body).webhook_event).toEqual(JSON.parse(body));});
 it("does not process a duplicate PayPal event ID",async()=>{db.paymentEvent.findUnique.mockResolvedValue({id:"existing"});const result=await receivePayPalWebhook(headers,body);expect(result.duplicate).toBe(true);expect(db.paymentEvent.create).not.toHaveBeenCalled();});
 it("rejects an invalid PayPal signature",async()=>{(global.fetch as any).mockResolvedValue({ok:true,json:async()=>({verification_status:"FAILURE"})});await expect(receivePayPalWebhook(headers,body)).rejects.toThrow("signature verification failed");});
 it("rejects stale transmissions",async()=>{await expect(receivePayPalWebhook({...headers,transmissionTime:"2000-01-01T00:00:00Z"},body)).rejects.toThrow("signature verification failed");});
});
