import { NextResponse } from "next/server";
import { signIn } from "@/lib/auth";
import { audit } from "@/lib/audit";
export async function POST(request:Request){try{const body=await request.json() as {email?:string;password?:string};if(!body.email||!body.password)return NextResponse.json({error:"Email and password are required."},{status:400});const user=await signIn(body.email,body.password);if(!user)return NextResponse.json({error:"Email or password is incorrect."},{status:401});await audit({userId:user.id,actorType:"USER",actorId:user.id,action:"USER_LOGIN",entityType:"User",entityId:user.id,outcome:"SUCCESS"});return NextResponse.json({id:user.id,email:user.email});}catch{return NextResponse.json({error:"Unable to sign in."},{status:400});}}
