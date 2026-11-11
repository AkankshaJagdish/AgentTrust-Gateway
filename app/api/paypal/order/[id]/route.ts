import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getPayPalOrder, PayPalError } from "@/lib/paypal";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){
 const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const {id}=await params;
 const payment=await prisma.paymentOrder.findUnique({where:{paypalOrderId:id},include:{agent:true,authorizations:true,captures:true,transitions:{orderBy:{createdAt:"asc"}}}});
 if(!payment||payment.merchantId!==user.id)return NextResponse.json({error:"Order not found."},{status:404});
 try{const paypal=await getPayPalOrder(id);return NextResponse.json({payment,paypal});}
 catch(e){return NextResponse.json({error:e instanceof PayPalError?e.message:"Unable to retrieve PayPal order."},{status:502});}
}
