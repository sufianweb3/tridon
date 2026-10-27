# Architecture decision record — AgentSpend

**Status:** Decided for testnet MVP. **Mainnet spending is NOT approved.**
**Last updated:** 2026-10-24
**Owner:** Architecture / security review
**Supersedes:** the placeholder ADR (all sections were `TBD`)

This record answers the eleven items required by `docs/INTEGRATIONS.md` §5 and the open
decisions in `PRD.md` §19. It is the gate described in `AGENTS.md` step 3: no provider-specific
implementation code is written until this document is reviewed.

---

## 0. Decision summary

| # | Decision | Choice | Confidence |
|---|---|---|---|
| D1 | Demo network | NEAR **testnet** only | High |
| D2 | Demo asset | Circle-issued **USDC** (NEP-141, 6 decimals) | High |
| D3 | Scoped authority | **Per-user policy/vault contract** + agent-specific NEAR **function-call key** managed by that contract | High on mechanism, must pass Phase 0 spike |
| D4 | Where limits are enforced | **Hard limits on-chain** in the vault contract; backend is a fast-fail pre-check and UX layer | High |
| D5 | Merchant payout | Direct NEP-141 `ft_transfer` from the vault to a **payout account pinned in on-chain state** | High |
| D6 | Settlement truth | NEAR RPC transaction outcome at **FINAL** finality, inspecting the specific `ft_transfer` receipt, read from **two independent RPC providers** | High |
| D7 | Wallet connection | `@hot-labs/near-connect` 0.11.4 + **NEP-413** `signMessage` for backend session auth | Medium-high |
| D8 | NEAR Intents | **Rejected for MVP.** Deferred to cross-chain funding/swap scope | High |
| D9 | x402 | **Rejected as the authorization layer.** Kept as a future merchant-facing adapter | Medium-high |
| D10 | Application stack | pnpm TypeScript monorepo, Next.js UI, Postgres + Drizzle, Rust contract | Medium |
| D11 | Custody model | Per-user, user-owned, non-upgradeable vault. **The platform holds no key on any vault and no pooled balance.** | High |

The single most important finding: **a function-call access key scoped to a policy contract,
where the policy contract holds the user's USDC and enforces limits in its own code, is the only
NEAR-native mechanism found that gives an always-online agent autonomous spending authority that
is (a) capped per transaction, per merchant and per time window, (b) revocable at the protocol
level, and (c) impossible to use to drain the user's balance.** Everything else evaluated either
requires the user to be online per payment, or gives the holder unrestricted transfer ability.

---

## 1. Evidence standard

- "Verified" means: read in current official documentation on **2026-10-24**, or read directly
  from chain state via JSON-RPC. Links are in §12.
- "Unverified" means: plausible but not confirmed, and therefore a Phase 0 gate (§8). Nothing in
  this document may be silently upgraded from unverified to fact during implementation.
- No mainnet contract address or SDK method is asserted here unless it appears in §12 or was
  queried from RPC.
- Where official docs conflict with this record, the docs win and this record must be amended.

---

## 2. Verified environment facts

### 2.1 Network and asset

| Item | Value | How verified |
|---|---|---|
| Demo network | NEAR testnet (`rpc.testnet.near.org`) | Docs + live RPC |
| Testnet USDC contract | `3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af` | Circle "USDC contract addresses" page, cross-checked against RPC |
| Testnet USDC metadata | `spec: ft-1.0.0`, `name: USDC`, `symbol: USDC`, `decimals: 6` | `ft_metadata` via RPC |
| Testnet USDC total supply | `14,081,220.21036777` USDC at check time | `ft_total_supply` via RPC |
| Storage registration cost | `0.00125 NEAR` per account | `storage_balance_bounds` via RPC |
| Mainnet USDC contract (reference only) | `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1` | Circle page + RPC metadata |
| unrelated mock token | `usdc.testnet` exists and reports 6 decimals, but has no icon/reference metadata. **Do not use it** and do not confuse it with Circle USDC. | RPC |

Monetary arithmetic is integer base units (6 decimals for USDC). `1 USDC = 1_000_000` base units.
Floats are forbidden in the policy engine, the ledger and the contract.

### 2.2 Access keys — the pivotal capability

From `docs.near.org/protocol/access-keys` and Nomicon's action spec:

- A **Function-Call key** has `receiver_id`, optional `method_names`, and optional `allowance`.
  It **cannot attach NEAR** to a call, and it can only call the named contract/methods.
- `allowance` is a **gas-only** budget. If omitted, gas is unlimited (paid by the account balance).
  Once exhausted the key stops working, and **the allowance of an existing key cannot be changed** —
  rotation means delete + re-add.
- A Function-Call key can only sign a transaction containing a single `FunctionCall` action.
  It cannot `Transfer`, `AddKey`, `DeleteKey`, `DeployContract` or `DeleteAccount`.
- `AddKey`, `DeleteKey`, `DeployContract`, `Stake` and `DeleteAccount` require
  `predecessor_id == receiver_id`. Therefore **a contract can add or delete access keys on its own
  account**, and the official docs say so explicitly: *"To add a key, you need a full access key, or
  a method in the account's own contract that adds keys."*
- Quirk that must be coded around: when a key is added via the
  `promise_batch_action_add_key_with_function_call` host function, **`allowance = 0` means
  unlimited**, not zero. Always pass an explicit non-zero allowance.
- `signer_account_pk()` exposes the public key that signed the transaction, so a contract can map a
  request to an agent identity without trusting a caller-supplied `agent_id`.
- Removing every key from an account **locks** it: only its own contract can act. A locked account
  can still add keys to itself if the contract exposes a method that does so.

Consequence: a key scoped to `vault.pay` cannot move tokens directly. It can only ask the vault,
and the vault's code decides whether to move anything. This is genuine capability reduction, not
UI-level policy.

### 2.3 Settlement and finality

- `tx` / `EXPERIMENTAL_tx_status` accept `wait_until: "FINAL"`; a response with
  `final_execution_status !== "FINAL"` is **not** settlement.
- A transaction's top-level `status: Success` only means the **first** receipt succeeded.
  Cross-contract receipts (our `ft_transfer`) execute as separate receipts and can fail
  independently. Verification must inspect the specific receipt in `receipts_outcome`, not the
  transaction status alone.
