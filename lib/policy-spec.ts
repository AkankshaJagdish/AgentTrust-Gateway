import { z } from "zod";
import Decimal from "decimal.js";
import { currency,money } from "@/lib/money";

export const PolicySpecSchema=z.object({
 name:z.string().min(2).max(80),summary:z.string().min(1),currency:z.string().length(3),
 maxPerTx:z.string().nullable(),dailyCap:z.string().nullable(),requireApprovalAbove:z.string().nullable(),
 requireVerifiedAgents:z.boolean(),blockExpiredAgents:z.boolean(),clarifications:z.array(z.string())
});
export type PolicySpec=z.infer<typeof PolicySpecSchema>;
export const RiskAssessmentSchema=z.object({
 level:z.enum(["LOW","MEDIUM","HIGH"]),summary:z.string(),
 factors:z.array(z.object({label:z.string(),impact:z.enum(["LOW","MEDIUM","HIGH"]),explanation:z.string()})),
 missingInformation:z.array(z.string()),recommendation:z.enum(["NO_ADDITIONAL_REVIEW","REVIEW"])
});
export type RiskAssessment=z.infer<typeof RiskAssessmentSchema>;
export function validatePolicySpec(spec:PolicySpec,consent:{currency:string;spendingCap:string}){
 const code=currency(spec.currency);
 if(code!==consent.currency)throw new Error("Policy currency must match the selected human consent.");
 if(!spec.requireVerifiedAgents||!spec.blockExpiredAgents)throw new Error("Verified-agent checks and expired-agent blocking are mandatory.");
 if(!spec.maxPerTx||!spec.dailyCap)throw new Error("A maximum transaction amount and daily budget are required before activation.");
 const maxPerTx=money(spec.maxPerTx),dailyCap=money(spec.dailyCap),cap=money(consent.spendingCap);
 if(!maxPerTx.gt(0)||!dailyCap.gt(0))throw new Error("Transaction and daily limits must be greater than zero.");
 if(maxPerTx.gt(cap)||dailyCap.gt(cap))throw new Error("Policy limits cannot exceed the human consent spending cap.");
 let threshold:Decimal|null=null;
 if(spec.requireApprovalAbove!==null){threshold=money(spec.requireApprovalAbove);if(!threshold.gt(0)||threshold.gt(maxPerTx))throw new Error("The human approval threshold must be positive and no greater than the per-transaction limit.");}
 return {currency:code,maxPerTx,dailyCap,requireApprovalAbove:threshold};
}

export function isAboveApprovalThreshold(amount:string,threshold:string) {
 return money(amount).gt(money(threshold));
}
