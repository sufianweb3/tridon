# AgentSpend

**Give an AI agent a wallet with a leash.**

AgentSpend is a per-user, on-chain spending-policy vault for AI agents, built for the
NEAR Hackathon. A user funds a vault, sets limits and merchant rules, and gives each
agent a scoped NEAR function-call key. The agent can request payments inside the policy;
it cannot withdraw, redirect a payout, or change a limit.

> **Testnet only. The demo asset is `TESTUSD`, a NEP-141 test token deployed by this
> project, not Circle USDC.** Mainnet spending is not approved. The UI labels the token
> and the rail everywhere.

---

## Status

| Item | State |
|---|---|
| Live rail | NEAR testnet vault, deployed and settled end-to-end |
| Mock rails | Backend-only rail for wallet sessions and Neon Auth email sessions |
| Application database | Neon Postgres (`production` branch), schema created and demo data migrated |
| Neon services | Postgres, Auth, Object Storage, Functions and Realtime wired and verified |
| Unit tests | 29 passing (21 core policy/money/state + 8 NEAR adapter) |
| HTTP e2e | 25 passing against the Neon-backed production server |
| Production build | Passing (`next build`, all pages and API routes) |
| Browser checks | Demo login, dashboard, agents, policy, approvals, transactions, merchants, security, Agent API, Neon Auth |
| Hackathon submission | **Not submitted.** The public repo is pushed; the X demo post and submission are still pending. See [Final submission](#final-submission). |

This README describes what is implemented, what is enforced on-chain, and what is a
demo-only shortcut. It does not claim production readiness.

---

## Why it exists

An agent that can call paid APIs needs a credential that can spend. Giving it a wallet
private key gives it everything: the balance, the ability to withdraw, and the ability to
change its own limits. Giving it a server-side API key makes the backend the only guard,
so a backend compromise becomes a spending incident.

AgentSpend separates **authority** from **ownership**:

- The user's account owns the vault. The vault holds the funds.
- The vault's Rust code enforces the policy on every `pay` call.
- The agent gets a function-call access key scoped to `pay` on that vault, with a gas
  allowance. The key cannot transfer tokens or attach NEAR.
- Merchant payout accounts are pinned in vault state. An agent supplies a merchant id,
  never a recipient address.

The backend is still needed for identity, idempotency, approvals, reconciliation, fee
accounting, and UX. It is a fast-fail pre-check and an indexer, not the last line of
defence.

---

## Three ways in, all labelled

| Session type | Rail | Where limits are enforced |
|---|---|---|
| **Demo workspace** (one click on `/login`) | Live NEAR testnet vault | Vault contract + backend pre-check |
| **Wallet login** (NEP-413 `signMessage`) | Mock rail | Application backend only |
| **Neon Auth email account** | Mock rail | Application backend only |

Why the split: a real wallet user owns their vault, so the platform must not hold the
owner's full-access key to provision and sign for it. Wallet sessions therefore get a
clearly-labelled mock rail where the same policy engine runs in the backend. The live
rail is demonstrated with a server-held **testnet-only** demo signer whose keys are
encrypted at rest. Neon Auth email accounts are additive and receive a backend-only mock
workspace; they never receive a vault or an on-chain key.

The UI shows `NEAR testnet · on-chain vault`, `Mock rail · backend-enforced limits`, or
`Neon Auth · backend mock rail` on every payment. The mock rail is useful for testing
policy behaviour, but it is **not** on-chain security, and the interface says so.

---

## Architecture

```
Browser (Next.js 15 / React 19)
  |  HttpOnly session cookie + CSRF header
  v
Next.js route handlers
  |  auth, policy pre-check, reservations, approvals,
  |  idempotency, audit, webhooks, receipts
  |
  +--> Neon Postgres (pooled, `pg`)
  |      users, vaults, agents, policies, payments,
  |      reservations, approvals, fee ledger, audit
  |
  +--> Neon Auth (email)      +--> Neon Object Storage (receipt JSON)
  |
  +--> Neon Functions (status)+--> Neon Realtime (live ledger, sealed query)
  |
  +--> demo rail --> NEAR testnet JSON-RPC
  |                    |
  |                    v
  |              Vault contract (Rust, immutable)
  |                - holds TESTUSD (NEP-141)
  |                - enforces total / per-tx / daily / weekly / monthly
  |                - enforces merchant allowlist and per-merchant caps
  |                - handles unknown-merchant mode and approval mode
  |                - pins payout accounts in state
  |                - ft_transfer -> merchant payout
  |                - chained ft_transfer -> fee account (only after merchant success)
  |                - exposes get_state / get_payment for reconciliation
  |
  +--> mock rail --> policy engine in `packages/core` (backend-enforced)
```

The vault is per user and non-upgradeable. One vault has exactly one on-chain policy
shared by all of its agents. Each agent has its own key. Revoking an agent deletes its
on-chain key first, then updates the dashboard.

### Repository layout

| Path | Purpose |
|---|---|
| `apps/web` | Next.js app, API routes, dashboards, merchant portal |
| `packages/core` | Pure TypeScript money, policy engine, payment state machine |
| `packages/near` | Typed NEAR testnet adapter (accounts, keys, calls, FINAL status, NEP-413) |
| `contracts/vault` | Rust spending-policy vault |
| `contracts/test-token` | Minimal NEP-141 `TESTUSD` token for the demo |
| `scripts/seed.ts` | Resumable testnet workspace provisioning + demo scenarios |
| `scripts/e2e.ts` | HTTP smoke test for the running app |
| `neon.ts` | Neon service declaration (Auth, function, bucket, Realtime) |
| `hello.ts` | Deployed `agentspend-status` Neon Function |
| `.agents/skills` | Vendored Neon agent skills used during integration |
| `docs/architecture/decision-record.md` | Verified design decisions, alternatives, threat model, Neon ADR |
| `PRD.md` | Product and acceptance specification |

---

## Quick start

### Prerequisites

- **Node.js >= 22** (verified on Node 24)
- **pnpm 12.5.1** (`corepack enable` if needed)
- A Neon project and branch, with the CLI available (`neon --version`; this workspace used
  `8.13.1`)
- Network access to NEAR testnet RPC and the testnet account helper
- Rust + the `wasm32-unknown-unknown` target only if you want to rebuild the contracts

### Run

```bash
pnpm install

# 1. Link this checkout to your Neon project/branch (or copy an existing .env.local).
#    The project already provisioned for this demo is `AgentPay`, branch `production`.

# 2. Generate the two app-only secrets before deploying the function.
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"  # NEON_AUTH_COOKIE_SECRET
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"  # AGENTSPEND_FUNCTION_SECRET

# 3. Apply neon.ts and pull the branch-scoped variables into the root .env.local.
neon deploy --env .env.local

# 4. Add the app-only values that Neon does not manage:
#    NEON_AUTH_COOKIE_SECRET, AGENTSPEND_FUNCTION_SECRET, NEON_STORAGE_BUCKET=assets,
#    AGENTSPEND_MASTER_KEY (stable; encrypts the demo signer's testnet keys).

# 5. Create the schema, provision or resume the testnet demo, and seed scenarios.
pnpm seed

# 6. Start the app.
pnpm dev                 # http://localhost:3000
```

`pnpm seed` is resumable. It creates testnet accounts through
`helper.testnet.near.org`, deploys the vault and test token, registers merchant payout
accounts, funds the vault with `ft_transfer_call`, and runs the six demo scenarios. Agent
bearer credentials are printed **once**; only hashes are stored. A resumed run skips
completed on-chain steps and revoked agents.

The canonical environment file is the **repository-root** `.env.local`, where
`neon deploy --env` writes. `apps/web/next.config.ts` loads it (then `.env`) for
`next dev`, `next build` and `next start`; existing process env wins. Root scripts use
`tsx --env-file-if-exists=.env.local`.

To start over (destructive):

```bash
pnpm db:reset -- --yes    # deletes every row in the Neon Postgres schema
pnpm seed
```

Then open:

- **User demo:** <http://localhost:3000/login> -> "Enter the live demo"
- **Email sign-up:** <http://localhost:3000/login> -> "Create an email account"
- **Merchant portal:** <http://localhost:3000/merchant/login> -> pick a merchant (demo-only)

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Start Next.js on port 3000 |
| `pnpm build` | Production build |
| `pnpm start` | Start the production build |
| `pnpm typecheck` | Typecheck every workspace package |
| `pnpm test` | Core policy/money/state tests + NEAR adapter tests |
| `pnpm test:e2e` | HTTP smoke test against a running server (no funds spent) |
| `pnpm seed` | Provision/resume the testnet demo workspace |
| `pnpm db:reset -- --yes` | Delete every row in the Neon Postgres schema (destructive) |

Verified results at the time of writing:

```text
pnpm test
  @agentspend/core  21 passed
  @agentspend/near   8 passed

pnpm --filter @agentspend/web typecheck   # clean
pnpm --filter @agentspend/web build       # clean
pnpm test:e2e                             # 25 passed, 0 failed
```

`pnpm test:e2e` requires the server to be running. It exercises auth, read APIs, CSRF
rejection, per-transaction denial, unknown-merchant denial, idempotent replay, rejected
bearer credentials, and the merchant portal. It does not approve or submit a payment, so
it does not spend testnet funds.

`pnpm lint` is not usable in this repository: ESLint is not configured and `next lint`
prompts for setup. Typecheck, unit tests, the HTTP e2e suite and the production build are
the verification gates.

---

## Demo walkthrough

A detailed click-by-click script is in [`docs/DEMO.md`](docs/DEMO.md). Short version:

1. Sign in at `/login` with the demo workspace.
2. **Dashboard** - remaining budget, pending approvals, recent settlements, and the live
   Neon Realtime ledger.
3. **Agent API** (`/integrations`) - pick an agent and merchant, send a payment, or use a
   one-click scenario. The result panel shows the decision, fee state, enforcement layer,
   transaction link, and idempotency key.
4. **Approvals** - a $24 Lighthouse request is waiting; approve it to settle, or deny it
   to release the reservation with no fee.
5. **Transactions** - filter by status; open a payment to see policy decision, approval,
   execution, FINAL verification, fee entries, audit events, and a presigned Neon Object
   Storage receipt.
6. **Policy** - edit limits and merchant rules. A live vault syncs the new policy
   on-chain and records the transaction. A failed sync pauses the policy (fail closed).
7. **Agents** - create an agent (adds a scoped on-chain key), rotate its bearer token, or
   revoke it (deletes the on-chain key first).
8. **Security model** - the enforcement matrix, including the "backend fully compromised"
   column.
9. **Merchant portal** - sign in as DataForge, see authoritative settlements, gross,
   0.5% merchant fee, net, settlement reference, services, and webhooks.

The six seeded scenarios:

| Scenario | Merchant | Amount | Expected |
|---|---|---|---|
| Allowed compute | Northstar Compute | $3.50 | `succeeded`, fee entries recorded |
| Allowed data | DataForge | $12.00 | `succeeded`, fee entries recorded |
| Approval required | Lighthouse Research | $24.00 | `awaiting_approval` |
| Per-transaction cap | DataForge | $50.00 | `denied` (`PER_TX_LIMIT`), no fee |
| Unknown merchant | Atlas Data Co. | $4.50 | `denied` (`UNKNOWN_MERCHANT`), no fee |
| Settlement failure | Flaky Fulfillment | $1.00 | `failed`, no fee |

"Unknown merchant" means **not on the user's allowlist**. It never means "use an
agent-supplied payout address". Every merchant in the catalogue has a payout account
pinned in vault state when the vault is provisioned.

---

## Policy model

The policy is deterministic and integer-only. No LLM makes the spend decision.

- **Global limits:** total budget, per-transaction, daily, weekly, monthly.
- **Merchant rules:** allowlisted flag, per-merchant per-transaction cap, per-merchant
  rolling window cap, optional approval requirement.
- **Unknown merchants:** `deny`, `require_approval`, or `allow_with_cap` (with a cap).
- **Approval mode:** all, none within policy, selected merchants, or unknown merchants.
- **Lifecycle:** active, paused, revoked; valid-from and expiry timestamps.
- **Budget accounting:** committed + held + available, with concurrency-safe
  reservations. A denied or failed payment releases its reservation.
- **Balance:** the vault's accounted TESTUSD balance, synced from chain.

Policy updates fail closed: the database is written first, then the chain is synced. If
the chain sync fails, the policy is paused and the UI says so.

### Payment states

```
requested -> policy_decision -+-> denied (no fee, reservation released)
                              +-> awaiting_approval -> approved -> submitted
                              |                     +-> denied (no fee)
                              +-> submitted -> confirming -> succeeded
                              |                          +-> failed (no fee)
                              |                          +-> unknown (not paid)
                              +-> failed (pre-submit)
```

`unknown` is never treated as paid. Merchant fulfilment is only permitted on
`succeeded`, after authoritative settlement verification.

---

## Settlement and fees

- **Authoritative settlement:** the vault's own `Succeeded` / `MerchantPaid` record for
  the matching payout, gross, net, and payment id, read at `FINAL` finality. NEP-141
  transfer logs are additional evidence (`logVerified`), not the sole authority.
- **Merchant payout:** direct `ft_transfer` from the vault to the payout account pinned in
  contract state.
- **Fees:** 0.5% user fee (added on top of gross) and 0.5% merchant fee (deducted from
  gross), integer basis points with ceiling division. The user is debited gross + user
  fee; the merchant receives gross - merchant fee.
- **No fee on blocked or failed payments.** The fee transfer is chained *after* the
  merchant transfer callback succeeds, so a failed or blocked payment cannot produce a
  fee.
- **Network gas is separate.** The demo signer/owner pays NEAR gas. It is not presented as
  a platform fee.

The fee accounts and token are testnet-only. No real funds are involved.

---

## API

### Agent API

Agents authenticate with a bearer credential (`asp_agent_...`) issued once at creation or
rotation. The raw value is never returned again and never logged.

```bash
curl -X POST http://localhost:3000/v1/agent/payment-requests \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Idempotency-Key: 7f3c2a1e-..." \
  -H "Content-Type: application/json" \
  -d '{"merchant_id":"merchant-compute","service_id":"svc-compute-gpu"}'
```

- `Idempotency-Key` is required. The same key returns the original payment, never a
  second charge or fee.
- `amount` is optional for fixed-price services; it is a decimal string in whole units.
- HTTP `201` for a submitted/succeeded payment, `202` for approval-required or unknown,
  `200` for denied/failed. The body always includes `payment`, `approval`,
  `idempotent_replay`, and `enforcement`.
- Other endpoints: `GET /v1/agent/budget`, `GET /v1/agent/policy`,
  `GET /v1/agent/payment-requests/:id`.

### Merchant API

Merchants authenticate with `asp_merchant_...` credentials and can create payment requests:

```bash
curl -X POST http://localhost:3000/v1/merchant/payment-requests \
  -H "Authorization: Bearer $MERCHANT_TOKEN" \
  -H "Idempotency-Key: ..." \
  -H "Content-Type: application/json" \
  -d '{"service_id":"svc-data-market"}'
```

Also: `GET /v1/merchant/services`, `POST /v1/merchant/webhooks/test`.

### Session API

The dashboards use `/api/*` routes with an HttpOnly session cookie and a CSRF header.
The demo console uses `/api/demo/agent-payment`, which authenticates the signed-in user
and is explicitly labelled as a demo shortcut; production agents use the bearer API.
Neon Auth uses `/api/auth/[...path]` for the managed session and `/api/auth/neon-bridge`
to exchange it for the app session.

---

## Security model

The full threat model and enforcement matrix are in
[`docs/architecture/decision-record.md`](docs/architecture/decision-record.md) and on the
`/security` page. The short version:

| Control | Enforced by |
|---|---|
| Per-transaction, total, daily, weekly, monthly limits | Vault contract |
| Merchant allowlist, per-merchant caps | Vault contract |
| Payout address cannot be supplied by an agent | Vault contract state |
| Revocation stops new signatures | NEAR access-key deletion (contract-owned) |
| Agent key cannot withdraw or transfer | NEAR function-call key scope (`pay` only) |
| Policy change requires owner | Vault contract `owner` check |
| CSRF, sessions, rate limits | Backend |
| Idempotency, reservations, approvals | Backend + Postgres transaction |
| Settlement truth | NEAR RPC at `FINAL` |
| Fee only on success | Contract call chain |
| Webhook SSRF | Backend hostname allowlist |
| Receipt access | Private bucket + 5-minute presigned URL |

Additional properties:

- No seed phrases or primary private keys are stored. The demo signer's testnet keys are
  encrypted at rest with a 32-byte master key; `data/` and `.env.local` are gitignored.
- The demo signer is **testnet-only** and is never used for wallet-login or Neon Auth users.
- Webhook delivery is disabled unless the endpoint host is in
  `AGENTSPEND_WEBHOOK_HOSTS`. The "test" endpoint returns a signed sample without making
  an outbound request.
- The merchant portal login is a labelled demo shortcut, not production merchant auth.

### Known limitations and deviations

These are deliberate, documented deviations from the original decision record:

1. **`TESTUSD` instead of Circle testnet USDC.** Circle's testnet faucet could not be
   automated in this environment, so the demo deploys a clearly-labelled NEP-141 test
   token. The rail adapter is asset-agnostic; switching to Circle USDC requires the token
   account, storage registration, and policy asset configuration, not a rewrite. The UI
   never calls the demo token USDC.
2. **Server-side demo signer.** Browser E2E without a wallet extension requires a signer
   the server controls. It exists only for the demo workspace, only on testnet, and its
   keys are encrypted at rest. Wallet-login and Neon Auth users get the mock rail instead.
3. **Merchant portal auth is demo-only.** One-click merchant selection is not a
   production auth model. A real deployment needs merchant accounts, API-key lifecycle,
   and organization roles.
4. **Webhooks are allowlisted and delivery is off by default.** This is an SSRF control,
   not a missing feature.
5. **Contract callback gas.** The merchant callback is given 80 TGAS because it creates a
   25 TGAS fee transfer plus a 20 TGAS callback. An earlier 20 TGAS value failed with
   "Exceeded the prepaid gas"; the fix and redeploy are recorded in the decision record.
6. **No `near` CLI / `cargo-near`.** Contracts are built with
   `cargo build --release --target wasm32-unknown-unknown` and deployed with
   `near-api-js` scripts.
7. **No mainnet support, no real funds, no production custody.**
8. **No automated browser suite in CI.** The browser flows were exercised manually; the
   HTTP smoke test covers the non-spending paths.
9. **NEAR Intents and x402 are not implemented.** Both were evaluated and rejected for
   the MVP; see the decision record.
10. **Neon Auth is additive and backend-only.** Email accounts get a mock workspace; the
    bridge does not enforce email verification yet. Do not treat it as production auth.
11. **Neon Functions use a shared server-to-server secret.** The function is read-only and
    never receives vault keys. Rotate the secret by updating `.env.local` and redeploying.
12. **Vercel is not configured yet.** The hosted deployment needs the Neon environment
    variables below; until then `/login` and `/merchant/login` return 500.

---

## Neon integration

Neon is the application platform, not the payment authority. Postgres is required; Auth,
Object Storage, Functions and Realtime are additive and degrade to explicit `503`
errors when unconfigured.

| Service | What it does in AgentSpend |
|---|---|
| **Postgres** | System of record for users, vaults, agents, policies, payments, reservations, approvals, fee ledger, audit and settings. Pooled `pg` connection; advisory locks serialize budget check + reservation. |
| **Auth** | Managed Better Auth email/password sign-up at `/api/auth/[...path]`; `/api/auth/neon-bridge` creates an app session and a backend-only mock workspace. |
| **Object Storage** | Private `assets` bucket holds settlement receipt JSON at `receipts/<paymentId>.json`; the transaction page issues a 300-second presigned download URL. |
| **Functions** | `agentspend-status` reads an agent's policy, balance and payment totals (or one payment) directly from Postgres. Server-to-server only, guarded by `AGENTSPEND_FUNCTION_SECRET`; proxied by `/api/neon/function-status`. |
| **Realtime** | The dashboard subscribes to a server-sealed, user-scoped payments query. Only the capability and `NEON_REALTIME_URL` reach the browser; `NEON_REALTIME_SECRET` stays server-side. |

### Environment variables

The root `.env.local` is written by `neon deploy --env .env.local`. It contains:

```text
DATABASE_URL, DATABASE_URL_UNPOOLED, NEON_BRANCH
NEON_AUTH_BASE_URL, NEON_AUTH_JWKS_URL, NEON_AUTH_COOKIE_SECRET
NEON_REALTIME_URL, NEON_REALTIME_SECRET
AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, AWS_REGION
NEON_FUNCTION_HELLO_BASE_URL, AGENTSPEND_FUNCTION_SECRET
NEON_STORAGE_BUCKET
```

App-only secrets that Neon does not manage: `NEON_AUTH_COOKIE_SECRET`,
`AGENTSPEND_FUNCTION_SECRET`, `NEON_STORAGE_BUCKET`, `AGENTSPEND_MASTER_KEY`.

### Vercel

Set the same variables in the Vercel project (Production and Preview as appropriate).
`AGENTSPEND_MASTER_KEY` must be stable across deployments, or the encrypted demo signer
material becomes unreadable. The app also needs `AGENTSPEND_APP_URL` and the existing
`AGENTSPEND_*` settings. Once the Postgres-backed build and the variables are in place,
`/login` and `/merchant/login` stop returning 500.

The Neon CLI, MCP server and agent skills are already installed for this repository:
`opencode.json` contains the project-level `mcp.Neon` entry (OAuth, no API key committed),
and `.agents/skills/neon*` plus `skills-lock.json` are checked in.

---

## Live testnet state

These are demo accounts created by `pnpm seed`, not production infrastructure.

| Item | Value |
|---|---|
| Vault | [`as-vault-mvpk1qc46z3b.testnet`](https://testnet.nearblocks.io/address/as-vault-mvpk1qc46z3b.testnet) |
| Demo token (`TESTUSD`, 6 decimals) | [`as-testusd-mvpk08ejfxll.testnet`](https://testnet.nearblocks.io/address/as-testusd-mvpk08ejfxll.testnet) |
| Fee account | [`as-fees-mvpk0dcbi4e5.testnet`](https://testnet.nearblocks.io/address/as-fees-mvpk0dcbi4e5.testnet) |
| Owner | [`as-owner-mvpk01huplnq.testnet`](https://testnet.nearblocks.io/address/as-owner-mvpk01huplnq.testnet) |
| Vault deploy tx | [`EzcQiMRsLRGAewMvf9zVdg7CzpKwSxahYA5gGHbrykFm`](https://testnet.nearblocks.io/txns/EzcQiMRsLRGAewMvf9zVdg7CzpKwSxahYA5gGHbrykFm) |
| Vault init tx | [`7wqhV7aDLKuUc3tpufKiLMsT3S7r8RwjTvxxbEnQTnVp`](https://testnet.nearblocks.io/txns/7wqhV7aDLKuUc3tpufKiLMsT3S7r8RwjTvxxbEnQTnVp) |
| Policy v2 sync tx | [`J3ysChNeTU6Agcbv41FVN8MkTHfUEmeteA4GCyr6NKeC`](https://testnet.nearblocks.io/txns/J3ysChNeTU6Agcbv41FVN8MkTHfUEmeteA4GCyr6NKeC) |

Seeded policy: total $200, per-transaction $25, daily $100, weekly $150, unknown merchant
`deny`, approvals `selected_merchants` (Lighthouse Research requires approval). Two
function-call keys are active (Research and Ops), both scoped to `pay` on the vault. The
owner has a full-access key, used only by the server-side demo signer.

Addresses and state change if you re-provision with `pnpm db:reset` and `pnpm seed`. Treat
the table above as the state of the current demo workspace, not a permanent deployment.

---

## Final submission

The hackathon requires a **public repository** and a **public X demo post** before
`2026-11-14T23:59:00Z`, plus one submission per team.

- Public repository: <https://github.com/sufianweb3/tridon> (pushed).
- X demo post: **not posted.**
- Hackathon submission: **not submitted.**

Before submitting:

1. Run the final test yourself: `pnpm dev`, then the walkthrough in `docs/DEMO.md`.
2. Re-run `pnpm test`, `pnpm typecheck`, and `pnpm build`.
3. Confirm `.env.local`, `data/`, and `data/master.key` are not committed.
4. Add a LICENSE if you want one; none is included yet.
5. Record a short demo video or write the X post covering: the vault, the agent key
   scope, an allowed payment, a denied payment, an approval, revocation, and the
   testnet explorer links.
6. Submit through `POST https://nearhackathon.com/api/applications` with the repository
   URL and the X post URL.

Suggested track: **06 - AI Security & Defense** (also fits the agents / real-world
categories). The core claim to demonstrate is the separation between backend policy and
on-chain enforcement, not "an AI that pays".

---

## Documentation

- [`PRD.md`](PRD.md) - product scope, journeys, policy model, fees, acceptance criteria.
- [`docs/architecture/decision-record.md`](docs/architecture/decision-record.md) -
  verified NEAR capabilities, chosen design, alternatives, threat model, phases, and the
  Neon integration ADR.
- [`docs/DEMO.md`](docs/DEMO.md) - click-by-click final test script.
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) - official documentation registry and
  research checklist.
