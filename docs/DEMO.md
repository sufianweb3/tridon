# Final test script

A click-by-click pass through the demo, in the order that shows the security story.
Everything here runs on **NEAR testnet** with the demo **`TESTUSD`** token, not Circle
USDC and not real money.

The app must be running:

```bash
pnpm dev
# http://localhost:3000
```

If the demo workspace has not been provisioned in this checkout, run `pnpm seed` first.
If you want to reset the workspace, stop the server, run `pnpm db:reset -- --yes`, then
`pnpm seed`.

---

## 0. Before you start

- Use a desktop browser if possible. The layout is responsive, but the dashboard is
  easier to read wide.
- Keep a second tab on <https://testnet.nearblocks.io> so you can open transaction links.
- The demo signer and all accounts are testnet-only. No wallet extension is needed.
- The server holds the demo workspace's testnet keys encrypted at rest. This is a
  demo-only pattern and is labelled in the UI.

---

## 1. Demo sign-in and dashboard

1. Open <http://localhost:3000>.
2. Confirm the landing page says **NEAR TESTNET** and **TESTUSD · DEMO TOKEN**.
3. Click **Enter the demo workspace** (or go to `/login` and use the demo button).
4. You should land on **Control room**.

Check:

- [ ] Header shows `NEAR TESTNET` and `TESTUSD · DEMO TOKEN`.
- [ ] Remaining budget, committed spend, held amount, and vault balance are visible.
- [ ] The rail is labelled **NEAR testnet · on-chain vault**.
- [ ] No browser console errors (open DevTools → Console).

---

## 2. Allowed payment (live vault)

1. Go to **Agent API** (`/integrations`).
2. Keep the default agent (Research) and merchant (Northstar Compute / GPU minute).
3. Click **Send payment request**, or use the **Allowed payment · $3.50** scenario.
4. Wait for the result panel.

Expected:

- [ ] Status `SUCCEEDED`.
- [ ] Enforcement says **On-chain vault policy + backend pre-check**.
- [ ] Gross $3.50, user fee $0.0175, merchant fee $0.0175, net $3.4825.
- [ ] A transaction hash and an explorer link are shown.
- [ ] Opening the link on Nearblocks shows the vault call and the token transfers.

Then open **Transactions** → the payment → check the timeline: policy decision,
execution, FINAL verification, fee entries, audit events.

---

## 3. Per-transaction limit (denied, no fee)

1. On **Agent API**, choose DataForge and enter `50.00` as the amount.
2. Send the request.

Expected:

- [ ] Status `DENIED`.
- [ ] Reason `PER_TX_LIMIT`.
- [ ] User fee and merchant fee are `$0.00`.
- [ ] No transaction hash (nothing was submitted).
- [ ] The budget reservation is released; remaining budget does not drop.

---

## 4. Unlisted merchant (denied, no fee)

1. On **Agent API**, click the **Unlisted merchant · Atlas Data Co. · $4.50** scenario.
2. Send it.

Expected:

- [ ] Status `DENIED`.
- [ ] Reason `UNKNOWN_MERCHANT`.
- [ ] No fee, no transaction.
- [ ] The message explains that “unknown” means not on the user's allowlist, not an
      agent-chosen payout address.

---

## 5. Approval (human gate)

1. On **Agent API**, click **Needs approval · Lighthouse Research · $24.00**.
2. Send it.
3. Open **Approvals**.

Expected:

- [ ] The request is listed as `AWAITING APPROVAL` with the agent, merchant, amount, and
      expiry.
- [ ] The payment is not submitted and no fee exists yet.
- [ ] The reservation is held, not committed.

Approve it:

1. Click **Approve**.
2. Wait for the on-chain settlement (this can take ~10–25 seconds in the demo).
3. Open the payment from the approval or the transaction list.

Expected:

- [ ] Status `SUCCEEDED`.
- [ ] Approval status `approved`.
- [ ] The approval hash is bound to that payment.
- [ ] Fees are recorded once.

Alternative: create another approval request and click **Deny**.

Expected on deny:

- [ ] Status `DENIED` / approval `denied`.
- [ ] No fee.
- [ ] Reservation released.
- [ ] No on-chain transaction.

---

## 6. Settlement failure (no fee)

