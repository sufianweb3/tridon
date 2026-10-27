export const APP_NAME = "AgentSpend";
export const NETWORK = "testnet" as const;

export const appConfig = {
  appUrl: process.env.AGENTSPEND_APP_URL ?? "http://localhost:3000",
  network: NETWORK,
  rpcUrl: process.env.AGENTSPEND_NEAR_RPC ?? "https://rpc.testnet.near.org",
  helperUrl: process.env.AGENTSPEND_NEAR_HELPER ?? "https://helper.testnet.near.org",
  explorerBase: "https://testnet.nearblocks.io",
  demoEnabled: process.env.AGENTSPEND_DEMO !== "0",
  liveRailEnabled: process.env.AGENTSPEND_LIVE_RAIL !== "0",
  sessionTtlMs: 7 * 24 * 60 * 60 * 1000,
  merchantSessionTtlMs: 12 * 60 * 60 * 1000,
  nonceTtlMs: 10 * 60 * 1000,
  paymentRequestTtlMs: 15 * 60 * 1000,
  approvalTtlMs: 30 * 60 * 1000,
  maxPaymentRequestTtlMs: 60 * 60 * 1000,
  fees: {
    userBps: 50,
    merchantBps: 50,
  },
  token: {
    symbol: "TESTUSD",
    name: "AgentSpend Test USD",
    decimals: 6,
    label: "TEST USD (demo token)",
    isCircleUsdc: false,
  },
  limits: {
    maxBodyBytes: 64 * 1024,
    agentRequestsPerMinute: 60,
    authRequestsPerMinute: 20,
    approvalRequestsPerMinute: 30,
    maxIdempotencyKeyLength: 128,
    maxMemoLength: 96,
  },
} as const;

export function appHost(): string {
  try {
    return new URL(appConfig.appUrl).host;
  } catch {
    return "localhost:3000";
  }
}

export function explorerTx(txHash: string): string {
  return `${appConfig.explorerBase}/txns/${txHash}`;
}

export function explorerAccount(accountId: string): string {
  return `${appConfig.explorerBase}/address/${accountId}`;
}

export const FEE_BPS = {
  user: BigInt(appConfig.fees.userBps),
  merchant: BigInt(appConfig.fees.merchantBps),
} as const;

export const TOKEN_DECIMALS = appConfig.token.decimals;
