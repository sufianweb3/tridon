//! AgentSpend vault: a per-user, immutable spending-policy account.
//!
//! The user owns the account. The contract holds the funds, pins merchant payouts,
//! and is the only thing that can move money. An AI agent gets a function-call key
//! on this account scoped to `pay`, so a leaked agent key can only ask this contract
//! for a payment inside the policy. It cannot transfer tokens, withdraw, or change
//! the policy.
//!
//! Mainnet spending is not approved. Testnet only.

use near_sdk::json_types::U128;
use near_sdk::store::{IterableMap, LookupMap};
use near_sdk::{
    env, log, near, require, AccountId, Allowance, Gas, NearToken, PanicOnDefault, Promise,
    PublicKey,
};
use serde_json::json;

const BPS_DENOMINATOR: u128 = 10_000;
const MAX_FEE_BPS: u16 = 500; // 5% hard ceiling, even if the UI sends something else
const DAY_MS: u64 = 86_400_000;
const PRUNE_AFTER_MS: u64 = 30 * DAY_MS;
const MAX_ID_LEN: usize = 64;
const MAX_MEMO_ID_LEN: usize = 96;

const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(25);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);
// The merchant callback creates the chained fee transfer (25 TGAS) and its
// callback (20 TGAS). A receipt can only attach gas it actually holds, so this
// must be larger than the sum of the promises it creates.
const GAS_FOR_MERCHANT_CALLBACK: Gas = Gas::from_tgas(80);
const GAS_FOR_STORAGE: Gas = Gas::from_tgas(10);