1. On **Agent API**, click **Settlement failure · Flaky Fulfillment · $1.00**.
2. Send it.

Expected:

- [ ] Status `FAILED`.
- [ ] Decision was `ALLOW` (the policy allowed it), but settlement failed.
- [ ] No fee is charged.
- [ ] The error explains that the merchant payout account is not storage-registered for
      the demo token.

This is the important distinction: policy allowed the payment, the chain rejected
settlement, and the platform did not charge for a failed payment.

---

## 7. Idempotent replay

1. On **Agent API**, send an allowed payment.
2. Enable **Replay the same idempotency key**.
3. Send the same request again.

Expected:

- [ ] The second response is the **same payment id**.
- [ ] It is labelled **IDEMPOTENT REPLAY**.
- [ ] No second charge, no second fee, no second transaction.

---

## 8. Agent lifecycle and revocation

1. Open **Agents**.
2. Create a new agent (for example “Test agent”).
   - The server adds a function-call key scoped to `pay` on the live vault.
   - The raw bearer token is shown **once**; copy it or note that it cannot be recovered.
3. Rotate the token.
   - The previous token is revoked immediately; the new raw value is shown once.
4. Revoke the agent.
   - Confirm the dialog.
   - The on-chain key is deleted **before** the dashboard record changes.

Expected:

- [ ] New agent shows `ACTIVE` and `ON-CHAIN KEY`.
- [ ] Rotated credential shows a new prefix.
- [ ] Revoked agent shows `REVOKED` and `KEY DELETED`.
- [ ] Revoked agent's buttons are disabled.
- [ ] A payment request from the revoked agent is rejected.

You can verify the key list on the vault account in Nearblocks: the revoked agent's
`FunctionCall` key should be gone. The seeded Research and Ops keys remain.

---

## 9. Policy edit and on-chain sync

1. Open **Policy**.
2. Change the daily limit (for example from `$100` to `$120`).
3. Save.

Expected:

- [ ] Version increments.
- [ ] A policy sync transaction is shown.
- [ ] The audit log records `policy.synced`.
- [ ] The vault's on-chain policy version matches the dashboard.
- [ ] If the chain sync fails, the policy is paused and the UI says so (fail closed).

Change it back to `$100` if you want the documented demo state.

---

## 10. Merchant portal

1. Open <http://localhost:3000/merchant/login>.
2. Pick **DataForge** (demo-only login).
3. Open the dashboard and the services/API page.

Expected:

- [ ] The portal says **demo merchant session** / testnet data.
- [ ] Settled payments show gross, 0.5% merchant fee, net, and settlement reference.
- [ ] The service catalogue and prices are visible.
- [ ] The webhook panel explains that delivery is disabled unless the host is allowlisted;
      the test button returns a signed sample without an outbound request.

---

## 11. Security model page

Open **Security model** (`/security`).

Check:

- [ ] The enforcement matrix separates **backend** from **on-chain** controls.
- [ ] The “backend fully compromised” column is present.
- [ ] The page states that the demo token is not Circle USDC.
- [ ] The vault account and owner are shown with explorer links.

---

## 12. Final automated checks

With the dev server running:

```bash
pnpm test          # 29 unit tests
pnpm test:e2e      # HTTP smoke test, no funds spent
pnpm typecheck
pnpm build
```

`pnpm test:e2e` signs in with the demo account, checks the read APIs, verifies CSRF
rejection, creates only denied payments, checks idempotent replay, rejects an invalid
agent bearer, and reads the merchant summary.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| `DEMO_NOT_SEEDED` on login | Run `pnpm seed`; the workspace settings are missing |
| Payment stays `UNKNOWN` | Testnet RPC lag; open the transaction and click reconcile, or wait |
| Payment `FAILED` with storage error | The merchant payout account is not registered for the token; this is the deliberate Flaky scenario |
| `Exceeded the prepaid gas` | Old vault deployment; redeploy the current contract (see decision record) |
| Agent creation takes ~20s | It waits for the on-chain key transaction to reach FINAL |
| Budget looks lower than expected | Seeded demo payments are committed; edit the policy or reset the workspace |
| Port 3000 in use | Stop the other process, or start with `pnpm --filter @agentspend/web dev -- -p 3001` and set `AGENTSPEND_APP_URL` |