- NEP-141 confirms `ft_transfer(receiver_id, amount, memo?)` — `memo` is part of the standard and
  is emitted in the `EVENT_JSON` (NEP-297) log, which makes payment reconciliation possible without
  trusting our own database.

### 2.4 Fees and storage (for unit economics, §7)

- Gas price floor: `1 Tgas = 0.0001 NEAR` (`1 gas = 100,000,000 yoctoNEAR`).
- Storage: `1 NEAR per 100 KB` = `0.00001 NEAR per byte`.
- Account creation: storage for the account record and its first key (small; measured in the spike).
- Contract code storage is locked while the account exists and is refunded if the account is deleted.
- Global contracts (`DeployGlobalContract` / `UseGlobalContract`) allow many accounts to reference
  one immutable code hash; deployment is charged at a higher burned rate, but per-account cost drops
  to near zero. Relevant to mainnet, not required for the testnet demo.

### 2.5 Tooling versions verified on npm/crates.io

| Package | Version | Role |
|---|---|---|
| `@hot-labs/near-connect` | 0.11.4 | Browser wallet connector |
| `near-api-js` | 7.4.0 | Server-side tx build/sign/submit, RPC |
| `@near-js/transactions` | 2.5.1 | Action encoding (if used directly) |
| `near-kit` | 0.20.2 | Alternative client; **not** selected, not evaluated deeply |
| `near-sdk` (Rust) | **5.29.1 stable** | Contract SDK (5.30.0-rc.1 exists; do not ship an RC) |
| `near-workspaces` | pin latest **stable** at Phase 0 | Contract integration tests |
| `@x402/near` | 2.28.0 | Not used in MVP |
| `@fastnear/x402` | 2.5.0 | Not used in MVP |

Pin exact versions and commit the lockfile. Verify maintainers before installing.

### 2.6 Costs of the rejected rails (recorded, not used)

- NEAR Intents: protocol fee `0.0001%`; 1Click `0.2%` with API key / `0.25%` without; app fees
  configurable. **No testnet deployment.** Every account key created by the flow has full control.
- x402 exact-NEAR: facilitator fee `0` on the FastNear testnet instance; `/verify` and `/settle`
  are API-key gated; testnet facilitator is a community-run instance
  (`https://test.x402.mikedotexe.com`). Requires a **full-access** payer key because settlement is a
  NEP-366 `SignedDelegate` wrapping `ft_transfer`.

---

## 3. Chosen architecture

### 3.1 Why pre-funding is unavoidable (and why it is not platform custody)

NEP-141 on NEAR has **no `approve` / `transferFrom`** pull primitive. A contract cannot move tokens
out of a user's wallet without the user signing that specific transfer. Therefore an agent that must
pay while the user is offline can only spend from a balance that already sits somewhere the contract
controls.

The design puts that balance in a **vault account owned by the user**:

- one NEAR account per policy (`vault-<id>.agentspend.testnet` on testnet);
- the vault's contract code is the platform's published policy contract, deployed once per vault
  (testnet) or referenced as an immutable global contract (mainnet path);
- the vault account's full-access key belongs to the **user's wallet**, not the platform;
- the platform never holds a key on the vault: the account is created with the user's public key in
  the same transaction (`CreateAccount` → `AddKey(user)` → `DeployContract` → `init`). NEAR's
  `CreateAccount` chaining rule makes the new account the predecessor for subsequent actions, so the
  funding/signing account never gains control of the vault. The key supplied must be a **FullAccess**
  key on the user's account; verify it with `view_access_key` before use.
- `owner = <user account>` is immutable in contract state; there is no admin, no proxy, no upgrade
  entry point, and no platform withdrawal path.
- the vault is a sub-account of the platform account for naming only. NEAR gives a parent account no
  control over an existing sub-account, so `agentspend.testnet` cannot act on `vault-<id>...`.

This is a user-owned smart-contract vault, not a pooled platform balance. It is also **not
zero-custody**: the user delegates bounded spend authority to code they own. That distinction must
appear in the UI (PRD §14) and is restated in §5.

Mainnet alternative if the code cannot be audited in time: do not ship. The global-contract path
reduces per-user cost but not per-user risk.

### 3.2 Components

```
┌──────────────┐   bearer token    ┌───────────────────────────────┐
│ Agent runtime│ ─────────────────▶│ AgentSpend API (Next.js/Node) │
└──────────────┘                   │  • authn/authz               │
                                   │  • deterministic policy      │
┌──────────────┐   NEP-413 login   │  • atomic reservation (PG)   │
│ User wallet  │ ─────────────────▶│  • tx build/sign/submit      │
│ (Near Connect)│                  │  • settlement verifier       │
└──────────────┘                   │  • fee ledger + webhooks     │
        │ approve / pause /       └───────┬───────────────┬──────┘
        │ revoke / withdraw / policy       │               │
        ▼                                  ▼               ▼
┌──────────────────────┐          ┌───────────────┐  ┌──────────────┐
│ Vault contract       │  ft_transfer │ Circle USDC  │  │ Postgres     │
│ (per user, immutable)│ ───────────▶│ (NEP-141)    │  │ ledger +     │
│  owner = user        │              └───────┬───────┘  │ reservations │
└──────────┬───────────┘                      │          └──────────────┘
           │ callback                         │
           ▼                                  ▼
   on-chain accounting                 Merchant payout account
```

Runtime processes:

1. **web** — user dashboard, merchant dashboard, approval queue, history.
2. **api** — agent API, merchant API, wallet session, policy CRUD, payment orchestration.
3. **worker** — settlement polling, reservation expiry, webhook delivery, reconciliation. Uses
   Postgres `SELECT … FOR UPDATE SKIP LOCKED`; no Redis in the MVP.

### 3.3 Trust boundaries

| Party | Can do | Cannot do |
|---|---|---|
| Agent (bearer token + platform-held FC key) | Call `vault.pay` within policy | Transfer tokens directly, withdraw, change policy, add keys, exceed on-chain caps |
| Platform backend | Submit `pay`, read chain, write ledger, sign webhooks | Move vault funds, withdraw, change policy, exceed caps, bypass approval gate |
| User wallet | Owner methods: approve, pause, revoke, set policy, add/remove merchants, withdraw | Spend beyond its own balance semantics; cannot rewrite past payments |
| Merchant | Receive to pinned payout, read status | Redirect payout without a new policy entry; pull funds |
| NEAR validators / RPC | Execute and report | Forge a FINAL receipt with a valid signature (verification uses two providers anyway) |

