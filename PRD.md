# AgentSpend — Product Requirements Document

**Status:** MVP specification  
**Product category:** Agentic payments / spending permissions infrastructure  
**Hackathon context:** NEAR Hackathon  
**Working name:** AgentSpend (rename before public launch if desired)

## 1. Product summary

AgentSpend lets a user authorize an AI agent to spend a limited amount of the user's funds under explicit, revocable rules. Merchants and API providers can accept agent-initiated payments through a simple integration and receive settlement in a wallet they control.

The product is not intended to build a new general-purpose wallet, swap protocol, bridge, or settlement network. It should integrate existing infrastructure and build the missing product layer: user-friendly policies, enforceable authorization, merchant onboarding, payment orchestration, fee accounting, and an auditable transaction history.

### One-line value proposition

**Give AI agents permission to pay for useful services without giving them unrestricted access to your wallet.**

## 2. Problem

AI agents can discover and use online services, but they need a reliable way to pay for those services without receiving unrestricted access to a user's funds. Merchants also need a straightforward way to expose paid services to agents and verify that payment actually succeeded.

Existing wallet, chain, and payment tools may provide parts of the solution, but users still need a coherent layer for:
- Defining what an agent may spend.
- Enforcing total, per-transaction, merchant, and time-window limits.
- Requiring approval for selected or unknown merchants.
- Revoking an agent's authority.
- Giving merchants a consistent payment integration and verified payment result.
- Showing fees and maintaining a reliable audit trail.

## 3. Target users

### Primary: people and teams using AI agents
- Want agents to purchase APIs, software, data, compute, digital goods, or other online services.
- Need spending controls that are understandable and enforceable.
- Want to keep control of their main wallet and be able to revoke permissions.

### Secondary: merchants and API providers
- Want AI agents to buy their services programmatically.
- Want a simple API or SDK instead of custom blockchain payment logic.
- Want settlement to a wallet they control and reliable payment verification.

### Tertiary: developers / agent builders
- Need a scoped credential or agent identifier to connect their agent to an authorized spending capability.
- Need clear policy responses when a payment is allowed, denied, or requires approval.

## 4. Product principles

1. **Policy before payment:** every agent payment is checked against the user's active policy before authorization or settlement.
2. **No unrestricted wallet access:** an agent never receives the user's seed phrase, primary private key, or unrestricted signing authority.
3. **Enforcement, not UI theater:** limits must be enforced by an appropriate trusted or on-chain authorization mechanism, not merely by hiding buttons in the frontend.
4. **Use existing rails:** adopt proven wallet connection, chain, settlement, and payment standards where compatible.
5. **Merchant receives verified outcomes:** never mark a payment as successful based only on a client-side response or a submitted transaction hash.
6. **Explicit cost transparency:** show platform fees and network/provider fees separately.
7. **Revoke quickly:** users can disable an agent and invalidate its authorization.
8. **Fail closed:** if policy state, payment status, or authorization cannot be verified, do not authorize spending or report success.

## 5. Scope

### MVP must include

- Connect an existing wallet through a suitable NEAR-compatible wallet connection flow, after confirming the current official recommendation.
- A user dashboard showing wallet/authorization status, spending policies, recent activity, and available budget.
- Create an agent spending identity/credential with a revocable, scoped authorization. The agent identifier is not a secret; credentials and signing capabilities must be treated as secrets.
- User-defined policies:
  - Total budget.
  - Daily, weekly, monthly, and optionally yearly spending caps.
  - Maximum amount per transaction.
  - Approved merchant/platform allowlist.
  - Per-merchant or per-platform limits over a time window.
  - Rules for unknown/unlisted merchants.
  - Approval modes: all transactions, no manual approval within policy, selected merchants, unknown merchants, or rule-based exceptions.
- Merchant onboarding:
  - Merchant connects or registers a payout wallet.
  - Merchant registers a service/product and price.
  - Merchant receives API credentials and an integration guide.
- A payment request API that identifies merchant, service, amount, asset/network, idempotency key, and expiry.
- A policy decision engine that returns `ALLOW`, `DENY`, or `REQUIRES_APPROVAL`.
- Payment execution through one verified integration adapter selected after documentation review.
- Server-side payment verification before merchant fulfillment.
- Transaction history and an audit trail for policy decisions, approvals, payment attempts, settlement status, and fees.
- Fee accounting:
  - User fee: 0.5% of successful agent spending.
  - Merchant fee: 0.5% of successful payment amount received.
  - Total platform fee revenue target: 1.0% of payment amount, before third-party/network costs.
