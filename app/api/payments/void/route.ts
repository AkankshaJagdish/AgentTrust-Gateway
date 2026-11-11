import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { voidAuthorization } from "@/lib/paypal";
const schema=z.object({orderId:z.string(),authorizationId:z.string(),reason:z.string().max(300).optional()});
export async function POST(request:Request){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 try{
  const b=schema.parse(await request.json());
  return NextResponse.json(await voidAuthorization(b.orderId,b.authorizationId,user.id,b.reason));
 }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Void rejected."},{status:400});}
}