The backend is **untrusted for money movement**. A fully compromised backend can, at worst, cause
payments that the on-chain policy already permits, to merchants the user already allowlisted, up to
the user's caps and balance. It cannot exceed them. It can also leak metadata and break UX.

### 3.4 On-chain state

```rust
struct Vault {
    owner: AccountId,                 // immutable, user wallet
    token: AccountId,                 // USDC, immutable
    platform_fee_account: AccountId,  // immutable
    user_fee_bps: u16,                // 50 = 0.5%
    merchant_fee_bps: u16,            // 50 = 0.5%
    paused: bool,
    policy: Policy,
    agents: LookupMap<String, Agent>,        // key: public key string
    agents_by_id: LookupMap<String, String>, // agent_id -> public key string
    merchants: LookupMap<String, MerchantRule>,
    payments: LookupMap<String, Payment>,    // payment_id -> record (pruned after 30d)
    seen_payments: LookupMap<Vec<u8>, u64>,  // sha256(payment_id) -> terminal_at (permanent)
    approvals: LookupMap<String, Approval>,  // approval_hash -> approval
    day_spend: LookupMap<u32, u128>,         // UTC day index -> gross committed
    total_gross_committed: u128,             // settled + in-flight gross
    accounted_balance: u128,                 // deposits - withdrawals - settled debits
    reserved_debit: u128,                    // user fee + gross currently in flight
}

struct Policy {
    total_budget: u128,        // gross
    per_tx_limit: u128,
    daily_limit: u128,         // rolling UTC day buckets
    weekly_limit: u128,        // sum of last 7 buckets
    monthly_limit: u128,       // sum of last 30 buckets
    valid_from_ms: u64,
    expires_at_ms: u64,
    unknown_merchant_mode: UnknownMerchantMode, // Deny | RequireApproval | AllowWithCap(u128)
    approval_mode: ApprovalMode,                // All | NoneWithinPolicy | Selected | UnknownOnly
    version: u32,
}

struct MerchantRule {
    payout: AccountId,     // pinned when the user allowlists the merchant
    per_tx_limit: u128,    // 0 = fall back to policy
    window_limit: u128,    // 0 = disabled
    window_secs: u64,
    window_start_ms: u64,
    window_spent: u128,
    active: bool,
}

struct Agent {
    agent_id: String,
    public_key: PublicKey,
    status: Active | Revoked,
    created_at_ms: u64,
}

struct Payment {
    agent_id: String,
    merchant_id: String,
    payout: AccountId,
    gross: u128,
    user_fee: u128,
    merchant_fee: u128,
    net: u128,
    day_index: u32,      // UTC day the gross was counted against (survives midnight rollover)
    status: Reserved | MerchantPaid | Succeeded | Failed,
    fee_owed: u128,
    created_at_ms: u64,
    terminal_at_ms: u64,
}
```

Time-window definitions (PRD §7 asks for this explicitly): **all windows are UTC**. Daily =
calendar UTC day (`timestamp_ms / 86_400_000`). Weekly = the current UTC day plus the previous 6
buckets. Monthly = the current UTC day plus the previous 29 buckets. Yearly is **backend-only**
(365 bucket reads is not economical gas) and is labelled as such in the UI.

### 3.5 Contract interface

| Method | Caller | Purpose |
|---|---|---|
| `new(owner, token, fee_account, config)` | deploy tx | One-time init, `#[init]` guarded. Registers the vault with the token (`storage_deposit`) during setup. |
| `ft_on_transfer(sender, amount, msg)` | USDC only | Assert `predecessor == token`; credit `accounted_balance`, return `"0"` |
| `pay(payment_id, merchant_id, gross, request_expiry_ms)` | agent FC key | Authorize + execute one payment |
| `approve(payment_id, merchant_id, gross, request_expiry_ms, approval_expiry_ms)` | owner | Bind an approval to exact payment parameters |
| `set_policy(...)` | owner | Replace policy, bump `version` |
| `pause()` / `unpause()` | owner | Immediate stop / resume |
| `add_agent(agent_id, public_key)` | owner | Register agent + add FC key (`method_names=["pay"]`, explicit allowance) |
| `rotate_agent_key(agent_id, new_public_key)` | owner | Recover from exhausted allowance |
| `revoke_agent(agent_id)` | owner | Mark revoked + `DeleteKey` |
| `add_merchant(merchant_id, payout, ...)` / `remove_merchant` | owner | Allowlist with pinned payout |
| `withdraw(amount, to)` | owner | Move only *free* balance (`accounted_balance - reserved_debit`); `to` must be storage-registered |
| `reconcile_payment(payment_id, succeeded)` | owner | Manual repair if a callback was lost |
| `collect_fee(payment_id)` | anyone | Retry a `fee_owed` transfer; idempotent, fixed destination and amount |
| `prune(payment_ids)` | anyone | Delete full `Payment` records older than 30 days to refund storage. The permanent `seen_payments` marker is **never** deleted, so replay protection does not expire. |
| `get_state()` / `view_*` | anyone | Dashboard + backend cache reads |

Deposit path: the user calls USDC `ft_transfer_call({ receiver_id: vault, amount, msg: "deposit" })`.
The vault credits `accounted_balance` in `ft_on_transfer` **only** when `predecessor == token`; any
other caller is rejected. The vault must be storage-registered with USDC first (`new` does this).

`pay` logic, in order (all checks before any transfer):

1. `predecessor == current_account` (no third-party proxying), `attached_deposit == 0`,
   `!paused`, `now >= valid_from`, `now < expires_at`, `now <= request_expiry_ms`.
2. `signer_account_pk()` → `agents[pk]`; must be `Active`. Ignore any caller-supplied agent id.
3. `merchants[merchant_id]` must exist and be active → `payout`, caps. Unknown merchant follows
   `unknown_merchant_mode`; `AllowWithCap` uses the configured cap as the per-tx limit.
