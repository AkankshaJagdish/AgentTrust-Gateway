import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { enrollAgent } from "@/lib/agent-enrollment";
const schema=z.object({name:z.string().min(2).max(80)});
export async function POST(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Merchant authentication required."},{status:401});try{const body=schema.parse(await request.json());const result=await enrollAgent({userId:user.id,name:body.name});return NextResponse.json({agent:{id:result.agent.id,name:result.agent.name},keyId:result.keyId,secret:result.secret,signingAlgorithm:"HMAC-SHA256",signedPayload:"METHOD\\nPATH\\nTIMESTAMP\\nNONCE\\nSHA256(rawBody)",note:"The secret is shown once. Use it as the HMAC-SHA256 key for requests signed by this agent."},{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid request."},{status:400});}}