- Demo/test mode using testnet or a mock adapter, clearly labelled as non-production.

### Explicitly out of scope for MVP

- Building a new blockchain, bridge, swap engine, or general-purpose settlement protocol.
- Supporting every chain, token, or wallet from day one.
- Custodial deposits or pooled user balances controlled by the platform.
- Giving agents raw private keys or seed phrases.
- A full merchant marketplace or discovery engine.
- Complex recurring subscriptions, refunds across all rails, disputes, or fiat payouts unless the selected integration already supports them.
- Production mainnet handling of meaningful funds before an independent security review.

## 6. Core user journeys

### 6.1 User creates an agent spending policy

1. User connects a supported wallet.
2. User reviews a plain-language explanation of the permissions and risks.
3. User creates a policy with budget, time-window caps, transaction limit, merchant rules, and approval settings.
4. The app creates or configures the selected scoped authorization mechanism.
5. The user receives an agent credential / base URL / integration instructions.
6. The user shares the credential with their own agent runtime. The platform must never ask the user to paste a seed phrase.

### 6.2 Agent attempts a payment

1. Agent calls the AgentSpend payment API with its credential and a merchant payment request.
2. API authenticates the agent and resolves the active policy.
3. Server validates merchant identity, service, asset/network, amount, expiry, idempotency, and policy.
4. Decision engine atomically reserves budget to prevent concurrent requests from overspending.
5. If approval is needed, the payment enters a pending state and the user is notified.
6. If denied, the request is rejected with a machine-readable reason.
7. If allowed, the execution adapter requests/executes the scoped payment using the selected payment rail.
8. The platform verifies settlement from authoritative chain/provider data.
9. Merchant fulfillment is enabled only after verified success.
10. Transaction record and both platform fees are recorded idempotently.
11. Budget reservation is committed on success or released on a definitive failure.

### 6.3 Merchant integrates

1. Merchant registers a merchant profile and payout wallet.
2. Merchant creates a service and price.
3. Merchant uses the SDK or HTTP API to create a payment request.
4. AgentSpend returns payment instructions / a request identifier.
5. Merchant checks a signed webhook or polls payment status.
6. Merchant fulfills the service only after verified payment success.
7. Merchant dashboard shows gross amount, 0.5% platform fee, net amount, status, and settlement reference.

### 6.4 User revokes access

1. User disables an agent or revokes a policy.
2. New payment requests are rejected immediately.
3. Any pending request is cancelled if safe and supported by the payment rail.
4. Already-settled transactions remain in history.
5. The UI clearly states that revocation cannot reverse already completed payments.

## 7. Policy model

Policy checks must be deterministic and auditable. The policy engine should not rely on an LLM to make final authorization decisions.

Suggested fields:

- `policy_id`
- `owner_wallet`
- `agent_id`
- `status`: `active | paused | revoked`
- `asset_allowlist`
- `network_allowlist`
- `total_budget`
- `daily_limit`
- `weekly_limit`
- `monthly_limit`
- `yearly_limit` (optional for MVP if implementation complexity is high)
- `per_transaction_limit`
- `merchant_allowlist`
- `merchant_limits`: merchant ID + amount + time window
- `unknown_merchant_mode`: `deny | require_approval | allow_with_cap`
- `approval_mode`: `all | none_within_policy | selected_merchants | unknown_merchants | rules`
- `valid_from`, `expires_at`
- `policy_version`
- `revoked_at`

Use integer base units for token amounts, not floating-point arithmetic. Define time-window boundaries and timezone behavior. Avoid ambiguous merchant identity matching; use a stable merchant ID bound to an authenticated merchant account and payout configuration.

### Atomic budget reservation

Policy evaluation and reservation must be concurrency-safe. Two simultaneous requests must not both pass against the same remaining budget. Use a database transaction/lock or another verified atomic reservation primitive, with idempotency keys and reservation expiry. If hard on-chain limits are available through the chosen authorization technology, enforce the strongest practical limits there as well.

## 8. Fees and accounting

