import { formatUsd } from "@agentspend/core";
import { ApiError } from "./api";
import { randomId } from "./crypto";
import { execute, now, query, queryOne } from "./db";
import { appConfig } from "./config";
import { merchantSummary, merchantPayments } from "./payments";
import { paymentView } from "./views";
import {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  webhookTest,
} from "./webhooks";

export interface MerchantRequestRow {
  id: string;
  merchant_id: string;
  service_id: string;
  amount: string;
  asset: string;
  network: string;
  status: string;
  payment_id: string | null;
  idempotency_key: string;
  request_expiry: number;
  created_at: number;
  paid_at: number | null;
}

export function merchantRequestView(row: MerchantRequestRow): {
  id: string;
  serviceId: string;
  amount: string;
  amountUsd: string;
  asset: string;
  network: string;
  status: string;
  paymentId: string | null;
  requestExpiry: number;
  createdAt: number;
  paidAt: number | null;
} {
  return {
    id: row.id,
    serviceId: row.service_id,
    amount: row.amount,
    amountUsd: formatUsd(BigInt(row.amount)),
    asset: row.asset,
    network: row.network,
    status: row.status,
    paymentId: row.payment_id,
    requestExpiry: row.request_expiry,
    createdAt: row.created_at,
    paidAt: row.paid_at,
  };
}

export async function createMerchantRequest(input: {
  merchantId: string;
  serviceId: string;
  idempotencyKey: string;
  requestExpiry?: number;
}): Promise<{ request: MerchantRequestRow; replayed: boolean }> {
  const key = input.idempotencyKey.trim();
  if (!key || key.length > appConfig.limits.maxIdempotencyKeyLength) {
    throw new ApiError(400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 1-128 characters.");
  }
  const existing = await queryOne<MerchantRequestRow>(
    "SELECT * FROM merchant_requests WHERE merchant_id = ? AND idempotency_key = ?",
    [input.merchantId, key],
  );
  if (existing) return { request: existing, replayed: true };

  const service = await queryOne<{
    id: string;
    price: string;
    asset: string;
    network: string;
  }>("SELECT * FROM merchant_services WHERE id = ? AND merchant_id = ? AND active = 1", [
    input.serviceId,
    input.merchantId,
  ]);
  if (!service) {
    throw new ApiError(404, "SERVICE_NOT_FOUND", "Service not found for this merchant.");
  }
  const requestExpiry = input.requestExpiry ?? now() + appConfig.paymentRequestTtlMs;
  if (requestExpiry <= now()) {
    throw new ApiError(400, "REQUEST_EXPIRED", "request_expiry must be in the future.");
  }
  if (requestExpiry > now() + appConfig.maxPaymentRequestTtlMs) {
    throw new ApiError(
      400,
      "REQUEST_EXPIRY_TOO_FAR",
      "request_expiry may be at most one hour in the future.",
    );
  }
  const id = randomId("mreq_");
  const inserted = await execute(
    `INSERT INTO merchant_requests (id, merchant_id, service_id, amount, asset, network,
      status, idempotency_key, request_expiry, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
     ON CONFLICT(merchant_id, idempotency_key) DO NOTHING`,
    [
      id,
      input.merchantId,
      service.id,
      service.price,
      service.asset,
      service.network,
      key,
      requestExpiry,
      now(),
    ],
  );
  if (inserted === 0) {
    const raced = await queryOne<MerchantRequestRow>(
      "SELECT * FROM merchant_requests WHERE merchant_id = ? AND idempotency_key = ?",
      [input.merchantId, key],
    );
    if (!raced) throw new Error("merchant request insert conflicted but no row exists");
    return { request: raced, replayed: true };
  }
  const row = await queryOne<MerchantRequestRow>("SELECT * FROM merchant_requests WHERE id = ?", [
    id,
  ]);
  if (!row) throw new Error("merchant request disappeared after insert");
  return { request: row, replayed: false };
}

export async function getMerchantRequest(
  merchantId: string,
  requestId: string,
): Promise<MerchantRequestRow | null> {
  return queryOne<MerchantRequestRow>(
    "SELECT * FROM merchant_requests WHERE id = ? AND merchant_id = ?",
    [requestId, merchantId],
  );
}

export async function listMerchantRequests(
  merchantId: string,
  limit = 25,
): Promise<MerchantRequestRow[]> {
  return query<MerchantRequestRow>(
    "SELECT * FROM merchant_requests WHERE merchant_id = ? ORDER BY created_at DESC LIMIT ?",
    [merchantId, limit],
  );
}

export async function createMerchantService(input: {
  merchantId: string;
  name: string;
  description: string;
  price: string;
}): Promise<{ id: string; name: string; price: string }> {
  const name = input.name.trim();
  if (name.length < 2 || name.length > 64) {
    throw new ApiError(400, "INVALID_SERVICE", "Service name must be 2-64 characters.");
  }
  if (!/^\d{1,24}$/.test(input.price) || BigInt(input.price) <= 0n) {
    throw new ApiError(400, "INVALID_AMOUNT", "Price must be a positive integer in base units.");
  }
  const id = randomId("svc_");
  await execute(
    `INSERT INTO merchant_services (id, merchant_id, name, description, price, asset, network, active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    [
      id,
      input.merchantId,
      name,
      input.description.trim().slice(0, 240),
      input.price,
      appConfig.token.symbol,
      appConfig.network,
      now(),
    ],
  );
  return { id, name, price: input.price };
}

export async function merchantDashboard(merchantId: string): Promise<{
  summary: {
    gross: string;
    merchantFee: string;
    net: string;
    count: number;
    grossUsd: string;
    merchantFeeUsd: string;
    netUsd: string;
  };
  services: Array<{
    id: string;
    name: string;
    description: string;
    price: string;
    priceUsd: string;
    asset: string;
    network: string;
  }>;
  payments: Awaited<ReturnType<typeof paymentView>>[];
  requests: ReturnType<typeof merchantRequestView>[];
  webhooks: Awaited<ReturnType<typeof listWebhookEndpoints>>;
  deliveries: Awaited<ReturnType<typeof listWebhookDeliveries>>;
}> {
  const summary = await merchantSummary(merchantId);
  const services = await query<{
    id: string;
    name: string;
    description: string;
    price: string;
    asset: string;
    network: string;
  }>("SELECT * FROM merchant_services WHERE merchant_id = ? AND active = 1 ORDER BY created_at", [
    merchantId,
  ]);
  const payments = await merchantPayments(merchantId, 50);
  return {
    summary: {
      gross: summary.gross.toString(),
      merchantFee: summary.merchantFee.toString(),
      net: summary.net.toString(),
      count: summary.count,
      grossUsd: formatUsd(summary.gross),
      merchantFeeUsd: formatUsd(summary.merchantFee),
      netUsd: formatUsd(summary.net),
    },
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      price: service.price,
      priceUsd: formatUsd(BigInt(service.price)),
      asset: service.asset,
      network: service.network,
    })),
    payments: await Promise.all(payments.map(paymentView)),
    requests: (await listMerchantRequests(merchantId)).map(merchantRequestView),
    webhooks: await listWebhookEndpoints(merchantId),
    deliveries: await listWebhookDeliveries(merchantId, 25),
  };
}

export {
  createWebhookEndpoint,
  deactivateWebhookEndpoint,
  listWebhookDeliveries,
  listWebhookEndpoints,
  webhookTest,
};