4. Amounts, integer only:
   `user_fee = ceil_div(gross * 50, 10_000)`, `merchant_fee = ceil_div(gross * 50, 10_000)`,
   `net = gross - merchant_fee`, `debit = gross + user_fee`.
5. Caps: `gross <= per_tx_limit` (and merchant override),
   `total_gross_committed + gross <= total_budget`, `gross <= remaining daily/weekly/monthly`,
   `gross` within the merchant rolling window, `debit <= accounted_balance - reserved_debit`.
6. Approval: if the mode requires it, `approvals[approval_hash]` must exist, be unexpired, and match
   the exact `(payment_id, merchant_id, gross, request_expiry_ms, policy.version)`. The hash binds
   the parameters so an approval cannot be reused for a different amount or merchant.
7. Idempotency: `seen_payments[sha256(payment_id)]` must not exist. If it exists, do **not** transfer
   again: return the retained terminal state when the full record is still present, or
   `AlreadyProcessed` when it has been pruned. A marker never expires, so replay protection is
   permanent; only the bulky record is pruned.
8. Reserve: write `Payment{Reserved, day_index}`, `reserved_debit += debit`,
   `day_spend[day_index] += gross`, `total_gross_committed += gross`. `seen_payments` is written at
   the same time, so replay protection exists from the first attempt.
9. `ft_transfer(payout, net, memo="agentspend:v1:<payment_id>")` with exactly 1 yoctoNEAR attached,
   `.then(on_merchant_transfer)`.
10. `on_merchant_transfer` (`#[private]`): on success → `MerchantPaid` (the day bucket already counted
    the gross at reservation, so it is kept), `accounted_balance -= debit`,
    `reserved_debit -= debit`, then issue
    `ft_transfer(fee_account, user_fee + merchant_fee, memo="agentspend-fee:v1:<payment_id>")`
    `.then(on_fee_transfer)`. On failure → `Failed`, release the reservation
    (`reserved_debit -= debit`, `day_spend[payment.day_index] -= gross`,
    `total_gross_committed -= gross`) and emit an event.
11. `on_fee_transfer`: set `Succeeded` in both cases; on failure record `fee_owed` for retry via
    `collect_fee`. A fee failure must never turn a paid merchant transfer into a failed payment.

Invariants:

- **I1** `reserved_debit <= accounted_balance` at all times.
- **I2** A payment reaches a terminal state exactly once and never moves backwards
  (`Reserved → MerchantPaid → Succeeded`, or `Reserved → Failed`).
- **I3** Total debits on success equal `net + merchant_fee + user_fee = gross + user_fee`.
- **I4** No fee transfer is issued before the merchant transfer succeeds → **no platform fee on a
  failed or blocked payment, structurally** (PRD §8, acceptance test 11).
- **I5** `withdraw` can never touch reserved funds.
- **I6** The payout used is the one in on-chain `MerchantRule`, never one supplied by the agent.
- **I7** No code path can add a key other than `pay`-scoped FC keys, and only for a registered agent.

### 3.6 Why the fee transfer is chained, not parallel

Two independent `ft_transfer` promises are not atomic. If both were issued in parallel, the fee
could succeed while the merchant transfer fails, charging a fee on a failed payment. Chaining the
fee after the merchant callback makes the illegal ordering impossible. The cost is one extra receipt
of latency. This is the correct trade.

Residual: if the merchant transfer succeeds and the fee transfer fails, the vault still holds the
fee. That is a revenue-reconciliation problem, never a user or merchant loss. `fee_owed` +
`collect_fee` makes it retryable and idempotent.

### 3.7 Agent key lifecycle

```
add_agent(agent_id, pk)
  ├─ store Agent{Active}
  ├─ promise_batch_create(self)
  │    └─ add_key_with_function_call(pk, allowance = 0.05 NEAR,
  │         receiver = self, methods = ["pay"], deposit = 0)
  └─ emit AgentKeyAdded

revoke_agent(agent_id)
  ├─ Agent.status = Revoked        (immediate for backend + policy checks)
  └─ DeleteKey(pk)                 (protocol-level; authoritative at FINAL)
```

- One key per agent. The platform stores the private key encrypted (AES-GCM, key from env/secret
  manager) because the agent API signs server-side. The raw key never leaves the backend.
- Concurrency: the FC key has a single nonce sequence. Payment submission is serialized per key
  (Postgres advisory lock or in-process mutex) with an explicit nonce allocator. On `InvalidNonce`,
  re-read the access key and re-sign. Never broadcast two transactions with the same nonce.
- Revocation is effective **when the `DeleteKey` receipt is FINAL**, not when the API returns.
  Acceptance test 5 must poll finality before asserting failure.
- Allowance exhaustion is a denial-of-service, not a fund loss: rotate the key (delete + add; the
  allowance of an existing key cannot be edited).
- A leaked agent key can only burn its allowance and call `pay` within policy. It cannot withdraw or
  change policy. This is the advertised blast radius.

### 3.8 End-to-end payment sequence

```
Agent          API              Postgres        Vault contract      USDC
  |             |                  |                 |                |
  |-- POST pay ->|                  |                 |                |
  |             |-- reserve ------>|                 |                |
  |             |<-- ok -----------|                 |                |
  |             |-- sign pay() + submit ------------->|                |
  |             |                  |                 |-- ft_transfer ->|
  |             |                  |                 |<- callback -----|
  |             |                  |                 |-- fee transfer ->|
  |             |<-- tx hash ------|                 |                |
  |             |-- tx outcome (FINAL, 2 RPCs) ----->|                |
  |             |-- commit + ledger + webhook        |                |
  |<-- succeeded -                  |                 |                |
```

Payment states (PRD §12), monotonic:

`created → policy_checking → awaiting_approval → authorized → submitted → confirming → succeeded`

plus `denied`, `cancelled`, `expired`, `failed`, `unknown`. `unknown` is never fulfilled. A late
provider response may not move a terminal state backwards.

### 3.9 Backend reservation and the on-chain relationship

The backend reservation exists to give a fast, cheap `DENY` and a stable idempotency story. It is
**not** the authority. The contract is.

- Reservation is taken inside a transaction that locks the policy row
  (`SELECT … FOR UPDATE`) and recomputes usage from committed rows plus live reservations.
  Two concurrent requests serialize; the second sees the first reservation.
