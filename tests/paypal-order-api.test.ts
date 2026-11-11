import {describe,expect,it,vi,beforeEach} from "vitest";
const prisma={
 paymentOrder:{findUnique:vi.fn(),create:vi.fn()},
 agent:{findUnique:vi.fn()},
 agentRequest:{findUnique:vi.fn()},
 paymentStateTransition:{create:vi.fn()},
 $transaction:vi.fn(),
};
vi.mock("@/lib/prisma",()=>({prisma}));
vi.mock("@/lib/audit",()=>({audit:vi.fn().mockResolvedValue({})}));
import {createPayPalOrder} from "@/lib/paypal";
describe("PayPal order creation guards",()=>{
 beforeEach(()=>{vi.clearAllMocks();process.env.PAYPAL_ENVIRONMENT="SANDBOX";process.env.PAYPAL_CLIENT_ID="sandbox-client";process.env.PAYPAL_CLIENT_SECRET="sandbox-secret";prisma.paymentOrder.findUnique.mockResolvedValue(null);prisma.agent.findUnique.mockResolvedValue({id:"agent-1",status:"ACTIVE",userId:"merchant-1"});prisma.agentRequest.findUnique.mockResolvedValue({agentId:"agent-1",signatureValid:true,decision:"ALLOW",amount:{toString:()=>"12.50"},currency:"USD"});prisma.paymentOrder.create.mockResolvedValue({id:"db-order",paypalOrderId:"PAYPAL-ORDER",status:"CREATED",approvalUrl:"https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER"});prisma.paymentStateTransition.create.mockResolvedValue({});global.fetch=vi.fn().mockImplementation((url:string)=>String(url).includes("/oauth2/token")?Promise.resolve({ok:true,json:async()=>({access_token:"token",expires_in:3600})}):Promise.resolve({ok:true,json:async()=>({id:"PAYPAL-ORDER",status:"CREATED",links:[{rel:"payer-action",href:"https://www.sandbox.paypal.com/checkoutnow?token=PAYPAL-ORDER"}]})})) as any;});
 it("creates AUTHORIZE order and gives the approval URL",async()=>{const order=await createPayPalOrder({agentId:"agent-1",agentRequestId:"req-1",amount:"12.50",currency:"USD",merchantId:"merchant-1",returnUrl:"https://merchant.test/return",cancelUrl:"https://merchant.test/cancel"});expect(order.approvalUrl).toContain("sandbox.paypal.com");const call=(global.fetch as any).mock.calls.find((c:any[])=>String(c[0]).endsWith("/v2/checkout/orders"));expect(JSON.parse(call[1].body).intent).toBe("AUTHORIZE");});
 it("does not create order for inactive agent",async()=>{prisma.agent.findUnique.mockResolvedValue({id:"agent-1",status:"REVOKED",userId:"merchant-1"});await expect(createPayPalOrder({agentId:"agent-1",agentRequestId:"req-1",amount:"12.50",currency:"USD",merchantId:"merchant-1",returnUrl:"https://merchant.test/return",cancelUrl:"https://merchant.test/cancel"})).rejects.toThrow("inactive");});
 it("does not create order for unapproved request",async()=>{prisma.agentRequest.findUnique.mockResolvedValue({agentId:"agent-1",signatureValid:false,decision:"BLOCK",amount:{toString:()=>"12.50"},currency:"USD"});await expect(createPayPalOrder({agentId:"agent-1",agentRequestId:"req-1",amount:"12.50",currency:"USD",merchantId:"merchant-1",returnUrl:"https://merchant.test/return",cancelUrl:"https://merchant.test/cancel"})).rejects.toThrow("ALLOW");});
});
