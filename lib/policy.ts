import "server-only";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { currency, money } from "@/lib/money";

export type PolicyInput = { agentId: string; amount: string; currency: string; requestId?: string };
export type PolicyResult = { decision: "ALLOW" | "BLOCK" | "REQUIRE_APPROVAL"; reason: string; consentId?: string; policyId?: string };
export async function evaluatePolicy(input: PolicyInput): Promise<PolicyResult> {
  let amount: Decimal;
  let code: string;
  try { amount = money(input.amount); code = currency(input.currency); }
  catch (error) { return { decision: "BLOCK", reason: error instanceof Error ? error.message : "Invalid amount or currency." }; }
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || agent.status !== "ACTIVE") return { decision: "BLOCK", reason: "The agent is not active." };
  const now = new Date();
  const consent = await prisma.consent.findFirst({
    where: { agentId: agent.id, status: "ACTIVE", expiresAt: { gt: now }, currency: code },
    orderBy: { createdAt: "desc" },
    include: { policies: { where: { enabled: true }, orderBy: { createdAt: "desc" } } },
  });
  if (!consent) return { decision: "BLOCK", reason: "No active, unexpired human consent exists for this agent and currency." };
  if (amount.gt(consent.spendingCap)) return { decision: "BLOCK", reason: `Requested ${code} ${amount.toFixed(2)} exceeds the human consent cap of ${consent.spendingCap.toFixed(2)}.`, consentId: consent.id };
  const policy = consent.policies.find(p => p.currency === code && (!p.expiresAt || p.expiresAt > now));
  if (!policy) return { decision: "REQUIRE_APPROVAL", reason: "Human consent is valid, but no active spending policy is attached. Merchant approval is required.", consentId: consent.id };
  if (amount.gt(policy.maxPerTx)) return { decision: "BLOCK", reason: `Requested amount exceeds the per-transaction limit of ${policy.maxPerTx.toFixed(2)} ${code}.`, consentId: consent.id, policyId: policy.id };
  const dayStart = new Date(now); dayStart.setUTCHours(0,0,0,0);
  const spent = await prisma.agentRequest.aggregate({
    where: { agentId: agent.id, consentId: consent.id, decision: "ALLOW", createdAt: { gte: dayStart }, currency: code },
    _sum: { amount: true },
  });
  const used = new Decimal(spent._sum.amount?.toString() ?? "0");
  if (used.plus(amount).gt(policy.dailyCap)) return { decision: "BLOCK", reason: `This request would exceed the daily spending limit of ${policy.dailyCap.toFixed(2)} ${code}.`, consentId: consent.id, policyId: policy.id };
  if (policy.requireApprovalAbove && amount.gte(policy.requireApprovalAbove)) return { decision: "REQUIRE_APPROVAL", reason: `Amounts at or above ${policy.requireApprovalAbove.toFixed(2)} ${code} require explicit merchant approval.`, consentId: consent.id, policyId: policy.id };
  return { decision: "ALLOW", reason: `Agent is active, human consent is valid, and ${code} ${amount.toFixed(2)} is within transaction and daily limits.`, consentId: consent.id, policyId: policy.id };
}