- Reservation rows carry `amount_gross`, `amount_debit`, `expires_at`, `status`.
- On `ALLOW`, the backend submits `pay`. If the contract rejects (race, policy changed, budget
  exhausted on-chain), the reservation is released and the agent receives a machine-readable
  `ONCHAIN_REJECTED` reason.
- On definitive failure, release. On success, commit. On `unknown`, keep the reservation until
  reconciliation; do not let it expire into "released" silently.
- A `reconcile_policy` job reads `get_state()` and repairs local counters. Divergence resolves in
  favour of the chain, always.

Submitting safely: persist the signed transaction (hash + bytes) **before** broadcast. If the process
dies mid-flight, the worker recovers by hash instead of double-spending.

### 3.10 Settlement verification

`SettlementVerifier.verify(txHash, expectation)`:

1. Call `tx` with `wait_until: "FINAL"` against **two independent RPC providers**; require identical
   `final_execution_status === "FINAL"` and identical outcome hashes.
2. Walk `receipts_outcome` and find the receipt where `receiver_id == USDC` and the single action is
   `FunctionCall{ method_name: "ft_transfer" }`.
3. Base64-decode the args and assert **all** of: `receiver_id == merchant.payout`,
   `amount == net`, `memo == "agentspend:v1:<payment_id>"`.
4. Assert that receipt's `outcome.status` is `SuccessValue` (empty string for `ft_transfer`).
5. Reject if the vault contract account id, token account id or network does not match the
   expected configuration.
6. Only then mark `succeeded`, commit the reservation, write the fee ledger and enqueue the webhook.

Verifying "the tx succeeded" is insufficient: the top-level status covers only the first receipt, and
it says nothing about recipient, amount or reference. This is the difference between "submitted" and
"settled" that PRD §6.2 and acceptance test 7 require.

### 3.11 Merchant identity and payout pinning

- A merchant registers an account, a payout wallet, and services/prices.
- Payout ownership is proven with NEP-413: the merchant signs a message containing
  `merchant_id`, `payout_account`, and a server nonce. The backend verifies the signature and stores
  the binding.
- When a user allowlists a merchant, the **payout account is copied into the on-chain
  `MerchantRule`**. Later changes to the merchant's payout require the user to re-allowlist. This
  closes the "merchant account takeover redirects future payments" hole at the cost of an extra
  approval step.
- Agents submit `merchant_id`, never a payout address. `payout` is resolved on-chain.
- The backend additionally checks the service/price against the merchant's catalog. The chain cannot
  do this; it is a documented backend-only control (§4).

### 3.12 Data model notes (deltas to PRD §10)

PRD §10 is sufficient. Additions required by this design:

- `vaults` — `policy_id`, `vault_account_id`, `code_hash`, `token_account_id`, `owner_account_id`,
  `created_tx_hash`, `deployment_mode` (`platform_deployed` | `user_deployed`).
- `agent_keys` — `agent_id`, `public_key`, `key_status`, `allowance_yocto`, `added_tx_hash`,
  `revoked_tx_hash`, `encrypted_secret_ref` (a **reference** to a secret manager entry, never the
  secret in the row).

`wallet_connections` stores public keys and provider metadata only. No seed phrases, ever.

### 3.13 Application stack

The repository is empty (docs only), so there is no stack to preserve.

```
apps/web        Next.js (App Router), React, Tailwind — UI + BFF route handlers
apps/worker     Node worker — settlement, expiry, webhooks, reconcile
packages/core   Pure TS: money (bigint base units), policy engine, state machine
packages/db     Drizzle schema + migrations
packages/near   Contract client, tx builder/nonce manager, settlement verifier
contracts/vault Rust, near-sdk 5.29.1, near-workspaces tests
```

Rationale: `packages/core` is pure and therefore exhaustively testable without a database or chain;
the contract is the only place with money-moving authority; the worker isolates retryable I/O from
request latency. Postgres + Drizzle because reservation correctness needs explicit `FOR UPDATE`
semantics and we want SQL we can read during a security review.

Reversible later: framework, ORM, UI kit. Expensive to reverse: custody model, `pay` signature,
fee basis, payout pinning. Treat those as one-way doors.

---

## 4. Enforcement matrix