### Initial pricing hypothesis

- **User fee:** 0.5% of successful agent spending.
- **Merchant fee:** 0.5% of successful payment amount received.
- **Platform gross fee revenue:** 1.0% of payment amount, excluding third-party and network costs.

Example for a $100 payment, assuming fees are calculated from the same $100 gross amount and charged separately:
- User pays: $100.50 total.
- Merchant fee: $0.50.
- Merchant receives: $99.50.
- Platform records $1.00 gross revenue.
- Network/facilitator/provider fees are displayed separately and may affect actual margin.

This is a pricing hypothesis to validate, not a proven market rate. The implementation must make the fee basis explicit and configurable. Do not charge platform fees on blocked or failed transactions. For refunds, define a consistent policy and reverse associated platform fees where technically and contractually supported. Avoid charging a fee twice on webhook retries or payment retries.

For micropayments, calculate whether the fee can be represented and collected at the supported token precision. If not, define a minimum payment size or aggregate/batch settlement; do not silently round in a way that changes the advertised rate.

## 9. Technical architecture

Use a modular TypeScript architecture unless repository inspection or the selected integration docs give a strong reason to change it. OpenCode must inspect the current repo before generating a framework or replacing existing structure.

Suggested logical modules:

- `web`: user dashboard, merchant dashboard, approval queue, transaction history.
- `api`: authentication, agent API, merchant API, webhook delivery, payment status.
- `policy`: deterministic policy evaluation and atomic budget reservation.
- `payments`: provider-neutral payment orchestration interfaces.
- `adapters`: concrete wallet, chain, payment protocol, and settlement integrations.
- `verification`: authoritative transaction/provider verification.
- `ledger`: immutable payment events, fee ledger, budget usage, refunds/reversals.
- `database`: schema, migrations, transactions, indexes.
- `security`: credential hashing, rate limits, request signatures, idempotency, audit events.

### Integration strategy

Do not assume that a tool is compatible simply because it is related to NEAR or agentic payments. Before implementation, create a short integration decision record that answers:
- Which network/asset is used in the hackathon demo?
- How does the user authorize scoped spending without exposing the main key?
- Where are transaction limits enforced?
- Can the payment rail transfer to an arbitrary merchant payout address?
- Is there an official SDK/API for the required flow?
- What are current testnet/mainnet availability, fees, rate limits, and terms?
- What is the source of truth for final settlement?
- Does the chosen rail support the desired merchant and agent request/response flow?

Use NEAR Protocol / NEAR wallet tooling where appropriate for wallet connection and any required NEAR-native contract interaction. Evaluate NEAR Intents for swaps/cross-chain asset execution only where its documented flow matches the requirement; do not assume it is a generic merchant checkout API. Evaluate x402 for HTTP-native machine payments only if the chosen network, asset, and facilitator support the target flow. If a provider is not a fit, document why and choose a compatible adapter.

### Provider-neutral interfaces

Define interfaces before provider-specific implementation, for example:

- `WalletConnectionAdapter`
- `ScopedAuthorizationAdapter`
- `PaymentRailAdapter`
- `SettlementVerifier`
- `MerchantWebhookSigner`

The interface must capture pending, successful, failed, expired, and unknown settlement states. Do not equate “transaction submitted” with “payment settled.”

## 10. Data model (initial)

Create migrations for at least:

- `users`
- `wallet_connections` (store public addresses and provider metadata only; never seed phrases/private keys)
- `agents`
- `agent_credentials` (store only a secure hash of long-lived bearer secrets where possible; show raw secret once)
- `policies`
- `policy_merchant_rules`
- `payment_requests`
- `budget_reservations`
- `payment_attempts`
- `settlements`
- `merchants`
- `merchant_services`
- `merchant_api_credentials`
- `webhook_endpoints`
- `webhook_deliveries`
- `fee_ledger_entries`
- `approvals`
- `audit_events`

Use stable IDs, UTC timestamps, database constraints, indexes for status/time lookups, and foreign keys where appropriate. Do not store token amounts as floating-point values. Do not store private keys, seed phrases, or unencrypted reusable credentials.

## 11. API outline

Exact paths and schemas may be refined during implementation, but document and test an API equivalent to:

### Agent API
- `POST /v1/agent/payment-requests` — create/attempt a payment request.
- `GET /v1/agent/payment-requests/{id}` — retrieve status.
- `GET /v1/agent/policy` — retrieve the agent's effective policy summary.
- `GET /v1/agent/budget` — retrieve remaining budget and reservations.

### User API
- `POST /v1/policies`
- `PATCH /v1/policies/{id}`
- `POST /v1/policies/{id}/revoke`
- `GET /v1/approvals`
- `POST /v1/approvals/{id}/approve`
- `POST /v1/approvals/{id}/deny`
- `GET /v1/transactions`

### Merchant API
- `POST /v1/merchant/services`
- `POST /v1/merchant/payment-requests`
- `GET /v1/merchant/payment-requests/{id}`
- `POST /v1/merchant/webhooks/test`

Use strict input validation, authentication, request-size limits, rate limiting, idempotency keys, and machine-readable error codes. Never trust a merchant ID or payout address supplied by an agent without resolving it against registered merchant data.

## 12. Payment state machine

Use explicit, monotonic state transitions such as:

`created → policy_checking → awaiting_approval → authorized → submitted → confirming → succeeded`

Terminal or alternate states:
- `denied`
- `cancelled`
- `expired`
- `failed`
- `unknown` (temporary reconciliation state; never fulfill the service from this state)
- `refunded` / `partially_refunded` if refunds are supported

A webhook must be signed, retried safely, and idempotent. Include event IDs and timestamps. Provide replay protection. A late provider response must not move a terminal state backward.

## 13. Security requirements

Security is a core product feature, not a later enhancement.

- Never request or store a user's seed phrase or primary wallet private key.
- Do not give an agent a generic signer that can transfer arbitrary funds.
- Use scoped authorization, smart-contract limits, session keys, account abstraction, a managed signing policy, or another documented mechanism after security review.
- Enforce hard limits at the strongest available layer; backend policy checks alone are not sufficient protection against a compromised backend.
- If no suitable enforceable scoped authorization exists for the selected stack, state this limitation and restrict the MVP to a clearly labelled testnet/mock flow until resolved.
- Protect against replay, duplicate payment requests, race-condition overspending, credential theft, CSRF, SSRF, webhook forgery, merchant impersonation, malicious URLs, integer overflow, and authorization bypass.
- Store agent and merchant credentials securely; support rotation and revocation.
- Use an allowlist for outbound network destinations to reduce SSRF risk. Never fetch arbitrary user-supplied URLs from privileged server infrastructure without controls.
- Keep secrets in environment variables / secret manager; commit `.env.example` only.
- Validate all incoming webhook signatures and all provider responses.
- Verify settlement through authoritative provider/chain data and the expected recipient, asset, amount, network, and unique payment reference.
- Log policy decisions and security-relevant events without logging bearer tokens or sensitive signing material.
- Rate-limit agent APIs and approval attempts.
- Add automated tests for policy bypass and concurrency.
- Include an explicit disclaimer that revocation does not reverse already-settled transactions.
- Do not claim an audit or production security certification that has not happened.

## 14. UX requirements

The interface should be clear and trust-oriented, not a generic crypto dashboard.

### User dashboard
- Total allocated budget and remaining spend.
- Active agents and their status.
- Policies summarized in plain language.
- Pending approvals.
- Recent transactions with amount, merchant, decision, status, user fee, and network/provider fee.
- A prominent revoke/pause control.
- Clear separation between connected wallet and delegated agent authority.

### Policy builder
- Start with a small set of understandable presets, but let users customize limits.
- Show a human-readable summary before confirmation.
- Explain unknown merchant behavior and approval mode.
- Show which controls are enforced on-chain/provider-side versus by the application backend.
- Warn if a selected configuration is only a soft backend policy.

### Merchant dashboard
- Registered payout wallet.
- Service catalog and price.
- API keys/webhook configuration.
- Payments with status, gross amount, fee, net amount, settlement reference.
- Integration docs and test mode.

### States
Design empty, loading, success, failure, pending, expired, approval-required, insufficient-budget, policy-denied, provider-unavailable, and unknown-settlement states.

## 15. MVP demo acceptance criteria

The demo is not complete unless these end-to-end tests pass:

1. **Allowed payment:** an agent attempts a $3 payment to an approved merchant within policy. It succeeds in the test environment, settlement is verified, merchant fulfillment is permitted, and both fee entries are recorded once.
2. **Per-transaction limit:** an agent attempts a $50 payment when the per-transaction limit is lower. It is denied before payment authorization/submission.
3. **Unknown merchant:** a payment to an unlisted merchant follows the configured policy: deny, request approval, or allow only under an explicit cap.
4. **Budget concurrency:** two concurrent payments cannot jointly exceed the remaining budget.
5. **Revocation:** after revocation, new payment attempts fail.
6. **Duplicate request:** retrying the same idempotency key does not create a second charge or fee.
7. **Unverified settlement:** a submitted but unconfirmed transaction does not trigger fulfillment or show as successful.
8. **Merchant receipt:** merchant can see the authoritative status, settlement reference, gross amount, 0.5% merchant fee, and net amount.
9. **User fee:** successful transaction history shows the 0.5% user fee separately.
10. **Credential safety:** raw credentials are not returned again or written to logs.
11. **Failure handling:** failed/blocked transactions are not charged platform fees.
12. **Auditability:** each payment has a timeline of policy decision, approval (if any), execution, verification, and fee accounting.

## 16. Observability and quality

- Structured logs with correlation IDs.
- Metrics for allowed/denied/approval-required requests, settlement latency, failed verification, provider errors, webhook delivery, and fee reconciliation.
- Error monitoring with sensitive fields redacted.
- Unit tests for policy rules and fee arithmetic.
- Integration tests against testnet or provider sandbox where available.
- E2E tests for critical flows.
- Accessibility and responsive UI checks.
- Dependency and secret scanning before demo release.

## 17. Implementation phases

### Phase 0 — Documentation and integration spike
- Inspect repository and environment.
- Read current official docs listed in `docs/INTEGRATIONS.md`.
- Confirm hackathon requirements and current submission rules from the official event site.
- Compare payment rails and scoped authorization mechanisms.
- Write `docs/architecture/decision-record.md` with selected rail, auth model, limitations, fees, and alternatives.
- Do not implement production signing until the authorization design is approved.

### Phase 1 — Product skeleton
- Establish project structure, environment config, database, migrations, typed API contracts, and UI shell.
- Add mock payment adapter and test fixtures.
- Implement deterministic policy engine and atomic budget reservations.

### Phase 2 — Core product flow
- Wallet connection.
- Agent identity/credential management.
- Policy creation/edit/revoke.
- Merchant registration and service configuration.
- Approval queue and transaction history.

### Phase 3 — Real testnet/provider integration
- Implement one compatible authorization/payment rail behind adapters.
- Verify settlement authoritatively.
- Add signed merchant webhooks and idempotent fee ledger.
- Do not add multiple chains until one complete flow works.

### Phase 4 — Hardening and demo
- Run acceptance tests and threat-model review.
- Fix mobile/responsive and accessibility issues.
- Add seed data and a deterministic demo script.
- Clearly label testnet/mock functionality.
- Prepare a concise architecture diagram and a demo explanation.

## 18. Definition of done

- Every acceptance criterion in Section 15 passes.
- No secrets or wallet private keys are stored in application data.
- No payment is marked successful without authoritative verification.
- Policy evaluation is deterministic, tested, and race-safe.
- Fees are calculated with integer arithmetic and recorded idempotently.
- Documentation explains the selected integrations and limitations.
- `.env.example` exists; actual secrets are absent from the repository.
- Lint, typecheck, unit tests, integration tests, and production build pass.
- Security-sensitive assumptions and unresolved risks are documented.

## 19. Open decisions — must be resolved by documentation research

These are not to be silently guessed:
1. Which NEAR-compatible wallet connection SDK is currently recommended?
2. What exact authorization technology enforces agent-specific limits without exposing the user's primary key?
3. Is the selected payment rail compatible with direct merchant payout and the intended approval flow?
4. Does the selected x402 facilitator/network support the exact target network, asset, scheme, and production use?
5. Is NEAR Intents needed for the MVP, or should it be deferred until swaps/cross-chain funding are in scope?
6. Which database/hosting stack is already available in the repo or most practical for the demo?
7. What are current provider fees, rate limits, testnet availability, and hackathon integration requirements?

Document evidence and links in `docs/architecture/decision-record.md` before implementing provider-specific code.
