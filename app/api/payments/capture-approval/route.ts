import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { createCaptureApproval } from "@/lib/paypal";
const schema=z.object({orderId:z.string(),authorizationId:z.string(),amount:z.string(),currency:z.string().length(3),reason:z.string().max(300).optional()});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const body=schema.parse(await request.json());
  const approval=await createCaptureApproval({orderId:body.orderId,authorizationId:body.authorizationId,userId:user.id,merchantId:user.id,amount:body.amount,currency:body.currency,reason:body.reason});
  return NextResponse.json({approvalId:approval.id,amount:approval.approvedAmount.toString(),currency:approval.currency,expiresAt:approval.expiresAt},{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Capture approval rejected."},{status:400});}
}