/// 0.5 NEAR of gas allowance for an agent key. Explicit and non-zero: when a
/// function-call key is added through the host function, allowance = 0 means
/// *unlimited*, so never pass zero. This is gas only; it cannot be transferred.
fn agent_key_allowance() -> NearToken {
    NearToken::from_millinear(500)
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum AgentStatus {
    Active,
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum UnknownMerchantMode {
    Deny,
    RequireApproval,
    AllowWithCap(U128),
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ApprovalMode {
    All,
    NoneWithinPolicy,
    Selected,
    UnknownOnly,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum PaymentStatus {
    Reserved,
    MerchantPaid,
    Succeeded,
    Failed,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Policy {
    pub total_budget: u128,
    pub per_tx_limit: u128,
    pub daily_limit: u128,
    pub weekly_limit: u128,
    pub monthly_limit: u128,
    pub valid_from_ms: u64,
    pub expires_at_ms: u64,
    pub unknown_merchant_mode: UnknownMerchantMode,
    pub approval_mode: ApprovalMode,
    /// Merchant ids that need explicit approval when approval_mode = Selected.
    pub approval_selected_merchants: Vec<String>,
    pub version: u32,
}

/// JSON input for `new` and `set_policy`. Amounts cross the JSON boundary as
/// strings (`U128`) because JavaScript cannot represent every `u128` exactly.
/// Internally the contract keeps plain integers.
#[near(serializers = [json])]
#[derive(Clone, Debug)]
pub struct PolicyInit {
    pub total_budget: U128,
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub weekly_limit: U128,
    pub monthly_limit: U128,
    pub valid_from_ms: u64,
    pub expires_at_ms: u64,
    pub unknown_merchant_mode: UnknownMerchantMode,
    pub approval_mode: ApprovalMode,
    pub approval_selected_merchants: Vec<String>,
    pub version: u32,
}

impl From<PolicyInit> for Policy {
    fn from(input: PolicyInit) -> Self {
        Self {
            total_budget: input.total_budget.0,
            per_tx_limit: input.per_tx_limit.0,
            daily_limit: input.daily_limit.0,
            weekly_limit: input.weekly_limit.0,
            monthly_limit: input.monthly_limit.0,
            valid_from_ms: input.valid_from_ms,
            expires_at_ms: input.expires_at_ms,
            unknown_merchant_mode: input.unknown_merchant_mode,
            approval_mode: input.approval_mode,
            approval_selected_merchants: input.approval_selected_merchants,
            version: input.version,
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Agent {
    pub agent_id: String,
    pub public_key: String,
    pub status: AgentStatus,
    pub created_at_ms: u64,
    pub allowance_yocto: u128,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct MerchantRule {
    pub merchant_id: String,
    pub payout: AccountId,
    /// 0 = fall back to the policy per-transaction limit.
    pub per_tx_limit: u128,
    /// 0 = disabled.
    pub window_limit: u128,
    pub window_secs: u64,
    pub window_start_ms: u64,
    pub window_spent: u128,
    pub active: bool,
    /// false = platform merchant the user has not allowlisted. The payout is still
    /// pinned here, so the agent can never choose where funds go.
    pub allowlisted: bool,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Payment {
    pub payment_id: String,
    pub agent_id: String,
    pub merchant_id: String,
    pub payout: AccountId,
    pub gross: u128,
    pub user_fee: u128,
    pub merchant_fee: u128,
    pub net: u128,
    pub day_index: u32,
    pub status: PaymentStatus,
    pub fee_owed: u128,
    pub created_at_ms: u64,
    pub terminal_at_ms: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Approval {
    pub payment_id: String,
    pub merchant_id: String,
    pub gross: u128,
    pub request_expiry_ms: u64,
    pub policy_version: u32,
    pub expires_at_ms: u64,
}

// ---------------------------------------------------------------------------
// View types (all token amounts are strings via U128)
// ---------------------------------------------------------------------------

#[near(serializers = [json])]
pub struct PolicyView {
    pub total_budget: U128,
    pub per_tx_limit: U128,
    pub daily_limit: U128,
    pub weekly_limit: U128,
    pub monthly_limit: U128,
    pub valid_from_ms: u64,
    pub expires_at_ms: u64,
    pub unknown_merchant_mode: UnknownMerchantMode,
    pub approval_mode: ApprovalMode,
    pub approval_selected_merchants: Vec<String>,
    pub version: u32,
}

#[near(serializers = [json])]
pub struct AgentView {
    pub agent_id: String,
    pub public_key: String,
    pub status: AgentStatus,
    pub created_at_ms: u64,
    pub allowance_yocto: U128,
}

#[near(serializers = [json])]
pub struct MerchantView {
    pub merchant_id: String,
    pub payout: AccountId,
    pub per_tx_limit: U128,
    pub window_limit: U128,
    pub window_secs: u64,
    pub window_start_ms: u64,
    pub window_spent: U128,
    pub active: bool,
    pub allowlisted: bool,
}

#[near(serializers = [json])]
pub struct PaymentView {
    pub payment_id: String,
    pub agent_id: String,
    pub merchant_id: String,
    pub payout: AccountId,
    pub gross: U128,
    pub user_fee: U128,
    pub merchant_fee: U128,
    pub net: U128,
    pub day_index: u32,
    pub status: PaymentStatus,
    pub fee_owed: U128,
    pub created_at_ms: u64,
    pub terminal_at_ms: u64,
}

#[near(serializers = [json])]
pub struct ApprovalView {
    pub payment_id: String,
    pub merchant_id: String,
    pub gross: U128,
    pub request_expiry_ms: u64,
    pub policy_version: u32,
    pub expires_at_ms: u64,
}

#[near(serializers = [json])]
pub struct ConfigView {
    pub owner: AccountId,
    pub token: AccountId,
    pub fee_account: AccountId,
    pub user_fee_bps: u16,
    pub merchant_fee_bps: u16,
    pub paused: bool,
    pub network: String,
}

#[near(serializers = [json])]
pub struct BalanceView {
    pub accounted_balance: U128,
    pub reserved_debit: U128,
    pub free_balance: U128,
    pub total_gross_committed: U128,
}

#[near(serializers = [json])]
pub struct UsageView {
    pub day_index: u32,
    pub day_gross: U128,
    pub week_gross: U128,
    pub month_gross: U128,
    pub total_gross_committed: U128,
}

#[near(serializers = [json])]
pub struct VaultStateView {
    pub config: ConfigView,
    pub policy: PolicyView,
    pub balance: BalanceView,
    pub usage: UsageView,
    pub agent_count: u32,
    pub merchant_count: u32,
}

/// Merchant supplied at vault creation. Platform merchants are inserted with
/// allowlisted = false; the user can allowlist them later with add_merchant.
#[near(serializers = [json])]
#[derive(Clone)]
pub struct MerchantSeed {
    pub merchant_id: String,
    pub payout: AccountId,
    pub per_tx_limit: U128,
    pub window_limit: U128,
    pub window_secs: u64,
    pub allowlisted: bool,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    token: AccountId,
    fee_account: AccountId,
    user_fee_bps: u16,
    merchant_fee_bps: u16,
    paused: bool,
    policy: Policy,
    agents: IterableMap<String, Agent>,
    /// public key string -> agent id. Removing this mapping makes revocation
    /// effective for `pay` immediately, before DeleteKey reaches FINAL.
    agent_keys: LookupMap<String, String>,
    merchants: IterableMap<String, MerchantRule>,
    payments: LookupMap<String, Payment>,
    /// sha256(payment_id) -> terminal timestamp. Never pruned.
    seen_payments: LookupMap<Vec<u8>, u64>,
    approvals: LookupMap<String, Approval>,
    day_spend: LookupMap<u32, u128>,
    total_gross_committed: u128,
    accounted_balance: u128,
    reserved_debit: u128,
    withdrawal_nonce: u64,
    pending_withdrawals: LookupMap<u64, u128>,
}

#[near]
impl Contract {
    /// Deploy-time init. The platform creates the account with only the user's
    /// FullAccess key, deploys this code, then the user (or the user's wallet
    /// session) calls `new`. The platform never holds a vault key.
    #[init]
    #[payable]
    pub fn new(
        owner: AccountId,
        token: AccountId,
        fee_account: AccountId,
        user_fee_bps: u16,
        merchant_fee_bps: u16,
        policy: PolicyInit,
        merchants: Vec<MerchantSeed>,
    ) -> Self {
        let policy: Policy = policy.into();
        require!(owner != token, "owner and token must differ");
        require!(user_fee_bps <= MAX_FEE_BPS, "user fee too high");
        require!(merchant_fee_bps <= MAX_FEE_BPS, "merchant fee too high");
        validate_policy(&policy);

        let mut contract = Self {
            owner,
            token: token.clone(),
            fee_account,
            user_fee_bps,
            merchant_fee_bps,
            paused: false,
            policy,
            agents: IterableMap::new(b"a"),
            agent_keys: LookupMap::new(b"k"),
            merchants: IterableMap::new(b"m"),
            payments: LookupMap::new(b"p"),
            seen_payments: LookupMap::new(b"s"),
            approvals: LookupMap::new(b"v"),
            day_spend: LookupMap::new(b"d"),
            total_gross_committed: 0,
            accounted_balance: 0,
            reserved_debit: 0,
            withdrawal_nonce: 0,
            pending_withdrawals: LookupMap::new(b"w"),
        };

        for seed in merchants {
            require!(is_safe_id(&seed.merchant_id), "invalid merchant id");
            require!(seed.payout != env::current_account_id(), "payout cannot be the vault");
            require!(seed.merchant_id.len() <= MAX_ID_LEN, "merchant id too long");
            require!(
                seed.window_limit.0 == 0 || seed.window_secs > 0,
                "window limit needs a window"
            );
            contract.merchants.insert(
                seed.merchant_id.clone(),
                MerchantRule {
                    merchant_id: seed.merchant_id.clone(),
                    payout: seed.payout,
                    per_tx_limit: seed.per_tx_limit.0,
                    window_limit: seed.window_limit.0,
                    window_secs: seed.window_secs,
                    window_start_ms: 0,
                    window_spent: 0,
                    active: true,
                    allowlisted: seed.allowlisted,
                },
            );
        }

        // Register this vault with the token if the deploy attached enough NEAR.
        let attached = env::attached_deposit();
        if attached > NearToken::from_yoctonear(0) {
            Promise::new(token).function_call(
                "storage_deposit".to_string(),
                serde_json::to_vec(&json!({
                    "account_id": env::current_account_id(),
                    "registration_only": true
                }))
                .expect("json"),
                attached,
                GAS_FOR_STORAGE,
            );
        }

        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "vault_created",
                "data": {
                    "owner": contract.owner,
                    "token": contract.token,
                    "policy_version": contract.policy.version
                }
            })
        );
        contract
    }

    // -----------------------------------------------------------------------
    // Deposits
    // -----------------------------------------------------------------------

    /// NEP-141 receiver. Only the configured token may credit the vault.
    /// Returns "0" so the token does not refund anything.
    #[payable]
    pub fn ft_on_transfer(&mut self, sender_id: AccountId, amount: U128, msg: String) -> String {
        require!(
            env::predecessor_account_id() == self.token,
            "only the configured token can deposit"
        );
        if msg != "deposit" {
            return amount.0.to_string();
        }
        require!(amount.0 > 0, "deposit must be positive");
        self.accounted_balance = self
            .accounted_balance
            .checked_add(amount.0)
            .expect("balance overflow");
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "deposit",
                "data": { "sender": sender_id, "amount": U128(amount.0) }
            })
        );
        "0".to_string()
    }

    // -----------------------------------------------------------------------
    // Agent payment
    // -----------------------------------------------------------------------

    /// Called by an agent's function-call key. The key is on this account and
    /// scoped to this method, so `predecessor == current_account`.
    pub fn pay(
        &mut self,
        payment_id: String,
        merchant_id: String,
        gross: U128,
        request_expiry_ms: u64,
    ) -> PaymentView {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "pay must be signed by this vault account"
        );
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(0),
            "pay takes no deposit"
        );
        require!(is_safe_id(&payment_id), "invalid payment id");
        require!(payment_id.len() <= MAX_MEMO_ID_LEN, "payment id too long");
        require!(is_safe_id(&merchant_id), "invalid merchant id");
        require!(!self.paused, "vault is paused");
        require!(gross.0 > 0, "amount must be positive");

        let now = env::block_timestamp_ms();
        require!(now >= self.policy.valid_from_ms, "policy not active yet");
        require!(now < self.policy.expires_at_ms, "policy expired");
        require!(request_expiry_ms >= now, "payment request expired");

        // Identity comes from the key that signed the transaction, never from
        // a caller-supplied agent id.
        let signer_pk = env::signer_account_pk().to_string();
        let agent_id = self
            .agent_keys
            .get(&signer_pk)
            .cloned()
            .expect("unknown agent key");
        let agent = self.agents.get(&agent_id).expect("agent missing");
        require!(agent.status == AgentStatus::Active, "agent revoked");

        let merchant = self.merchants.get(&merchant_id).cloned();
        let (payout, allowlisted, merchant_per_tx, merchant_window) = match merchant {
            Some(m) => {
                require!(m.active, "merchant disabled");
                let payout = m.payout.clone();
                let allowlisted = m.allowlisted;
                let per_tx = m.per_tx_limit;
                (payout, allowlisted, per_tx, Some(m))
            }
            None => {
                // There is deliberately no payout argument. A merchant must be
                // pinned in vault state before any money can move, otherwise an
                // agent could choose an arbitrary destination.
                env::panic_str("unknown merchant: payout is not pinned");
            }
        };

        let unknown_cap = if allowlisted {
            None
        } else {
            match &self.policy.unknown_merchant_mode {
                UnknownMerchantMode::Deny => env::panic_str("unknown merchant denied"),
                UnknownMerchantMode::RequireApproval => None,
                UnknownMerchantMode::AllowWithCap(cap) => Some(cap.0),
            }
        };

        let (user_fee, merchant_fee, net, debit) = compute_amounts(
            gross.0,
            self.user_fee_bps,
            self.merchant_fee_bps,
        );

        let mut per_tx = if merchant_per_tx > 0 {
            merchant_per_tx
        } else {
            self.policy.per_tx_limit
        };
        if let Some(cap) = unknown_cap {
            per_tx = per_tx.min(cap);
        }
        require!(gross.0 <= per_tx, "per-transaction limit exceeded");
        require!(
            self.total_gross_committed + gross.0 <= self.policy.total_budget,
            "total budget exceeded"
        );

        let day_index = (now / DAY_MS) as u32;
        let day_gross = self.day_spend.get(&day_index).copied().unwrap_or(0);
        if self.policy.daily_limit > 0 {
            require!(
                day_gross + gross.0 <= self.policy.daily_limit,
                "daily limit exceeded"
            );
        }
        if self.policy.weekly_limit > 0 {
            require!(
                self.window_sum(day_index, 7) + gross.0 <= self.policy.weekly_limit,
                "weekly limit exceeded"
            );
        }
        if self.policy.monthly_limit > 0 {
            require!(
                self.window_sum(day_index, 30) + gross.0 <= self.policy.monthly_limit,
                "monthly limit exceeded"
            );
        }

        if let Some(m) = merchant_window {
            if m.window_limit > 0 {
                let window_expired = m.window_secs > 0
                    && now.saturating_sub(m.window_start_ms) >= m.window_secs.saturating_mul(1000);
                let spent = if window_expired { 0 } else { m.window_spent };
                require!(
                    spent + gross.0 <= m.window_limit,
                    "merchant window limit exceeded"
                );
            }
        }

        require!(
            self.accounted_balance.saturating_sub(self.reserved_debit) >= debit,
            "insufficient available balance"
        );

        let needs_approval = self.needs_approval(&merchant_id, allowlisted);
        let approval_hash = approval_hash(
            &payment_id,
            &merchant_id,
            gross.0,
            request_expiry_ms,
            self.policy.version,
        );
        if needs_approval {
            let approval = self
                .approvals
                .get(&approval_hash)
                .expect("approval required");
            require!(approval.expires_at_ms > now, "approval expired");
            require!(
                approval.payment_id == payment_id
                    && approval.merchant_id == merchant_id
                    && approval.gross == gross.0
                    && approval.request_expiry_ms == request_expiry_ms
                    && approval.policy_version == self.policy.version,
                "approval does not match payment"
            );
        }

        let marker = env::sha256(payment_id.as_bytes());
        if self.seen_payments.get(&marker).is_some() {
            env::panic_str("payment already processed");
        }

        // Reserve first, then transfer. A duplicate can never double-spend.
        let payment = Payment {
            payment_id: payment_id.clone(),
            agent_id: agent_id.clone(),
            merchant_id: merchant_id.clone(),
            payout: payout.clone(),
            gross: gross.0,
            user_fee,
            merchant_fee,
            net,
            day_index,
            status: PaymentStatus::Reserved,
            fee_owed: 0,
            created_at_ms: now,
            terminal_at_ms: 0,
        };
        self.payments.insert(payment_id.clone(), payment.clone());
        self.seen_payments.insert(marker, 0);
        self.reserved_debit = self
            .reserved_debit
            .checked_add(debit)
            .expect("reserve overflow");
        self.total_gross_committed += gross.0;
        self.day_spend.insert(day_index, day_gross + gross.0);
        if let Some(mut rule) = self.merchants.get(&merchant_id).cloned() {
            if rule.window_limit > 0 {
                if rule.window_secs > 0
                    && now.saturating_sub(rule.window_start_ms)
                        >= rule.window_secs.saturating_mul(1000)
                {
                    rule.window_start_ms = now;
                    rule.window_spent = 0;
                }
                rule.window_spent += gross.0;
                self.merchants.insert(merchant_id.clone(), rule);
            }
        }

        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "payment_reserved",
                "data": {
                    "payment_id": payment_id,
                    "merchant_id": merchant_id,
                    "agent_id": agent_id,
                    "gross": U128(gross.0),
                    "user_fee": U128(user_fee),
                    "merchant_fee": U128(merchant_fee),
                    "net": U128(net),
                    "approval_hash": if needs_approval { Some(approval_hash) } else { None }
                }
            })
        );

        // The only transfer to the merchant, to the payout pinned in state.
        let merchant_promise = self.ft_transfer(
            payout,
            net,
            format!("agentspend:v1:{}", payment_id),
        );
        merchant_promise.then(
            Promise::new(env::current_account_id()).function_call(
                "on_merchant_transfer".to_string(),
                serde_json::to_vec(&json!({ "payment_id": payment_id })).expect("json"),
                NearToken::from_yoctonear(0),
                GAS_FOR_MERCHANT_CALLBACK,
            ),
        );

        payment_view(&payment)
    }

    /// Owner binds an approval to exact payment parameters. Changing any of them
    /// invalidates the approval.
    pub fn approve(
        &mut self,
        payment_id: String,
        merchant_id: String,
        gross: U128,
        request_expiry_ms: u64,
        approval_expiry_ms: u64,
    ) -> String {
        self.assert_owner();
        require!(is_safe_id(&payment_id), "invalid payment id");
        require!(is_safe_id(&merchant_id), "invalid merchant id");
        require!(gross.0 > 0, "amount must be positive");
        let now = env::block_timestamp_ms();
        require!(approval_expiry_ms > now, "approval expiry must be in the future");
        require!(
            approval_expiry_ms <= request_expiry_ms,
            "approval cannot outlive the request"
        );
        let hash = approval_hash(
            &payment_id,
            &merchant_id,
            gross.0,
            request_expiry_ms,
            self.policy.version,
        );
        let approval = Approval {
            payment_id: payment_id.clone(),
            merchant_id,
            gross: gross.0,
            request_expiry_ms,
            policy_version: self.policy.version,
            expires_at_ms: approval_expiry_ms,
        };
        self.approvals.insert(hash.clone(), approval);
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "approval",
                "data": {
                    "payment_id": payment_id,
                    "approval_hash": hash,
                    "expires_at_ms": approval_expiry_ms
                }
            })
        );
        hash
    }

    // -----------------------------------------------------------------------
    // Owner controls
    // -----------------------------------------------------------------------

    pub fn set_policy(&mut self, policy: PolicyInit) -> u32 {
        self.assert_owner();
        let policy: Policy = policy.into();
        validate_policy(&policy);
        let version = self.policy.version.wrapping_add(1);
        self.policy = Policy {
            version,
            ..policy
        };
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "policy_updated",
                "data": { "policy_version": version }
            })
        );
        version
    }

    pub fn pause(&mut self) {
        self.assert_owner();
        self.paused = true;
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "paused",
                "data": {}
            })
        );
    }

    pub fn unpause(&mut self) {
        self.assert_owner();
        self.paused = false;
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "unpaused",
                "data": {}
            })
        );
    }

    /// Register an agent and add a function-call key on this account scoped to
    /// `pay` with an explicit non-zero gas allowance.
    pub fn add_agent(&mut self, agent_id: String, public_key: String) -> AgentView {
        self.assert_owner();
        require!(is_safe_id(&agent_id), "invalid agent id");
        require!(!self.agents.contains_key(&agent_id), "agent id exists");
        require!(!self.agent_keys.contains_key(&public_key), "public key exists");
        let parsed: PublicKey = public_key.parse().expect("invalid public key");
        let now = env::block_timestamp_ms();
        let allowance = agent_key_allowance();
        let agent = Agent {
            agent_id: agent_id.clone(),
            public_key: public_key.clone(),
            status: AgentStatus::Active,
            created_at_ms: now,
            allowance_yocto: allowance.as_yoctonear(),
        };
        self.agents.insert(agent_id.clone(), agent.clone());
        self.agent_keys.insert(public_key, agent_id.clone());
        Promise::new(env::current_account_id()).add_access_key_allowance(
            parsed,
            Allowance::limited(allowance).expect("agent allowance must be non-zero"),
            env::current_account_id(),
            "pay".to_string(),
        );
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "agent_added",
                "data": {
                    "agent_id": agent_id,
                    "public_key": agent.public_key,
                    "allowance_yocto": U128(allowance.as_yoctonear())
                }
            })
        );
        agent_view(&agent)
    }

    /// Delete + re-add because a function-call key's allowance cannot be edited.
    pub fn rotate_agent_key(&mut self, agent_id: String, new_public_key: String) -> AgentView {
        self.assert_owner();
        let mut agent = self.agents.get(&agent_id).cloned().expect("agent missing");
        require!(
            agent.status == AgentStatus::Active,
            "cannot rotate a revoked agent"
        );
        require!(
            !self.agent_keys.contains_key(&new_public_key),
            "public key exists"
        );
        let parsed: PublicKey = new_public_key.parse().expect("invalid public key");
        let old: PublicKey = agent.public_key.parse().expect("stored key invalid");
        self.agent_keys.remove(&agent.public_key);
        self.agent_keys.insert(new_public_key.clone(), agent_id.clone());
        agent.public_key = new_public_key;
        self.agents.insert(agent_id.clone(), agent.clone());
        let allowance = agent_key_allowance();
        Promise::new(env::current_account_id())
            .delete_key(old)
            .then(
                Promise::new(env::current_account_id()).add_access_key_allowance(
                    parsed,
                    Allowance::limited(allowance).expect("agent allowance must be non-zero"),
                    env::current_account_id(),
                    "pay".to_string(),
                ),
            );
        agent_view(&agent)
    }

    /// Revocation is enforced by removing the key mapping (immediate for `pay`)
    /// and deleting the key at the protocol level (authoritative at FINAL).
    pub fn revoke_agent(&mut self, agent_id: String) -> AgentView {
        self.assert_owner();
        let mut agent = self.agents.get(&agent_id).cloned().expect("agent missing");
        if agent.status == AgentStatus::Active {
            let parsed: PublicKey = agent.public_key.parse().expect("stored key invalid");
            self.agent_keys.remove(&agent.public_key);
            agent.status = AgentStatus::Revoked;
            self.agents.insert(agent_id.clone(), agent.clone());
            Promise::new(env::current_account_id()).delete_key(parsed);
            log!(
                "EVENT_JSON:{}",
                json!({
                    "standard": "agentspend",
                    "version": "1.0.0",
                    "event": "agent_revoked",
                    "data": { "agent_id": agent_id }
                })
            );
        }
        agent_view(&agent)
    }

    pub fn add_merchant(
        &mut self,
        merchant_id: String,
        payout: AccountId,
        per_tx_limit: U128,
        window_limit: U128,
        window_secs: u64,
        allowlisted: bool,
    ) -> MerchantView {
        self.assert_owner();
        require!(is_safe_id(&merchant_id), "invalid merchant id");
        require!(payout != env::current_account_id(), "payout cannot be the vault");
        require!(
            window_limit.0 == 0 || window_secs > 0,
            "window limit needs a window"
        );
        let rule = MerchantRule {
            merchant_id: merchant_id.clone(),
            payout,
            per_tx_limit: per_tx_limit.0,
            window_limit: window_limit.0,
            window_secs,
            window_start_ms: env::block_timestamp_ms(),
            window_spent: 0,
            active: true,
            allowlisted,
        };
        self.merchants.insert(merchant_id, rule.clone());
        merchant_view(&rule)
    }

    pub fn remove_merchant(&mut self, merchant_id: String) -> bool {
        self.assert_owner();
        if let Some(mut rule) = self.merchants.get(&merchant_id).cloned() {
            rule.active = false;
            self.merchants.insert(merchant_id, rule);
            true
        } else {
            false
        }
    }

    /// Move only free balance. Reserved funds can never be withdrawn.
    pub fn withdraw(&mut self, amount: U128, to: AccountId) -> u64 {
        self.assert_owner();
        require!(amount.0 > 0, "amount must be positive");
        let free = self.accounted_balance.saturating_sub(self.reserved_debit);
        require!(amount.0 <= free, "amount exceeds free balance");
        require!(to != env::current_account_id(), "cannot withdraw to the vault");
        self.accounted_balance -= amount.0;
        self.withdrawal_nonce += 1;
        let nonce = self.withdrawal_nonce;
        self.pending_withdrawals.insert(nonce, amount.0);
        self.ft_transfer(to, amount.0, "agentspend:withdraw:v1".to_string())
            .then(
                Promise::new(env::current_account_id()).function_call(
                    "on_withdraw".to_string(),
                    serde_json::to_vec(&json!({ "nonce": nonce })).expect("json"),
                    NearToken::from_yoctonear(0),
                    GAS_FOR_CALLBACK,
                ),
            );
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "withdrawal",
                "data": { "nonce": nonce, "amount": U128(amount.0) }
            })
        );
        nonce
    }

    /// Owner-only emergency repair if a callback was lost. `merchant_paid` is an
    /// assertion by the owner, not a chain fact.
    pub fn reconcile_payment(&mut self, payment_id: String, merchant_paid: bool) {
        self.assert_owner();
        let mut payment = self.payments.get(&payment_id).cloned().expect("payment missing");
        require!(
            payment.status == PaymentStatus::Reserved,
            "only reserved payments can be reconciled"
        );
        let debit = payment.gross + payment.user_fee;
        if merchant_paid {
            require!(
                self.accounted_balance >= debit && self.reserved_debit >= debit,
                "accounting invariant"
            );
            self.accounted_balance -= debit;
            self.reserved_debit -= debit;
            payment.status = PaymentStatus::MerchantPaid;
            payment.fee_owed = payment.user_fee + payment.merchant_fee;
            self.payments.insert(payment_id.clone(), payment.clone());
            self.issue_fee_transfer(&payment);
        } else {
            self.reserved_debit = self.reserved_debit.saturating_sub(debit);
            self.total_gross_committed =
                self.total_gross_committed.saturating_sub(payment.gross);
            let day = self.day_spend.get(&payment.day_index).copied().unwrap_or(0);
            self.day_spend
                .insert(payment.day_index, day.saturating_sub(payment.gross));
            payment.status = PaymentStatus::Failed;
            payment.terminal_at_ms = env::block_timestamp_ms();
            self.payments.insert(payment_id, payment);
        }
    }

    /// Retry a fee transfer. Idempotent: fee_owed is zeroed before the promise
    /// and restored by the callback on failure.
    pub fn collect_fee(&mut self, payment_id: String) {
        let mut payment = self.payments.get(&payment_id).cloned().expect("payment missing");
        require!(payment.fee_owed > 0, "no fee owed");
        let amount = payment.fee_owed;
        payment.fee_owed = 0;
        self.payments.insert(payment_id.clone(), payment.clone());
        self.ft_transfer(
            self.fee_account.clone(),
            amount,
            format!("agentspend-fee:v1:{}", payment_id),
        )
        .then(
            Promise::new(env::current_account_id()).function_call(
                "on_collect_fee".to_string(),
                serde_json::to_vec(&json!({
                    "payment_id": payment_id,
                    "amount": U128(amount)
                }))
                .expect("json"),
                NearToken::from_yoctonear(0),
                GAS_FOR_CALLBACK,
            ),
        );
    }

    /// Prune terminal payment records older than 30 days. The replay marker is
    /// permanent, so pruning never enables a duplicate payment.
    pub fn prune(&mut self, payment_ids: Vec<String>) -> u32 {
        let now = env::block_timestamp_ms();
        let mut removed = 0;
        for id in payment_ids {
            let Some(payment) = self.payments.get(&id) else {
                continue;
            };
            let terminal = matches!(
                payment.status,
                PaymentStatus::Succeeded | PaymentStatus::Failed
            );
            if terminal
                && payment.terminal_at_ms > 0
                && now.saturating_sub(payment.terminal_at_ms) >= PRUNE_AFTER_MS
            {
                self.payments.remove(&id);
                removed += 1;
            }
        }
        removed
    }

    // -----------------------------------------------------------------------
    // Callbacks
    // -----------------------------------------------------------------------

    #[private]
    pub fn on_merchant_transfer(&mut self, payment_id: String) {
        let Some(mut payment) = self.payments.get(&payment_id).cloned() else {
            return;
        };
        if payment.status != PaymentStatus::Reserved {
            return;
        }
        let debit = payment.gross + payment.user_fee;
        match env::promise_result_checked(0, 10_000) {
            Ok(_) => {
                require!(
                    self.accounted_balance >= debit && self.reserved_debit >= debit,
                    "accounting invariant"
                );
                self.accounted_balance -= debit;
                self.reserved_debit -= debit;
                payment.status = PaymentStatus::MerchantPaid;
                payment.fee_owed = payment.user_fee + payment.merchant_fee;
                self.payments.insert(payment_id.clone(), payment.clone());
                log!(
                    "EVENT_JSON:{}",
                    json!({
                        "standard": "agentspend",
                        "version": "1.0.0",
                        "event": "merchant_paid",
                        "data": {
                            "payment_id": payment_id,
                            "payout": payment.payout,
                            "net": U128(payment.net)
                        }
                    })
                );
                // Fee is chained only after the merchant transfer succeeded.
                self.issue_fee_transfer(&payment);
            }
            Err(_) => {
                self.reserved_debit = self.reserved_debit.saturating_sub(debit);
                self.total_gross_committed =
                    self.total_gross_committed.saturating_sub(payment.gross);
                let day = self.day_spend.get(&payment.day_index).copied().unwrap_or(0);
                self.day_spend
                    .insert(payment.day_index, day.saturating_sub(payment.gross));
                payment.status = PaymentStatus::Failed;
                payment.terminal_at_ms = env::block_timestamp_ms();
                self.payments.insert(payment_id.clone(), payment);
                log!(
                    "EVENT_JSON:{}",
                    json!({
                        "standard": "agentspend",
                        "version": "1.0.0",
                        "event": "payment_failed",
                        "data": { "payment_id": payment_id }
                    })
                );
            }
        }
    }

    #[private]
    pub fn on_fee_transfer(&mut self, payment_id: String) {
        let Some(mut payment) = self.payments.get(&payment_id).cloned() else {
            return;
        };
        if payment.status != PaymentStatus::MerchantPaid {
            return;
        }
        let fee_failed = env::promise_result_checked(0, 10_000).is_err();
        if !fee_failed {
            payment.fee_owed = 0;
        }
        payment.status = PaymentStatus::Succeeded;
        payment.terminal_at_ms = env::block_timestamp_ms();
        self.payments.insert(payment_id.clone(), payment.clone());
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "agentspend",
                "version": "1.0.0",
                "event": "payment_succeeded",
                "data": {
                    "payment_id": payment_id,
                    "fee_owed": U128(payment.fee_owed),
                    "fee_failed": fee_failed
                }
            })
        );
    }

    #[private]
    pub fn on_collect_fee(&mut self, payment_id: String, amount: U128) {
        if env::promise_result_checked(0, 10_000).is_err() {
            if let Some(mut payment) = self.payments.get(&payment_id).cloned() {
                payment.fee_owed = payment.fee_owed.saturating_add(amount.0);
                self.payments.insert(payment_id, payment);
            }
        }
    }

    #[private]
    pub fn on_withdraw(&mut self, nonce: u64) {
        if let Some(amount) = self.pending_withdrawals.get(&nonce).copied() {
            self.pending_withdrawals.remove(&nonce);
            if env::promise_result_checked(0, 10_000).is_err() {
                self.accounted_balance = self.accounted_balance.saturating_add(amount);
            }
        }
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    pub fn get_config(&self) -> ConfigView {
        ConfigView {
            owner: self.owner.clone(),
            token: self.token.clone(),
            fee_account: self.fee_account.clone(),
            user_fee_bps: self.user_fee_bps,
            merchant_fee_bps: self.merchant_fee_bps,
            paused: self.paused,
            network: "testnet".to_string(),
        }
    }

    pub fn get_policy(&self) -> PolicyView {
        policy_view(&self.policy)
    }

    pub fn get_balance(&self) -> BalanceView {
        BalanceView {
            accounted_balance: U128(self.accounted_balance),
            reserved_debit: U128(self.reserved_debit),
            free_balance: U128(self.accounted_balance.saturating_sub(self.reserved_debit)),
            total_gross_committed: U128(self.total_gross_committed),
        }
    }

    pub fn get_usage(&self) -> UsageView {
        let day_index = (env::block_timestamp_ms() / DAY_MS) as u32;
        UsageView {
            day_index,
            day_gross: U128(self.day_spend.get(&day_index).copied().unwrap_or(0)),
            week_gross: U128(self.window_sum(day_index, 7)),
            month_gross: U128(self.window_sum(day_index, 30)),
            total_gross_committed: U128(self.total_gross_committed),
        }
    }

    pub fn get_state(&self) -> VaultStateView {
        VaultStateView {
            config: self.get_config(),
            policy: self.get_policy(),
            balance: self.get_balance(),
            usage: self.get_usage(),
            agent_count: self.agents.len() as u32,
            merchant_count: self.merchants.len() as u32,
        }
    }

    pub fn get_agent(&self, agent_id: String) -> Option<AgentView> {
        self.agents.get(&agent_id).map(agent_view)
    }

    pub fn get_agent_by_key(&self, public_key: String) -> Option<AgentView> {
        let agent_id = self.agent_keys.get(&public_key)?;
        self.agents.get(agent_id).map(agent_view)
    }

    pub fn get_agents(&self) -> Vec<AgentView> {
        self.agents.iter().map(|(_, a)| agent_view(a)).collect()
    }

    pub fn get_merchant(&self, merchant_id: String) -> Option<MerchantView> {
        self.merchants.get(&merchant_id).map(merchant_view)
    }

    pub fn get_merchants(&self) -> Vec<MerchantView> {
        self.merchants.iter().map(|(_, m)| merchant_view(m)).collect()
    }

    pub fn get_payment(&self, payment_id: String) -> Option<PaymentView> {
        self.payments.get(&payment_id).map(payment_view)
    }

    pub fn is_processed(&self, payment_id: String) -> bool {
        self.seen_payments
            .get(&env::sha256(payment_id.as_bytes()))
            .is_some()
    }

    pub fn get_approval(&self, approval_hash: String) -> Option<ApprovalView> {
        self.approvals.get(&approval_hash).map(|a| ApprovalView {
            payment_id: a.payment_id.clone(),
            merchant_id: a.merchant_id.clone(),
            gross: U128(a.gross),
            request_expiry_ms: a.request_expiry_ms,
            policy_version: a.policy_version,
            expires_at_ms: a.expires_at_ms,
        })
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    fn assert_owner(&self) {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the vault owner can do this"
        );
    }

    fn window_sum(&self, day_index: u32, days: u32) -> u128 {
        let mut total = 0u128;
        for i in 0..days {
            if let Some(day) = day_index.checked_sub(i) {
                total += self.day_spend.get(&day).copied().unwrap_or(0);
            }
        }
        total
    }

    fn needs_approval(&self, merchant_id: &str, allowlisted: bool) -> bool {
        if !allowlisted {
            match self.policy.unknown_merchant_mode {
                UnknownMerchantMode::Deny => return true, // pay panics earlier
                UnknownMerchantMode::RequireApproval => return true,
                UnknownMerchantMode::AllowWithCap(_) => {}
            }
        }
        match self.policy.approval_mode {
            ApprovalMode::All => true,
            ApprovalMode::NoneWithinPolicy => false,
            ApprovalMode::Selected => self
                .policy
                .approval_selected_merchants
                .iter()
                .any(|m| m == merchant_id),
            ApprovalMode::UnknownOnly => !allowlisted,
        }
    }

    fn ft_transfer(&self, receiver: AccountId, amount: u128, memo: String) -> Promise {
        Promise::new(self.token.clone()).function_call(
            "ft_transfer".to_string(),
            serde_json::to_vec(&json!({
                "receiver_id": receiver,
                "amount": U128(amount),
                "memo": memo
            }))
            .expect("json"),
            NearToken::from_yoctonear(1),
            GAS_FOR_FT_TRANSFER,
        )
    }

    fn issue_fee_transfer(&mut self, payment: &Payment) {
        let amount = payment.user_fee + payment.merchant_fee;
        if amount == 0 {
            // No fee to collect; finish directly without a cross-contract call.
            let mut done = payment.clone();
            done.status = PaymentStatus::Succeeded;
            done.fee_owed = 0;
            done.terminal_at_ms = env::block_timestamp_ms();
            self.payments.insert(done.payment_id.clone(), done);
            return;
        }
        self.ft_transfer(
            self.fee_account.clone(),
            amount,
            format!("agentspend-fee:v1:{}", payment.payment_id),
        )
        .then(
            Promise::new(env::current_account_id()).function_call(
                "on_fee_transfer".to_string(),
                serde_json::to_vec(&json!({ "payment_id": payment.payment_id })).expect("json"),
                NearToken::from_yoctonear(0),
                GAS_FOR_CALLBACK,
            ),
        );
    }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

fn compute_amounts(gross: u128, user_fee_bps: u16, merchant_fee_bps: u16) -> (u128, u128, u128, u128) {
    let user_fee = ceil_div(
        gross
            .checked_mul(user_fee_bps as u128)
            .expect("fee overflow"),
        BPS_DENOMINATOR,
    );
    let merchant_fee = ceil_div(
        gross
            .checked_mul(merchant_fee_bps as u128)
            .expect("fee overflow"),
        BPS_DENOMINATOR,
    );
    require!(merchant_fee < gross, "merchant fee consumes payment");
    let net = gross - merchant_fee;
    let debit = gross.checked_add(user_fee).expect("debit overflow");
    (user_fee, merchant_fee, net, debit)
}

fn ceil_div(numerator: u128, denominator: u128) -> u128 {
    numerator / denominator + u128::from(numerator % denominator != 0)
}

fn approval_hash(
    payment_id: &str,
    merchant_id: &str,
    gross: u128,
    request_expiry_ms: u64,
    policy_version: u32,
) -> String {
    let canonical = format!(
        "agentspend/approval/v1|{}|{}|{}|{}|{}",
        payment_id, merchant_id, gross, request_expiry_ms, policy_version
    );
    hex::encode(env::sha256(canonical.as_bytes()))
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= MAX_ID_LEN
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn validate_policy(policy: &Policy) {
    require!(policy.per_tx_limit > 0, "per-tx limit must be positive");
    require!(policy.total_budget > 0, "total budget must be positive");
    require!(
        policy.per_tx_limit <= policy.total_budget,
        "per-tx limit exceeds total budget"
    );
    require!(
        policy.expires_at_ms > policy.valid_from_ms,
        "policy expiry must be after start"
    );
    if let UnknownMerchantMode::AllowWithCap(cap) = &policy.unknown_merchant_mode {
        require!(cap.0 > 0, "unknown merchant cap must be positive");
    }
    for id in &policy.approval_selected_merchants {
        require!(is_safe_id(id), "invalid selected merchant id");
    }
}

fn policy_view(p: &Policy) -> PolicyView {
    PolicyView {
        total_budget: U128(p.total_budget),
        per_tx_limit: U128(p.per_tx_limit),
        daily_limit: U128(p.daily_limit),
        weekly_limit: U128(p.weekly_limit),
        monthly_limit: U128(p.monthly_limit),
        valid_from_ms: p.valid_from_ms,
        expires_at_ms: p.expires_at_ms,
        unknown_merchant_mode: p.unknown_merchant_mode.clone(),
        approval_mode: p.approval_mode.clone(),
        approval_selected_merchants: p.approval_selected_merchants.clone(),
        version: p.version,
    }
}

fn agent_view(a: &Agent) -> AgentView {
    AgentView {
        agent_id: a.agent_id.clone(),
        public_key: a.public_key.clone(),
        status: a.status.clone(),
        created_at_ms: a.created_at_ms,
        allowance_yocto: U128(a.allowance_yocto),
    }
}

fn merchant_view(m: &MerchantRule) -> MerchantView {
    MerchantView {
        merchant_id: m.merchant_id.clone(),
        payout: m.payout.clone(),
        per_tx_limit: U128(m.per_tx_limit),
        window_limit: U128(m.window_limit),
        window_secs: m.window_secs,
        window_start_ms: m.window_start_ms,
        window_spent: U128(m.window_spent),
        active: m.active,
        allowlisted: m.allowlisted,
    }
}

fn payment_view(p: &Payment) -> PaymentView {
    PaymentView {
        payment_id: p.payment_id.clone(),
        agent_id: p.agent_id.clone(),
        merchant_id: p.merchant_id.clone(),
        payout: p.payout.clone(),
        gross: U128(p.gross),
        user_fee: U128(p.user_fee),
        merchant_fee: U128(p.merchant_fee),
        net: U128(p.net),
        day_index: p.day_index,
        status: p.status.clone(),
        fee_owed: U128(p.fee_owed),
        created_at_ms: p.created_at_ms,
        terminal_at_ms: p.terminal_at_ms,
    }
}
