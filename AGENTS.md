# AgentSpend project instructions for OpenCode

## Source of truth
- `PRD.md` is the product and acceptance specification.
- `docs/INTEGRATIONS.md` is the official documentation registry and integration research checklist.
- `docs/architecture/decision-record.md` records chosen technologies and verified constraints.
- Treat security requirements in `PRD.md` as hard constraints.

## Required workflow
1. Inspect the existing repository before selecting frameworks or replacing files.
2. Read the relevant official vendor documentation before writing integration code. Use the current docs, not remembered SDK signatures.
3. Before provider-specific implementation, create/update `docs/architecture/decision-record.md` with the exact docs reviewed, chosen approach, alternatives, risks, and unresolved questions.
4. Prefer existing official SDKs and maintained packages. Avoid reimplementing wallets, chains, swaps, bridges, or payment protocols.
5. Implement one end-to-end payment rail first. Keep provider-specific code behind typed adapters.
6. Start with a mock/test adapter if authorization guarantees are not yet proven. Do not present mock behavior as real on-chain security.
7. Do not invent APIs, SDK methods, contract addresses, network support, or provider capabilities. If docs are unclear, stop and report the uncertainty.
8. Do not claim payment success until authoritative settlement verification succeeds.
9. Do not expose or store seed phrases, primary private keys, raw long-lived credentials, or signing secrets.
10. Do not weaken or skip security checks to make the demo pass.

## Architecture rules
- Keep policy evaluation deterministic; an LLM must never make the final spend authorization decision.
- Use integer base units for monetary arithmetic.
- Make budget reservations concurrency-safe.
- Make API calls, webhooks, payment attempts, and fee ledger writes idempotent.
- Treat `unknown` settlement as not paid.
- Verify expected merchant, recipient, asset, network, amount, and payment reference.
- Distinguish application-backend policy controls from on-chain or cryptographically enforceable limits in both code and UI.
- Keep the payment rail provider-neutral behind interfaces.
- Never add real secrets to the repository. Maintain `.env.example` with placeholders only.

## Required verification after changes
- Run formatting, lint, typecheck, unit tests, and production build using the commands defined by the actual project.
- Add tests for every policy rule and payment state transition.
- Test race conditions, idempotency, revoked credentials, unverified settlement, duplicate webhooks, and fee calculations.
- Report commands run and their actual results. Do not claim tests passed unless they were executed.
- If the repository has no scripts yet, establish them and document them.

## Product constraints
- Initial platform fees: 0.5% user fee + 0.5% merchant fee on successful payment amount, with network/provider costs shown separately.
- No platform fee on blocked or failed transactions.
- Merchant receives payment only to a verified payout configuration.
- Reuse existing infrastructure; do not build a new wallet, bridge, swap engine, or settlement protocol for the MVP.
- Avoid generic crypto-dashboard UI. Prioritize clear permissions, remaining budget, pending approvals, transaction state, and revocation.
