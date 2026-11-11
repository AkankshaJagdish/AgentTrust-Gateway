import "server-only";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { money, currency as normalizeCurrency } from "@/lib/money";
import type { PaymentStatus } from "@prisma/client";

const apiBase = () => process.env.PAYPAL_ENVIRONMENT === "LIVE"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";

type AccessToken = { value: string; expiresAt: number };
let tokenCache: AccessToken | undefined;
let tokenRefresh: Promise<string> | undefined;

export class PayPalError extends Error {
  constructor(message: string, readonly status?: number, readonly details?: unknown) {
    super(message);
    this.name = "PayPalError";
  }
}

export async function getPayPalAccessToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt) return tokenCache.value;
  if (tokenRefresh) return tokenRefresh;
  tokenRefresh = (async () => {
    const clientId = process.env.PAYPAL_CLIENT_ID;
    const secret = process.env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !secret) throw new PayPalError("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required.");
    const response = await fetch(`${apiBase()}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: "grant_type=client_credentials",
      cache: "no-store",
    });
    const data = await response.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!response.ok || !data.access_token) throw new PayPalError(data.error_description ?? "PayPal OAuth failed.", response.status, data);
    tokenCache = { value: data.access_token, expiresAt: Date.now() + Math.max(30, (data.expires_in ?? 300) - 120) * 1000 };
    return tokenCache.value;
  })();
  try { return await tokenRefresh; } finally { tokenRefresh = undefined; }
}

async function paypal<T>(path: string, options: { method?: string; body?: unknown; requestId?: string; prefer?: string } = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${await getPayPalAccessToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(options.requestId ? { "PayPal-Request-Id": options.requestId } : {}),
      ...(options.prefer ? { Prefer: options.prefer } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    cache: "no-store",
  });
  if (response.status === 204) return {} as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new PayPalError(`PayPal API ${response.status} at ${path}`, response.status, data);
  return data as T;
}

async function transition(input: {
  paymentOrderId: string; to: PaymentStatus; source: string; externalId?: string; idempotencyKey?: string; reason?: string;
}) {
  const order = await prisma.paymentOrder.findUnique({ where: { id: input.paymentOrderId } });
  if (!order) throw new PayPalError("Payment order was not found.");
  if (order.status === input.to) return order;
  return prisma.$transaction(async tx => {
    const updated = await tx.paymentOrder.update({ where: { id: order.id }, data: { status: input.to } });
    await tx.paymentStateTransition.create({ data: {
      paymentOrderId: order.id, fromStatus: order.status, toStatus: input.to,
      source: input.source, externalId: input.externalId, idempotencyKey: input.idempotencyKey, reason: input.reason,
    } });
    return updated;
  });
}

export async function createPayPalOrder(input: {
  agentId: string; agentRequestId: string; amount: string; currency: string;
  returnUrl: string; cancelUrl: string; merchantId: string;
}) {
  const amount = money(input.amount);
  const code = normalizeCurrency(input.currency);
  const existing = await prisma.paymentOrder.findUnique({ where: { agentRequestId: input.agentRequestId } });
  if (existing) return { ...existing, approvalUrl: existing.approvalUrl, paypalStatus: existing.status };
  const agent = await prisma.agent.findUnique({ where: { id: input.agentId } });
  if (!agent || agent.status !== "ACTIVE" || agent.userId !== input.merchantId) throw new PayPalError("Agent is inactive or does not belong to this merchant.");
  const request = await prisma.agentRequest.findUnique({ where: { requestId: input.agentRequestId } });
  if (!request || request.agentId !== agent.id || !request.signatureValid || request.decision !== "ALLOW") throw new PayPalError("A verified request with an ALLOW decision is required.");
  if (!request.amount || !money(request.amount.toString()).eq(amount) || request.currency !== code) throw new PayPalError("PayPal order amount/currency must match the allowed request.");
  const order = await paypal<{ id: string; status: string; links?: { rel: string; href: string }[] }>("/v2/checkout/orders", {
    method: "POST",
    requestId: input.agentRequestId,
    body: {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: input.agentRequestId,
        custom_id: input.agentId,
        payee: { merchant_id: input.merchantId },
        amount: { currency_code: code, value: amount.toFixed(2) },
      }],
      payment_source: { paypal: { experience_context: {
        return_url: input.returnUrl, cancel_url: input.cancelUrl, user_action: "CONTINUE",
      } } },
    },
  });
  const approvalUrl = order.links?.find(link => link.rel === "payer-action" || link.rel === "approve")?.href ?? null;
  if (!approvalUrl) throw new PayPalError("PayPal order was created but the approval link was not returned.");
  const payment = await prisma.paymentOrder.create({ data: {
    agentId: input.agentId, agentRequestId: input.agentRequestId, paypalOrderId: order.id,
    merchantId: input.merchantId, status: order.status === "APPROVED" ? "APPROVED" : "CREATED", amount, currency: code, approvalUrl,
  } });
  await prisma.paymentStateTransition.create({ data: {
    paymentOrderId: payment.id, toStatus: payment.status, source: "PAYPAL_CREATE", externalId: order.id,
    idempotencyKey: input.agentRequestId, reason: "PayPal sandbox AUTHORIZE order created.",
  } });
  await audit({ userId: input.merchantId, actorType: "PAYPAL", actorId: order.id, action: "PAYPAL_ORDER_CREATED", entityType: "PaymentOrder", entityId: payment.id, outcome: "CREATED", metadata: { currency: code, amount: amount.toFixed(2) } });
  return { ...payment, paypalStatus: order.status };
}

type PayPalOrderDetails = {
  id: string; status: string;
  purchase_units?: { reference_id?: string; custom_id?: string; payee?: { merchant_id?: string }; amount?: { currency_code: string; value: string }; payments?: { authorizations?: { id: string; status: string; amount: { currency_code: string; value: string } }[] } }[];
};
export async function getPayPalOrder(orderId: string) {
  return paypal<PayPalOrderDetails>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`);
}

