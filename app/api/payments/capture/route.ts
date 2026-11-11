import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { captureWithApproval } from "@/lib/paypal";
const schema=z.object({approvalId:z.string()});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const body=schema.parse(await request.json());
  const capture=await captureWithApproval({approvalId:body.approvalId,userId:user.id,merchantId:user.id});
  return NextResponse.json({captureId:capture.id,status:capture.status,amount:capture.amount,currency:capture.amount.currency_code},{status:201});
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Capture rejected."},{status:400});}
}