Required by `AGENTS.md` ("distinguish backend vs on-chain") and PRD §14 ("show which controls are
enforced on-chain/provider-side versus by the application backend").

| Control | On-chain | Backend | If the backend is fully compromised |
|---|---|---|---|
| Total budget | Yes | Mirror | Cannot exceed |
| Per-transaction limit | Yes | Mirror | Cannot exceed |
| Daily / weekly / monthly caps | Yes (UTC buckets) | Mirror | Cannot exceed |
| Yearly cap | No | Yes | Can exceed; UI must label "backend-enforced" |
| Merchant allowlist | Yes | Mirror | Cannot pay a non-allowlisted merchant |
| Merchant payout address | Yes (pinned) | Resolved from DB | Cannot redirect |
| Per-merchant window cap | Yes | Mirror | Cannot exceed |
| Unknown-merchant mode | Yes | Mirror | Cannot bypass denial; can still *ask* for approval |
| Approval gate | Yes | Queue/notify | Cannot skip an on-chain-required approval |
| Agent active/revoked | Yes (key deletion) | Mirror | Revoked key cannot sign at all |
| Pause | Yes | Mirror | Cannot resume |
| Policy expiry | Yes | Mirror | Cannot extend |
| Fee amounts | Yes (computed on-chain) | Displayed | Cannot overcharge |
| No fee on failure | Yes (chained) | Ledger check | Structurally impossible |
| Payment idempotency | Yes (per payment id) | Idempotency key | Cannot double-charge with the same id |
| Service/price matches catalog | No | Yes | Can overpay an allowlisted merchant up to caps |
| Rate limiting / abuse | No | Yes | Lost |
| Settlement verification | Chain data is public | Yes | Can lie to itself; cannot forge FINAL receipts |
| Credential hashing | N/A | Yes | Secrets exposed |

The honest summary for the UI: **money movement and spending limits are enforced on-chain. Catalog
validation, rate limits and yearly caps are backend controls.** Never describe the product as
"trustless"; describe it as "bounded by an immutable contract you own".

---

## 5. Threat model

| # | Threat | Mitigation | Residual risk |
|---|---|---|---|
| T1 | Agent key stolen | FC key scoped to `pay`; on-chain caps; allowance cap; instant rotation | Attacker can spend within policy until revoked |
| T2 | Agent bearer token stolen | Hashed at rest, shown once, short TTL, rotation, rate limit | Same as T1 |
| T3 | Backend compromised | No vault key; cannot withdraw or change policy; caps still bind | Can spend within policy; can leak metadata; can suppress webhooks |
| T4 | Malicious merchant / payout change | Payout pinned on-chain; NEP-413 ownership proof; re-allowlist on change | User must notice a payout change prompt |
| T5 | Replay / duplicate payment | On-chain `payment_id` marker (permanent) + backend idempotency key + signed webhook event ids | Full record is pruned after 30 days; the replay marker is not |
| T6 | Concurrent overspend | Contract serializes state per account; backend `FOR UPDATE` reservation | None found for total/daily caps |
| T7 | Submitted but not settled | FINAL-only verification; `unknown` never fulfils | RPC outage delays fulfilment (fails closed) |
| T8 | Partial settlement | Fee chained after merchant success; `fee_owed` retry | Temporary fee receivable |
| T9 | Callback lost / out of gas | Generous attached gas; `reconcile_payment` owner-only; backend treats chain as truth | Manual reconciliation needed; budget under-reported (safe direction) |
| T10 | Merchant not storage-registered | `storage_balance_of` checked at registration; transfer failure → `failed`, reservation released | Payment fails, no fee (correct) |
| T11 | Integer overflow / rounding | `u128` + checked math; basis points with `ceil_div`; no floats anywhere | Minimum payment size enforced |
| T12 | SSRF via merchant webhook URL | Allowlist schemes/hosts, block private ranges, no redirects, egress proxy | Misconfiguration |
| T13 | Webhook forgery | HMAC-SHA256 over timestamp + body, `whsec_` per endpoint, 5-minute replay window | Secret leak |
| T14 | Contract bug drains vault | Small testnet balances only; no mainnet until independent review; immutable code means a bug is terminal per vault | Total loss of that vault's balance |
| T15 | User loses wallet key | Same exposure as any self-custodied account; no platform recovery by design | Permanent loss of vault funds |
| T16 | Griefing via `pay` spam | Per-key allowance, rate limits, `pay` requires valid unexpired params | Allowance burn → rotate |
| T17 | Platform deploys malicious code | Publish code hash + build reproducibility; user can verify `view_account().code_hash`; no upgrade path | User must actually verify |

Explicit non-claims: this is **not** audited, **not** trustless, **not** production-ready for
meaningful funds, and revocation does **not** reverse settled payments.

---

## 6. Alternatives rejected

### 6.1 NEAR Intents — rejected for MVP

What it is: an intent/solver layer for cross-chain swaps and transfers. What it is not: a checkout
API, a merchant payment rail, or a spending-policy engine.

Disqualifying facts:

- **No testnet deployment**, so it cannot satisfy the hackathon testnet requirement.
- Keys created by the flow **have full control** of the account, which violates PRD §13
  ("do not give an agent a generic signer").
- Fees (`0.0001%` protocol, `0.2–0.25%` 1Click) and solver latency add cost without adding
  authorization.
- The MVP needs same-chain USDC settlement with per-transaction limits; Intents solves a different
  problem.

Revisit when: cross-chain funding ("pay from Base USDC into a NEAR vault") becomes in scope. It
would sit *before* the vault, not replace it.

### 6.2 x402 — rejected as the authorization layer, kept as an optional adapter

x402 is a good HTTP `402 Payment Required` protocol. The NEAR `exact` scheme is real and has a
working testnet facilitator. It fails this product's core requirement:

- Settlement uses a NEP-366 `SignedDelegate` wrapping `ft_transfer`, which **requires a full-access
  payer key**. Function-call keys are explicitly rejected by the scheme. That is exactly the
  unrestricted authority the PRD forbids.
- The scheme enforces no per-transaction, per-merchant or time-window limits. The only cap is the
  payer's token balance.
- The testnet facilitator is a community instance; `/verify` and `/settle` are API-key gated, and
  availability/terms are not something a demo should depend on.
- Browser support was tested with one wallet (Meteor) and needs `signDelegateActions`; the official
  `@hot-labs/near-connect` connector was not confirmed to support delegate signing.

Decision: do not use x402 in the MVP path. If a merchant later wants an HTTP-native paywall, add an
`X402MerchantAdapter` that negotiates a 402 challenge and pays it **from the vault** (the vault
remains the signer of record). That keeps x402 at the edge and the policy in the vault.

### 6.3 Function-call key scoped directly to USDC — rejected

`ft_transfer` takes arbitrary `receiver_id` and `amount`. A key scoped to
`usdc.ft_transfer` can drain the whole balance to any address. It reduces *which contract* is
called, not *how much* or *to whom*. This is the trap the design must avoid, and the reason the
extra contract hop exists.

### 6.4 Backend-only policy + meta-transaction relayer — rejected

Cheapest to build, and it makes the demo pass. It also means a compromised backend can drain the
user, violating PRD §13 ("backend policy checks alone are not sufficient protection"). It is
acceptable only as the mock adapter in Phase 1, clearly labelled.

### 6.5 Multisig (agent + platform 2-of-2) — rejected

It gates *who approves* a transaction, not *how much* or *to whom*. There is no native per-tx or
per-merchant limit, no expiry, and the platform co-signer becomes a de facto custodian. More wallet
friction for weaker guarantees.

### 6.6 One shared policy contract for all users — rejected for MVP

Cheaper to deploy and easier to upgrade, but it pools every user's USDC in one account (PRD §5
forbids pooled platform balances), makes one bug catastrophic for everyone, and creates an admin
surface. Per-user contracts are more expensive on testnet and much easier to defend. Revisit only
with a formal audit and a per-user accounting proof.

### 6.7 Gas keys (prepaid gas) — deferred

Useful for sponsorship and nonce lanes, but orthogonal to authorization and adds wallet/tooling
unknowns. The MVP funds the vault with a small NEAR balance instead.

### 6.8 `near-connect` function-call-key plugin — not applicable

It generates a browser-local FC key at sign-in. Our agent key must be usable by the backend, so the
plugin's trust model does not fit. It is, however, evidence that wallets in this ecosystem do
support FC-key flows.

