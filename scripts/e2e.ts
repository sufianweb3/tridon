/**
 * End-to-end smoke test against a running AgentSpend server.
 *
 * It signs in with the labelled demo account and exercises the paths that do
 * not spend testnet funds: auth, read APIs, CSRF enforcement, per-transaction
 * denial, unknown-merchant denial, idempotent replay, the merchant portal, and
 * rejected bearer credentials. It deliberately does not approve or submit a
 * payment, so it is safe to run against the demo workspace.
 *
 * Usage:
 *   pnpm dev            # in another terminal
 *   pnpm test:e2e
 */
const baseUrl = process.env.AGENTSPEND_APP_URL ?? "http://localhost:3000";

let cookieJar = new Map<string, string>();
let failures = 0;
let passes = 0;

function cookies(): string {
  return [...cookieJar.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

function absorbCookies(response: Response): void {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie") ?? ""].filter(Boolean);
  for (const raw of values) {
    const pair = raw.split(";")[0];
    const index = pair.indexOf("=");
    if (index <= 0) continue;
    cookieJar.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

interface CallOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  csrf?: string;
  bearer?: string;
  headers?: Record<string, string>;
}

async function call<T = unknown>(
  path: string,
  options: CallOptions = {},
): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = {
    accept: "application/json",
    ...(options.headers ?? {}),
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.csrf) headers["x-csrf-token"] = options.csrf;
  if (options.bearer) headers.authorization = `Bearer ${options.bearer}`;
  if (cookieJar.size > 0) headers.cookie = cookies();
  const response = await fetch(new URL(path, baseUrl), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  absorbCookies(response);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text.length > 0 ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body: body as T };
}

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passes += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function errorCode(body: unknown): string {
  const candidate = body as { error?: { code?: string } } | null;
  return candidate?.error?.code ?? "";
}

function unitsToDecimal(units: bigint): string {
  const whole = units / 1_000_000n;
  const fraction = (units % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

interface AgentSummary {
  id: string;
  name: string;
  status: string;
}

interface MerchantSummary {
  id: string;
  name: string;
  policy: { allowlisted: boolean } | null;
  services: Array<{ id: string; name: string; price: string }>;
}

interface PaymentSummary {
  id: string;
  status: string;
  denyCode: string | null;
  userFee: string;
  merchantFee: string;
  gross: string;
  feeState: "not_charged" | "charged" | "owed";
  feeCharged: boolean;
}

async function main(): Promise<void> {
  console.log(`AgentSpend E2E smoke · ${baseUrl}\n`);

  const loginPage = await fetch(new URL("/login", baseUrl)).catch(() => null);
  check("login page is reachable", loginPage?.status === 200, `status ${loginPage?.status ?? "none"}`);
  if (!loginPage || loginPage.status !== 200) {
    console.error("\nStart the app first: pnpm dev");
    process.exit(1);
  }

  console.log("\n[1/6] Demo session");
  const demo = await call<{ ok: boolean; data?: { csrf: string } }>("/api/auth/demo", {
    method: "POST",
  });
  check("demo sign-in succeeds", demo.status === 200 && demo.body.ok === true, JSON.stringify(demo.body));
  if (demo.status !== 200 || !demo.body.data) {
    console.error("\nRun `pnpm seed` to provision the demo workspace.");
    process.exit(1);
  }
  const csrf = demo.body.data.csrf;
  check("session cookie is set", cookieJar.has("agentspend_session"));
  check("CSRF token is issued", typeof csrf === "string" && csrf.startsWith("csrf_"));

  console.log("\n[2/6] Read APIs");
  const reads: Array<[string, string, (body: unknown) => boolean]> = [
    ["/api/overview", "overview", (body) => Boolean((body as { data?: { budget?: unknown } }).data?.budget)],
    ["/api/agents", "agents", (body) => Array.isArray((body as { data?: { agents?: unknown } }).data?.agents)],
    ["/api/policy", "policy", (body) => Boolean((body as { data?: { policy?: unknown } }).data?.policy)],
    [
      "/api/transactions",
      "transactions",
      (body) => Array.isArray((body as { data?: { payments?: unknown } }).data?.payments),
    ],
    ["/api/merchants", "merchants", (body) => Array.isArray((body as { data?: { merchants?: unknown } }).data?.merchants)],
    ["/api/approvals", "approvals", (body) => Array.isArray((body as { data?: { approvals?: unknown } }).data?.approvals)],
    ["/api/audit", "audit", (body) => Array.isArray((body as { data?: { events?: unknown } }).data?.events)],
  ];
  const readBodies = new Map<string, unknown>();
  for (const [path, label, predicate] of reads) {
    const result = await call<{ ok: boolean; data?: unknown }>(path);
    readBodies.set(label, result.body);
    check(
      `GET ${path}`,
      result.status === 200 && result.body.ok === true && predicate(result.body),
      `status ${result.status}`,
    );
  }

  const agents = (readBodies.get("agents") as { data: { agents: AgentSummary[] } }).data.agents;
  const activeAgent = agents.find((agent) => agent.status === "active");
  check("an active agent exists", Boolean(activeAgent), "seed the demo workspace");

  const policyBody = readBodies.get("policy") as {
    data: { policy: { perTxLimit: string; unknownMerchantMode: string } | null };
  };
  const policy = policyBody.data.policy;
  check("a policy exists", Boolean(policy));

  const merchants = (readBodies.get("merchants") as { data: { merchants: MerchantSummary[] } }).data.merchants;
  const allowlisted = merchants.find((merchant) => merchant.policy?.allowlisted && merchant.services.length > 0);
  const unlisted = merchants.find((merchant) => merchant.policy && !merchant.policy.allowlisted && merchant.services.length > 0);
  check("an allowlisted merchant exists", Boolean(allowlisted));
  check("an unlisted merchant exists", Boolean(unlisted));

  console.log("\n[3/6] CSRF enforcement");
  const noCsrf = await call("/api/demo/agent-payment", {
    method: "POST",
    body: { agentId: activeAgent?.id ?? "missing", merchantId: "merchant-data", amount: "1.00" },
  });
  check(
    "payment request without CSRF is rejected",
    noCsrf.status === 403 && errorCode(noCsrf.body) === "CSRF_FAILED",
    `status ${noCsrf.status} ${errorCode(noCsrf.body)}`,
  );

  console.log("\n[4/6] Policy denials and idempotency");
  if (activeAgent && allowlisted && policy) {
    const overUnits = BigInt(policy.perTxLimit) + 1_000_000n;
    const overAmount = unitsToDecimal(overUnits);
    const key = `e2e-denied-${Date.now()}`;
    const denied = await call<{
      ok: boolean;
      data?: { payment: PaymentSummary; replayed: boolean };
    }>("/api/demo/agent-payment", {
      method: "POST",
      csrf,
      body: {
        agentId: activeAgent.id,
        merchantId: allowlisted.id,
        amount: overAmount,
        idempotencyKey: key,
      },
    });
    const payment = denied.body.data?.payment;
    check(
      "per-transaction limit denies before submission",
      denied.status === 200 && payment?.status === "denied" && payment?.denyCode === "PER_TX_LIMIT",
      `status ${denied.status} / ${payment?.status ?? "none"} / ${payment?.denyCode ?? "none"}`,
    );
    check(
      "denied payment carries no platform fee",
      payment?.feeState === "not_charged" && payment?.feeCharged === false,
      `feeState ${payment?.feeState ?? "?"} feeCharged ${String(payment?.feeCharged)}`,
    );

    const replay = await call<{
      ok: boolean;
      data?: { payment: PaymentSummary; replayed: boolean };
    }>("/api/demo/agent-payment", {
      method: "POST",
      csrf,
      body: {
        agentId: activeAgent.id,
        merchantId: allowlisted.id,
        amount: overAmount,
        idempotencyKey: key,
      },
    });
    check(
      "same idempotency key replays the same payment",
      replay.status === 200 &&
        replay.body.data?.replayed === true &&
        replay.body.data?.payment.id === payment?.id,
      `status ${replay.status} / replay ${String(replay.body.data?.replayed)}`,
    );
  } else {
    check("per-transaction denial", false, "missing agent, merchant or policy");
  }

  if (activeAgent && unlisted && policy) {
    if (policy.unknownMerchantMode === "deny") {
      const service = unlisted.services[0];
      const unknown = await call<{ ok: boolean; data?: { payment: PaymentSummary } }>(
        "/api/demo/agent-payment",
        {
          method: "POST",
          csrf,
          body: {
            agentId: activeAgent.id,
            merchantId: unlisted.id,
            serviceId: service.id,
            idempotencyKey: `e2e-unknown-${Date.now()}`,
          },
        },
      );
      const payment = unknown.body.data?.payment;
      check(
        "unlisted merchant is denied with no fee",
        unknown.status === 200 &&
          payment?.status === "denied" &&
          payment?.denyCode === "UNKNOWN_MERCHANT" &&
          payment?.feeState === "not_charged" &&
          payment?.feeCharged === false,
        `status ${unknown.status} / ${payment?.status ?? "none"} / ${payment?.denyCode ?? "none"} / fee ${payment?.feeState ?? "?"}`,
      );
    } else {
      console.log(`  SKIP  unknown-merchant denial (policy mode is ${policy.unknownMerchantMode})`);
    }
  } else {
    check("unknown-merchant denial", false, "missing agent, unlisted merchant or policy");
  }

  console.log("\n[5/6] Agent credential safety");
  const badBearer = await call("/v1/agent/budget", { bearer: "asp_agent_invalid" });
  check(
    "invalid agent bearer is rejected",
    badBearer.status === 401,
    `status ${badBearer.status} ${errorCode(badBearer.body)}`,
  );
  const missingKey = await call("/v1/agent/payment-requests", {
    method: "POST",
    bearer: "asp_agent_invalid",
    body: { merchant_id: "merchant-data", amount: "1.00" },
  });
  check(
    "unauthenticated agent cannot create a payment",
    missingKey.status === 401,
    `status ${missingKey.status}`,
  );

  console.log("\n[6/6] Merchant portal");
  const merchantLogin = await call<{ ok: boolean; data?: { csrf: string } }>("/api/merchant/login", {
    method: "POST",
    body: { merchantId: "merchant-data" },
  });
  check(
    "demo merchant sign-in succeeds",
    merchantLogin.status === 200 && merchantLogin.body.ok === true,
    `status ${merchantLogin.status}`,
  );
  check("merchant cookie is set", cookieJar.has("agentspend_merchant"));
  const summary = await call<{
    ok: boolean;
    data?: { merchant: { merchantId: string }; dashboard: { payments: unknown[] } };
  }>("/api/merchant/summary");
  check(
    "merchant summary is readable",
    summary.status === 200 &&
      summary.body.ok === true &&
      summary.body.data?.merchant.merchantId === "merchant-data" &&
      Array.isArray(summary.body.data?.dashboard.payments),
    `status ${summary.status}`,
  );

  console.log(`\n${passes} passed, ${failures} failed.`);
  if (failures > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\nE2E smoke failed:");
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
