import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { enrollAgent } from "@/lib/agent-enrollment";
import { prisma } from "@/lib/prisma";
const schema=z.object({name:z.string().min(2).max(80)});
export async function GET(){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});const agents=await prisma.agent.findMany({where:{userId:user.id},include:{_count:{select:{requests:true,orders:true}},consents:{where:{status:"ACTIVE"}}},orderBy:{createdAt:"desc"}});return NextResponse.json(agents);}
export async function POST(request:Request){const user=await currentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});try{const input=schema.parse(await request.json());const result=await enrollAgent({userId:user.id,name:input.name});return NextResponse.json(result,{status:201});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Invalid input"},{status:400});}}