---

## 7. Fees, costs and unit economics

Platform fees (PRD §8), integer basis points on the **gross** amount:

```
user_fee     = ceil_div(gross * 50, 10_000)   // 0.5%, debited on top of gross
merchant_fee = ceil_div(gross * 50, 10_000)   // 0.5%, deducted from gross
net_to_merchant = gross - merchant_fee
total_debit  = gross + user_fee
platform_revenue = user_fee + merchant_fee     // 1.0% of gross
```

$100 example: user pays `100.50`, merchant receives `99.50`, platform records `1.00`, network costs
separate. On failure or denial: `0`.

Micro-payment floor: each fee must be at least 1 base unit, so `gross >= 200` base units
(`0.0002 USDC`) is the arithmetic floor. The **economic** floor is higher because of gas and storage:

- Gas: bounded prepay, measured in Phase 0. At the protocol floor, 50 Tgas = `0.005 NEAR`. Actual
  burn for `pay` + two FT transfers + two callbacks should be measured, not assumed.
- Transient storage per payment record: a few hundred bytes at `0.00001 NEAR/byte` ≈ `0.003 NEAR`,
  **refunded when `prune` deletes the record**. This is why `prune` exists; without it, storage would
  exceed the fee on small payments.
- Vault deployment (testnet): contract code ~150–250 KB → ~1.5–2.5 NEAR locked, refundable only if
  the account is deleted. Platform-sponsored for the demo, and a real cost line for production. The
  mainnet answer is an immutable global contract referenced by code hash.
- USDC storage registration: `0.00125 NEAR` per account (vault + each merchant payout).
- Account creation: `0.007 NEAR` per vault.

At an illustrative `$2/NEAR`, a payment costs roughly `$0.005–$0.015` in network resources. That
implies a **configurable minimum payment size in the `$1–$2` range** (below that, the 1% fee does not
cover gas) and a fee display that separates "platform fee" from "network cost", as the PRD requires.
These numbers are estimates to be replaced by Phase 0 measurements; they are not commitments.

No fee is ever charged on a blocked, denied, expired or failed payment — enforced by the chained
transfer (I4), not by a conditional in the backend.

---

## 8. Unresolved questions and Phase 0 gates

| # | Question | Why it matters | Gate |
|---|---|---|---|
| Q1 | Official hackathon rules, submission deadline, required integrations | Could invalidate scope or the chosen rail | **Blocking.** No event URL was supplied. Must be confirmed from the official site before Phase 1. |
| Q2 | Does Circle's faucet issue testnet USDC on NEAR? | Demo funding | Try `faucet.circle.com` (NEAR not confirmed in docs). Fallbacks: hackathon faucet, team transfer, or a clearly-labelled mock FT behind the same adapter. Never label a mock as USDC. |
| Q3 | Does `signer_account_pk()` return the contract-added FC key as expected? | Agent identity binding | Spike test on testnet |
| Q4 | Does `promise_batch_action_add_key_with_function_call` + `add_agent` work end-to-end from a contract? | Whole authorization model | Spike test on testnet |
| Q5 | Does Circle testnet USDC require exactly 1 yoctoNEAR on `ft_transfer`? | Transfer call correctness | Read the deployed contract behaviour in the spike |
| Q6 | Does `@hot-labs/near-connect` + target wallets return a **full-access** public key from `signMessage`? | Vault ownership at creation | Test with 2+ wallets; fallback = user signs an explicit `AddKey` |
| Q7 | Exact NEP-413 verification helper in `near-api-js` 7.4.0 | Login correctness | Verify API before coding; otherwise verify with `tweetnacl`/`@noble` directly |
| Q8 | Measured gas and storage per payment | Fee viability and minimum size | Phase 0 measurement, replace §7 estimates |
| Q9 | Nonce behaviour under concurrent submission | Acceptance test 4 | Load test in Phase 3 |
| Q10 | Wallet UX for multi-action deploy transactions | Vault creation flow | Test; fallback = platform-deployed vault with published code hash |

Q3, Q4, Q5 and Q9 are the ones that could force a design change. Everything else has a documented
fallback.

---

## 9. Implementation plan

Mapped to PRD §17. Each phase ends with a gate; do not start the next phase with an open gate.

### Phase 0 — Documentation and integration spike (current)

Deliverables:

1. This decision record, reviewed and approved.
2. Resolve Q1 (hackathon rules) and Q2 (faucet) — or record them as accepted demo risks.
3. A throwaway spike under `scripts/spike/` that proves, on testnet, in this order:
   - deploy the contract to `vault-spike.agentspend.testnet`;
   - `add_agent` from the contract adds an FC key scoped to `pay`;
   - the agent key signs a `pay` transaction **as the vault account** (signer = vault, key = agent);
   - the vault transfers testnet USDC to a second account via `ft_transfer`;
   - `revoke_agent` deletes the key and a subsequent `pay` fails to sign;
   - the verifier reads the receipt at FINAL and matches recipient/amount/memo;
   - measure gas and storage.
4. Record measured numbers in §7.

Gate: the spike works on testnet and the measured costs are recorded. No product code before this.

### Phase 1 — Product skeleton

- Monorepo, strict TypeScript, formatting/lint/typecheck scripts, `.env.example`, CI.
- Postgres + Drizzle migrations for PRD §10 plus `vaults` and `agent_keys`.
- `packages/core`: money (`bigint`), deterministic policy engine, state machine — pure functions.
- Full unit test suite for every policy rule and every legal/illegal state transition.
- Mock adapter and fixtures; UI shell with the enforcement labels from §4.
- Worker skeleton with the reservation-expiry job.

Gate: acceptance tests 2, 4 and 11 pass against the mock adapter; concurrency test runs 50 parallel
requests against a `$10` budget and never over-reserves.

### Phase 2 — Core product flow

- Near Connect login + NEP-413 session; wallet disconnect; account switching.
- Vault creation (testnet), deposit via `ft_transfer_call`, balance display.
- Agent create / rotate / revoke; credential shown once, stored hashed.
- Policy builder with plain-language summary, presets, and on-chain/backend labels.
- Merchant onboarding: payout proof, services, prices, API keys, webhook config.
- Approval queue (owner signs `approve`), transaction history, audit timeline.

