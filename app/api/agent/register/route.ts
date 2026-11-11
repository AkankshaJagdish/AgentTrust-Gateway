import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { enrollAgent } from "@/lib/agent-enrollment";
const schema=z.object({name:z.string().min(2).max(80)});
export async function POST(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Merchant authentication required."},{status:401});try{const body=schema.parse(await request.json());const result=await enrollAgent({userId:user.id,name:body.name});return NextResponse.json({agent:{id:result.agent.id,name:result.agent.name},keyId:result.keyId,secret:result.secret,note:"Save this one-time secret securely. For current MVP request signing, configure the matching secret derivation in the agent client."},{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid request."},{status:400});}}