export async function authorizePayPalOrder(orderId: string, merchantId: string) {
  const payment = await prisma.paymentOrder.findUnique({
    where: { paypalOrderId: orderId }, include: { agent: true, agentRequest: true },
  });
  if (!payment || payment.merchantId !== merchantId) throw new PayPalError("Order does not belong to this merchant.");
  if (payment.status === "AUTHORIZED" || payment.status === "CAPTURED") {
    const existing = await prisma.paymentAuthorization.findFirst({ where: { paymentOrderId: payment.id }, orderBy: { createdAt: "desc" } });
    if (!existing) throw new PayPalError("Authorized payment is missing its stored authorization ID.");
    return existing;
  }
  if (payment.status !== "APPROVED" && payment.status !== "CREATED") throw new PayPalError("Payment order is not eligible for authorization.");
  const agent = await prisma.agent.findUnique({ where: { id: payment.agentId } });
  if (!agent || agent.status !== "ACTIVE" || agent.userId !== merchantId) throw new PayPalError("Agent identity is no longer active or merchant-linked.");
  const consent = await prisma.consent.findFirst({ where: {
    id: payment.agentRequest.consentId ?? undefined, agentId: agent.id, userId: merchantId,
    status: "ACTIVE", expiresAt: { gt: new Date() }, currency: payment.currency,
  } });
  if (!consent || payment.amount.gt(consent.spendingCap)) throw new PayPalError("Human consent is expired, revoked, or insufficient.");
  if (payment.agentRequest.decision !== "ALLOW" || !payment.agentRequest.signatureValid) throw new PayPalError("The original request is not authorized.");
  const approved = await paypal<PayPalOrderDetails>(`/v2/checkout/orders/${encodeURIComponent(orderId)}`, {});
  if (approved.status !== "APPROVED") throw new PayPalError("PayPal has not marked this order APPROVED by the buyer.");
  const unit = approved.purchase_units?.[0];
  if (unit?.reference_id !== payment.agentRequestId || unit?.custom_id !== payment.agentId ||
      unit.amount?.currency_code !== payment.currency || !money(unit.amount.value).eq(payment.amount) ||
      (unit.payee?.merchant_id && unit.payee.merchant_id !== merchantId)) {
    throw new PayPalError("PayPal order association, payee, amount, or currency does not match the gateway record.");
  }
  if (payment.status === "CREATED") await transition({ paymentOrderId: payment.id, to: "APPROVED", source: "BUYER_RETURN", externalId: orderId });
  const data = await paypal<PayPalOrderDetails>(`/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {
    method: "POST", requestId: `authorize-${payment.agentRequestId}`, body: {},
  });
  const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new PayPalError("PayPal did not return an authorization resource.");
  if (auth.amount.currency_code !== payment.currency || !money(auth.amount.value).eq(payment.amount)) throw new PayPalError("Authorization amount/currency mismatch.");
  await prisma.$transaction(async tx => {
    await tx.paymentAuthorization.upsert({
      where: { paypalAuthorizationId: auth.id },
      create: { paymentOrderId: payment.id, paypalAuthorizationId: auth.id, status: auth.status, amount: money(auth.amount.value), currency: auth.amount.currency_code },
      update: { status: auth.status },
    });
    await tx.paymentOrder.update({ where: { id: payment.id }, data: { status: "AUTHORIZED" } });
    await tx.paymentStateTransition.create({ data: { paymentOrderId: payment.id, fromStatus: "APPROVED", toStatus: "AUTHORIZED", source: "PAYPAL_AUTHORIZE", externalId: auth.id, idempotencyKey: `authorize-${payment.agentRequestId}` } });
  });
  await audit({ userId: merchantId, actorType: "PAYPAL", actorId: auth.id, action: "PAYPAL_ORDER_AUTHORIZED", entityType: "PaymentOrder", entityId: payment.id, outcome: auth.status });
  return auth;
}

export async function createCaptureApproval(input: {
  orderId: string; authorizationId: string; userId: string; amount: string; currency: string; merchantId: string;
  reason?: string;
}) {
  const amount = money(input.amount), code = normalizeCurrency(input.currency), key = randomUUID();
  const [order, authorization, request] = await Promise.all([
    prisma.paymentOrder.findUnique({ where: { id: input.orderId }, include: { agent: true } }),
    prisma.paymentAuthorization.findUnique({ where: { paypalAuthorizationId: input.authorizationId } }),
    prisma.agentRequest.findFirst({ where: { order: { id: input.orderId } } }),
  ]);
  if (!order || !authorization || authorization.paymentOrderId !== order.id || !request) throw new PayPalError("Order/authorization association is invalid.");
  if (order.merchantId !== input.merchantId || order.agent.userId !== input.userId) throw new PayPalError("Merchant identity does not match the payment order.");
  if (order.status !== "AUTHORIZED" || authorization.status !== "CREATED" && authorization.status !== "AUTHORIZED") throw new PayPalError("Only an authorized, uncaptured payment can receive capture approval.");
  const agent = await prisma.agent.findUnique({ where: { id: order.agentId } });
  if (!agent || agent.status !== "ACTIVE" || agent.userId !== input.userId) throw new PayPalError("Agent identity is no longer active.");
  const consent = await prisma.consent.findFirst({ where: { id: request.consentId ?? undefined, agentId: agent.id, userId: input.userId, status: "ACTIVE", expiresAt: { gt: new Date() }, currency: code } });
  if (!consent) throw new PayPalError("Active human consent is required for capture.");
  const policy = await prisma.spendingPolicy.findFirst({ where: { id: request.policyId ?? undefined, userId: input.userId, enabled: true, currency: code, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  if (!policy) throw new PayPalError("The original spending policy is expired or inactive.");
  if (code !== order.currency || code !== authorization.currency) throw new PayPalError("Currency must match the original order and authorization.");
  if (!amount.eq(order.amount) || !amount.eq(authorization.amount) || amount.gt(consent.spendingCap) || amount.gt(policy.maxPerTx)) throw new PayPalError("Capture amount must exactly equal the authorized and consented amount and remain inside policy limits.");
  if (authorization.status === "CAPTURED" || authorization.status === "VOIDED") throw new PayPalError("Authorization is already terminal.");
  const approval = await prisma.captureApproval.create({ data: {
    paymentOrderId: order.id, authorizationId: authorization.id, userId: input.userId,
    approvedAmount: amount, currency: code, merchantId: input.merchantId,
    expiresAt: new Date(Date.now() + 10 * 60_000), idempotencyKey: key,
    consentId: consent.id, policyId: policy.id, reason: input.reason,
  } });
  await audit({ userId: input.userId, actorType: "USER", actorId: input.userId, action: "CAPTURE_APPROVAL_GRANTED", entityType: "CaptureApproval", entityId: approval.id, outcome: "APPROVED", metadata: { amount: amount.toFixed(2), currency: code, orderId: order.id } });
  return approval;
}

export async function captureWithApproval(input: { approvalId: string; userId: string; merchantId: string }) {
  const approval = await prisma.captureApproval.findUnique({
    where: { id: input.approvalId },
    include: { paymentOrder: { include: { agent: true, agentRequest: true } }, authorization: true },
  });
  if (!approval || approval.userId !== input.userId || approval.merchantId !== input.merchantId) throw new PayPalError("Capture approval is invalid.");
  if (approval.consumedAt || approval.expiresAt <= new Date()) throw new PayPalError("Capture approval has expired or already been consumed.");
  const { paymentOrder: order, authorization } = approval;
  const agent = await prisma.agent.findUnique({ where: { id: order.agentId } });
  if (!agent || agent.status !== "ACTIVE" || agent.userId !== input.userId || order.merchantId !== input.merchantId) throw new PayPalError("Agent or merchant identity validation failed.");
  const consent = await prisma.consent.findFirst({ where: { id: approval.consentId, userId: input.userId, agentId: agent.id, status: "ACTIVE", expiresAt: { gt: new Date() }, currency: approval.currency } });
  const policy = await prisma.spendingPolicy.findFirst({ where: { id: approval.policyId, userId: input.userId, enabled: true, currency: approval.currency, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
  const request = order.agentRequest;
  if (!consent || !policy || !request.signatureValid || request.decision !== "ALLOW") throw new PayPalError("Consent, policy, or signed agent request is no longer valid.");
  if (order.status !== "AUTHORIZED" || authorization.paymentOrderId !== order.id ||
      !authorization.paypalAuthorizationId || !money(approval.approvedAmount.toString()).eq(order.amount) ||
      !money(approval.approvedAmount.toString()).eq(authorization.amount) ||
      approval.currency !== order.currency || authorization.currency !== order.currency ||
      approval.merchantId !== order.merchantId || request.agentId !== agent.id ||
      request.amount === null || !money(request.amount.toString()).eq(approval.approvedAmount)) {
    throw new PayPalError("Capture preconditions (order association, amount, currency, or merchant) failed.");
  }
  if (approval.approvedAmount.gt(consent.spendingCap) || approval.approvedAmount.gt(policy.maxPerTx)) throw new PayPalError("The capture amount exceeds the current spending caps.");
  const idem = `capture-${approval.idempotencyKey}`;
  const claimed = await prisma.captureApproval.updateMany({ where: { id: approval.id, consumedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
  if (claimed.count !== 1) throw new PayPalError("Capture approval was already consumed or expired.");
  let capture: { id: string; status: string; amount: { value: string; currency_code: string } };
  try {
    capture = await paypal<{ id: string; status: string; amount: { value: string; currency_code: string } }>(
      `/v2/payments/authorizations/${encodeURIComponent(authorization.paypalAuthorizationId)}/capture`,
      { method: "POST", requestId: idem, body: { final_capture: true } },
    );
  } catch (error) {
    await prisma.captureApproval.update({ where: { id: approval.id }, data: { consumedAt: null } }).catch(() => undefined);
    throw error;
  }
  if (capture.amount.currency_code !== order.currency || !money(capture.amount.value).eq(approval.approvedAmount)) throw new PayPalError("PayPal capture response amount/currency does not match capture approval.");
  await prisma.$transaction(async tx => {
    await tx.paymentCapture.upsert({
      where: { paypalCaptureId: capture.id },
      create: { paymentOrderId: order.id, authorizationId: authorization.id, paypalCaptureId: capture.id, status: capture.status, amount: money(capture.amount.value), currency: capture.amount.currency_code },
      update: { status: capture.status },
    });
    await tx.paymentAuthorization.update({ where: { id: authorization.id }, data: { status: capture.status === "COMPLETED" ? "CAPTURED" : capture.status } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: capture.status === "COMPLETED" ? "CAPTURED" : "PENDING" } });
    await tx.paymentStateTransition.create({ data: { paymentOrderId: order.id, fromStatus: "AUTHORIZED", toStatus: capture.status === "COMPLETED" ? "CAPTURED" : "PENDING", source: "HUMAN_APPROVED_CAPTURE", externalId: capture.id, idempotencyKey: idem } });
  });
  await audit({ userId: input.userId, actorType: "USER", actorId: input.userId, action: "PAYPAL_CAPTURE_SUBMITTED", entityType: "PaymentOrder", entityId: order.id, outcome: capture.status });
  return capture;
}

export async function voidAuthorization(orderId: string, authorizationId: string, merchantId: string, reason?: string) {
  const order = await prisma.paymentOrder.findUnique({ where: { paypalOrderId: orderId }, include: { authorizations: true, agent: true } });
  const auth = await prisma.paymentAuthorization.findUnique({ where: { paypalAuthorizationId: authorizationId } });
  if (!order || !auth || auth.paymentOrderId !== order.id || order.merchantId !== merchantId) throw new PayPalError("Authorization does not belong to this merchant/order.");
  if (order.status !== "AUTHORIZED" || !["CREATED", "AUTHORIZED"].includes(auth.status)) throw new PayPalError("Only an active uncaptured authorization can be voided.");
  await paypal(`/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { method: "POST", requestId: `void-${authorizationId}`, body: {} });
  await prisma.$transaction(async tx => {
    await tx.paymentAuthorization.update({ where: { id: auth.id }, data: { status: "VOIDED" } });
    await tx.paymentOrder.update({ where: { id: order.id }, data: { status: "VOIDED" } });
    await tx.paymentStateTransition.create({ data: { paymentOrderId: order.id, fromStatus: "AUTHORIZED", toStatus: "VOIDED", source: "MERCHANT_VOID", externalId: authorizationId, idempotencyKey: `void-${authorizationId}`, reason } });
  });
  await audit({ userId: merchantId, actorType: "USER", actorId: merchantId, action: "PAYPAL_AUTHORIZATION_VOIDED", entityType: "PaymentOrder", entityId: order.id, outcome: "VOIDED", reason });
  return { status: "VOIDED" };
}

export async function markOrderStatus(orderId: string, to: PaymentStatus, source: string, externalId?: string, reason?: string) {
  const order = await prisma.paymentOrder.findUnique({ where: { paypalOrderId: orderId } });
  if (!order) return null;
  return transition({ paymentOrderId: order.id, to, source, externalId, reason });
}
