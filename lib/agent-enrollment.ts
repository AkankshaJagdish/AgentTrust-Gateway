import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";

export async function enrollAgent(input:{userId?:string;name:string}) {
  const secret = randomBytes(32).toString("base64url");
  const agent = await prisma.agent.create({data:{name:input.name,userId:input.userId}});
  const keyId = `atg_${randomBytes(12).toString("hex")}`;
  await prisma.agentCredential.create({data:{agentId:agent.id,keyId,secretHash:createHash("sha256").update(secret).digest("hex")}});
  await audit({userId:input.userId,actorType:"MERCHANT",actorId:input.userId,action:"AGENT_REGISTERED",entityType:"Agent",entityId:agent.id,outcome:"SUCCESS"});
  // The clear secret is shown once to the registering merchant. It is never persisted.
  return {agent,keyId,secret};
}