Gate: create → fund → authorize agent → pause → revoke works end-to-end against the mock adapter,
with credentials never re-displayed or logged.

### Phase 3 — Real testnet rail

- Contract: full state machine, all limits, approvals, prune, reconcile, events.
- `near-workspaces` tests: caps, windows, approval binding, replay, revocation, fee chaining,
  withdrawal-vs-reservation, prune.
- Backend: tx builder, nonce manager, submitter, settlement verifier (two RPCs), fee ledger,
  signed webhooks, idempotent delivery, reconciliation job.
- Failure injection: RPC timeout after broadcast, callback gas exhaustion, merchant storage removal,
  duplicate webhook, duplicate idempotency key.

Gate: acceptance tests 1, 3, 5, 6, 7, 8, 9, 10 and 12 pass on testnet with real Circle USDC.

### Phase 4 — Hardening and demo

- Threat-model review against §5; fix or document each residual.
- Responsive and accessibility pass; empty/loading/error/unknown states.
- Deterministic demo seed + scripted run; "testnet only" labelling everywhere.
- Architecture diagram and a 3-minute demo narrative.
- Dependency and secret scan; confirm no secret in git history.

Gate: all twelve acceptance tests pass in one recorded run; `docs/architecture/decision-record.md`
updated with measured numbers and any deviations.

---

## 10. Acceptance test mapping

| PRD test | Mechanism that makes it pass | Phase |
|---|---|---|
| 1 Allowed payment | `pay` → chained `ft_transfer` → FINAL receipt match → ledger | 3 |
| 2 Per-transaction limit | On-chain `per_tx_limit`, checked before any transfer | 1 (mock), 3 (chain) |
| 3 Unknown merchant | On-chain `unknown_merchant_mode` + approval hash | 1, 3 |
| 4 Budget concurrency | Contract serialization + `SELECT … FOR UPDATE` reservation | 1, 3 |
| 5 Revocation | `revoke_agent` deletes the FC key; effective at FINAL | 2, 3 |
| 6 Duplicate request | Idempotency key + permanent on-chain payment marker | 1, 3 |
| 7 Unverified settlement | FINAL-only verifier; `submitted` ≠ `succeeded` | 3 |
| 8 Merchant receipt | Pinned payout + verified receipt + fee/net ledger | 3 |
| 9 User fee | `user_fee` separate ledger entry, integer math | 3 |
| 10 Credential safety | Hash at rest, show once, log redaction | 2 |
| 11 No fee on failure | Fee transfer chained after merchant success (I4) | 3 |
| 12 Auditability | `audit_events` + on-chain events + receipt memo | 2, 3 |

---

## 11. Definition of done and verification commands

The repository currently has no scripts. Phase 1 establishes and documents them. Expected shape:

```
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test            # unit: policy, money, state machine, fee math
pnpm test:integration # db reservations, webhooks, verifier fixtures
pnpm build
cargo test --manifest-path contracts/vault/Cargo.toml
cargo near build --manifest-path contracts/vault/Cargo.toml
```

Native `near-workspaces` tests run against a sandbox node and are part of `pnpm test:integration`.

Done means: all twelve acceptance tests pass on testnet; no secret in the repo or its history; no
payment marked successful without a FINAL receipt match; every policy rule and transition has a
test; fees are integer and idempotent; `.env.example` exists; and §8 has no open blocking question.

---

## 12. Sources reviewed (2026-10-24)

**NEAR protocol and contracts**

- Access keys, permissions, allowance caveats, key management from contracts:
  https://docs.near.org/protocol/access-keys
- Actions, `AddKey`/`DeleteKey` predecessor rule, `CreateAccount` chaining, global contracts,
  delegate actions: https://nomicon.io/RuntimeSpec/Actions.html
- Gas, buy/burn pricing: https://docs.near.org/protocol/transactions/gas
- Storage staking: https://docs.near.org/protocol/storage/storage-staking
- Gas keys: https://docs.near.org/protocol/accounts-contracts/gas-keys
- RPC `view_access_key` / `view_access_key_list`: https://docs.near.org/api/rpc/contracts
- NEP-141 fungible token core (`ft_transfer`, `memo`, `ft_transfer_call`):
  https://github.com/near/NEPs/blob/master/neps/nep-0141.md
- NEP-297 events: https://github.com/near/NEPs/blob/master/neps/nep-0297.md
- NEP-366 meta transactions: https://github.com/near/NEPs/blob/master/neps/nep-0366.md
- NEP-413 message signing: https://github.com/near/NEPs/blob/master/neps/nep-0413.md

**Wallets and auth**

- NEAR Connect: https://docs.near.org/tools/near-connect
- Wallet login tutorial: https://docs.near.org/web3-apps/tutorials/wallet-login
- Backend authentication with NEP-413: https://docs.near.org/web3-apps/backend/backend

**Assets**

- Circle USDC contract addresses (mainnet + testnet, NEAR rows):
  https://developers.circle.com/stablecoins/usdc-contract-addresses
- Testnet token explorer: https://testnet.nearblocks.io/token/3e2210e1184b45b64c8a434c0a7e7b23cc04ea7eb7a6c3c32520d03d4afcb8af

**Rejected rails**

- NEAR Intents: https://docs.near-intents.org
- NEAR Intents overview: https://intents.near.org/overview
- x402 protocol: https://docs.x402.org
- x402 NEAR `exact` scheme:
  https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_near.md
- FastNear x402 JS: https://js.fastnear.com/x402
- Facilitator reference access: https://github.com/fastnear/x402-facilitator/blob/main/docs/reference-access.md

**Chain-state checks performed for this record**

- `ft_metadata`, `ft_total_supply`, `storage_balance_bounds` on testnet and mainnet USDC via
  `rpc.testnet.near.org` / `rpc.mainnet.near.org`.
- `view_account` on `usdc.testnet` (confirmed it is a separate mock token).

---

## 13. Approval gate

This ADR authorizes **testnet implementation** and a **mock adapter** only.

Not authorized: mainnet deployment, real funds, custody of user balances by the platform, or any
claim of audit/security certification. Mainnet requires a separate review covering the finalized
contract, the deployment/key-provisioning flow, the verifier's RPC assumptions, fee collection, and
an independent security assessment.
