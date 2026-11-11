import { prisma } from "@/lib/prisma";

export async function audit(input: {
  userId?: string; actorType: string; actorId?: string; action: string;
  entityType: string; entityId?: string; outcome: string; reason?: string;
  metadata?: unknown;
}) {
  return prisma.auditLog.create({ data: {
    userId: input.userId, actorType: input.actorType, actorId: input.actorId,
    action: input.action, entityType: input.entityType, entityId: input.entityId,
    outcome: input.outcome, reason: input.reason,
    metadata: input.metadata === undefined ? undefined : JSON.stringify(input.metadata),
  } });
}
