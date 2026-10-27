import { randomId, randomToken, webhookSignature } from "./crypto";
import { getDb, now } from "./db";

/**
 * Merchant webhooks are signed with HMAC-SHA256 over `<timestamp>.<body>`.
 * Delivery is disabled unless the operator sets AGENTSPEND_WEBHOOK_HOSTS to an
 * explicit allowlist. This is the SSRF control: the server never fetches an
 * arbitrary merchant-supplied URL by default.
 */

export interface WebhookEndpointRow {
  id: string;
  merchant_id: string;
  url: string;
  secret: string;
  active: number;
  created_at: number;
}

export interface WebhookDeliveryRow {
  id: string;
  endpoint_id: string;
  payment_id: string;
  event_id: string;
  event_type: string;
  payload: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: number;
  delivered_at: number | null;
}

export interface EmitEventInput {
  merchantId: string;
  paymentId: string;
  eventType: string;
  data: Record<string, unknown>;
}

export function webhookPayload(input: EmitEventInput, eventId: string): string {
  return JSON.stringify({
    id: eventId,
    type: input.eventType,
    api_version: "2026-10-25",
    created: Math.floor(now() / 1000),
    livemode: false,
    rail: "testnet",
    data: input.data,
  });
}

/** Queue one delivery per active endpoint. Returns the event id. */
export function emitMerchantEvent(input: EmitEventInput): string | null {
  const endpoints = getDb()
    .prepare("SELECT * FROM webhook_endpoints WHERE merchant_id = ? AND active = 1")
    .all(input.merchantId) as unknown as WebhookEndpointRow[];
  if (endpoints.length === 0) return null;
  const eventId = randomId("evt_");
  const payload = webhookPayload(input, eventId);
  for (const endpoint of endpoints) {
    getDb()
      .prepare(
        `INSERT INTO webhook_deliveries (id, endpoint_id, payment_id, event_id, event_type, payload,
          status, attempts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)
         ON CONFLICT(endpoint_id, event_id) DO NOTHING`,
      )
      .run(
        randomId("whd_"),
        endpoint.id,
        input.paymentId,
        eventId,
        input.eventType,
        payload,
        now(),
      );
  }
  return eventId;
}

export function listWebhookEndpoints(merchantId: string): Array<Omit<WebhookEndpointRow, "secret">> {
  const rows = getDb()
    .prepare(
      "SELECT id, merchant_id, url, active, created_at FROM webhook_endpoints WHERE merchant_id = ? ORDER BY created_at DESC",
    )
    .all(merchantId) as unknown as Array<Omit<WebhookEndpointRow, "secret">>;
  // node:sqlite returns null-prototype rows; copy before they reach a client component.
  return rows.map((row) => ({
    id: row.id,
    merchant_id: row.merchant_id,
    url: row.url,
    active: row.active,
    created_at: row.created_at,
  }));
}

export function createWebhookEndpoint(input: {
  merchantId: string;
  url: string;
}): { endpoint: Omit<WebhookEndpointRow, "secret">; secret: string } {
  const parsed = parseWebhookUrl(input.url);
  const secret = randomToken("whsec_", 32);
  const id = randomId("whe_");
  getDb()
    .prepare(
      `INSERT INTO webhook_endpoints (id, merchant_id, url, secret, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .run(id, input.merchantId, parsed.toString(), secret, now());
  return {
    endpoint: {
      id,
      merchant_id: input.merchantId,
      url: parsed.toString(),
      active: 1,
      created_at: now(),
    },
    secret,
  };
}

export function deactivateWebhookEndpoint(merchantId: string, endpointId: string): boolean {
  const result = getDb()
    .prepare("UPDATE webhook_endpoints SET active = 0 WHERE id = ? AND merchant_id = ?")
    .run(endpointId, merchantId);
  return Number(result.changes) > 0;
}

export function listWebhookDeliveries(
  merchantId: string,
  limit = 25,
): WebhookDeliveryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT d.* FROM webhook_deliveries d
       JOIN webhook_endpoints e ON e.id = d.endpoint_id
       WHERE e.merchant_id = ? ORDER BY d.created_at DESC LIMIT ?`,
    )
    .all(merchantId, limit) as unknown as WebhookDeliveryRow[];
  return rows.map((row) => ({
    id: row.id,
    endpoint_id: row.endpoint_id,
    payment_id: row.payment_id,
    event_id: row.event_id,
    event_type: row.event_type,
    payload: row.payload,
    status: row.status,
    attempts: row.attempts,
    last_error: row.last_error,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
  }));
}

function parseWebhookUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL.");
  }
  const allowInsecure =
    process.env.AGENTSPEND_ALLOW_INSECURE_WEBHOOKS === "1" &&
    (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && allowInsecure)) {
    throw new Error("Webhook URL must use HTTPS.");
  }
  const allowlist = (process.env.AGENTSPEND_WEBHOOK_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  if (!allowlist.includes(parsed.hostname.toLowerCase())) {
    throw new Error(
      `Webhook host ${parsed.hostname} is not in AGENTSPEND_WEBHOOK_HOSTS. Outbound delivery is disabled.`,
    );
  }
  return parsed;
}

export async function deliverWebhook(deliveryId: string): Promise<boolean> {
  const delivery = getDb()
    .prepare("SELECT * FROM webhook_deliveries WHERE id = ?")
    .get(deliveryId) as WebhookDeliveryRow | undefined;
  if (!delivery || delivery.status === "delivered" || delivery.status === "failed") return false;
  const endpoint = getDb()
    .prepare("SELECT * FROM webhook_endpoints WHERE id = ? AND active = 1")
    .get(delivery.endpoint_id) as WebhookEndpointRow | undefined;
  if (!endpoint) return false;
  let url: URL;
  try {
    url = parseWebhookUrl(endpoint.url);
  } catch (error) {
    getDb()
      .prepare(
        `UPDATE webhook_deliveries SET status = 'failed', attempts = attempts + 1, last_error = ? WHERE id = ?`,
      )
      .run(error instanceof Error ? error.message : "URL rejected", deliveryId);
    return false;
  }

  const timestamp = Math.floor(now() / 1000);
  const signature = webhookSignature(endpoint.secret, timestamp, delivery.payload);
  const attempts = delivery.attempts + 1;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "agentspend-event": delivery.event_type,
        "agentspend-delivery": delivery.event_id,
        "agentspend-signature": signature,
      },
      body: delivery.payload,
      signal: AbortSignal.timeout(5_000),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`Webhook endpoint returned HTTP ${response.status}`);
    }
    getDb()
      .prepare(
        `UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, delivered_at = ?, last_error = NULL WHERE id = ?`,
      )
      .run(attempts, now(), deliveryId);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "webhook delivery failed";
    getDb()
      .prepare(
        `UPDATE webhook_deliveries SET status = ?, attempts = ?, last_error = ? WHERE id = ?`,
      )
      .run(attempts >= 5 ? "failed" : "pending", attempts, message.slice(0, 400), deliveryId);
    return false;
  }
}

/** Retry pending deliveries. Called by the operator, never on a timer. */
export async function dispatchPendingWebhooks(limit = 10): Promise<number> {
  const rows = getDb()
    .prepare(
      `SELECT id FROM webhook_deliveries WHERE status = 'pending' AND attempts < 5
       ORDER BY created_at ASC LIMIT ?`,
    )
    .all(limit) as unknown as Array<{ id: string }>;
  let delivered = 0;
  for (const row of rows) {
    if (await deliverWebhook(row.id)) delivered += 1;
  }
  return delivered;
}

export function webhookTest(input: {
  merchantId: string;
  url?: string | null;
}): {
  eventId: string;
  eventType: string;
  payload: string;
  signatureHeader: string;
  deliverable: boolean;
  note: string;
} {
  const eventId = randomId("evt_test_");
  const payload = webhookPayload(
    {
      merchantId: input.merchantId,
      paymentId: "pay_test",
      eventType: "webhook.test",
      data: { message: "AgentSpend webhook test", merchantId: input.merchantId },
    },
    eventId,
  );
  let secret = randomToken("whsec_test_", 32);
  let deliverable = false;
  if (input.url) {
    try {
      parseWebhookUrl(input.url);
      deliverable = true;
    } catch {
      deliverable = false;
    }
  }
  const endpoint = input.url
    ? (getDb()
        .prepare(
          "SELECT * FROM webhook_endpoints WHERE merchant_id = ? AND url = ? AND active = 1",
        )
        .get(input.merchantId, input.url) as WebhookEndpointRow | undefined)
    : undefined;
  if (endpoint) secret = endpoint.secret;
  const timestamp = Math.floor(now() / 1000);
  return {
    eventId,
    eventType: "webhook.test",
    payload,
    signatureHeader: webhookSignature(secret, timestamp, payload),
    deliverable,
    note: deliverable
      ? "Signature computed. Outbound delivery still requires the host allowlist and an explicit dispatch."
      : "No deliverable URL. This is a signed sample payload for integration testing.",
  };
}
