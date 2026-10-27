//! Minimal NEP-141 token for the AgentSpend testnet demo.
//!
//! This is NOT Circle USDC. The UI labels it "TEST USD (demo token)" wherever it
//! appears. It exists so the demo can run when Circle's testnet faucet cannot be
//! automated. It implements the parts of NEP-141 the vault needs:
//! ft_transfer, ft_transfer_call / ft_on_transfer, storage registration, metadata,
//! and an owner-only mint for the demo.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{
    env, log, near, require, AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use serde_json::json;

const STORAGE_COST: NearToken = NearToken::from_yoctonear(1_250_000_000_000_000_000_000); // 0.00125 NEAR
const GAS_FOR_FT_ON_TRANSFER: Gas = Gas::from_tgas(30);
const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(20);

#[near(serializers = [json])]
pub struct FtMetadata {
    pub spec: String,
    pub name: String,
    pub symbol: String,
    pub icon: Option<String>,
    pub reference: Option<String>,
    pub reference_hash: Option<String>,
    pub decimals: u8,
}

#[near(serializers = [json])]
pub struct StorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(serializers = [json])]
pub struct StorageBalanceBounds {
    pub min: U128,
    pub max: Option<U128>,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Token {
    owner: AccountId,
    name: String,
    symbol: String,
    decimals: u8,
    icon: Option<String>,
    total_supply: u128,
    accounts: LookupMap<AccountId, u128>,
    storage_deposits: LookupMap<AccountId, u128>,
}

#[near]
impl Token {
    #[init]
    pub fn new(
        owner: AccountId,
        name: String,
        symbol: String,
        decimals: u8,
        icon: Option<String>,
    ) -> Self {
        require!(decimals <= 24, "too many decimals");
        Self {
            owner,
            name,
            symbol,
            decimals,
            icon,
            total_supply: 0,
            accounts: LookupMap::new(b"a"),
            storage_deposits: LookupMap::new(b"s"),
        }
    }

    // -----------------------------------------------------------------------
    // NEP-141
    // -----------------------------------------------------------------------

    pub fn ft_metadata(&self) -> FtMetadata {
        FtMetadata {
            spec: "ft-1.0.0".to_string(),
            name: self.name.clone(),
            symbol: self.symbol.clone(),
            icon: self.icon.clone(),
            reference: None,
            reference_hash: None,
            decimals: self.decimals,
        }
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.accounts.get(&account_id).copied().unwrap_or(0))
    }

    #[payable]
    pub fn ft_transfer(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
    ) {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        assert_one_yocto();
        let sender = env::predecessor_account_id();
        self.internal_transfer(&sender, &receiver_id, amount.0, memo);
        let promise = Promise::new(receiver_id.clone()).function_call(
            "ft_on_transfer".to_string(),
            serde_json::to_vec(&json!({
                "sender_id": sender,
                "amount": U128(amount.0),
                "msg": msg
            }))
            .expect("json"),
            NearToken::from_yoctonear(0),
            GAS_FOR_FT_ON_TRANSFER,
        );
        let callback = promise.then(Promise::new(env::current_account_id()).function_call(
            "on_ft_transfer_call".to_string(),
            serde_json::to_vec(&json!({
                "sender_id": sender,
                "receiver_id": receiver_id,
                "amount": U128(amount.0)
            }))
            .expect("json"),
            NearToken::from_yoctonear(0),
            GAS_FOR_CALLBACK,
        ));
        PromiseOrValue::Promise(callback)
    }

    #[private]
    pub fn on_ft_transfer_call(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let refund = match env::promise_result_checked(0, 10_000) {
            Ok(data) => match serde_json::from_slice::<String>(&data) {
                Ok(unused) => unused.parse::<u128>().unwrap_or(amount.0).min(amount.0),
                Err(_) => amount.0,
            },
            Err(_) => amount.0,
        };
        if refund > 0 {
            self.internal_transfer(&receiver_id, &sender_id, refund, None);
        }
        U128(refund)
    }

    // -----------------------------------------------------------------------
    // Storage
    // -----------------------------------------------------------------------

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        let exists = self.accounts.contains_key(&account_id);
        let registration_only = registration_only.unwrap_or(false);

        if exists && registration_only {
            refund_deposit(attached);
            return self.storage_balance(account_id);
        }

        let required = if exists { 0 } else { STORAGE_COST.as_yoctonear() };
        require!(
            attached.as_yoctonear() >= required,
            "not enough deposit for storage"
        );
        if !exists {
            self.accounts.insert(account_id.clone(), 0);
        }
        let previous = self.storage_deposits.get(&account_id).copied().unwrap_or(0);
        self.storage_deposits
            .insert(account_id.clone(), previous + attached.as_yoctonear());
        let excess = attached.as_yoctonear() - required;
        refund_deposit(NearToken::from_yoctonear(excess));
        self.storage_balance(account_id)
    }

    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> StorageBalance {
        assert_one_yocto();
        let account = env::predecessor_account_id();
        let deposit = self.storage_deposits.get(&account).copied().unwrap_or(0);
        let balance = self.accounts.get(&account).copied().unwrap_or(0);
        let locked = if balance > 0 { STORAGE_COST.as_yoctonear() } else { 0 };
        let available = deposit.saturating_sub(locked);
        let requested = amount.map(|a| a.0).unwrap_or(available).min(available);
        require!(requested > 0, "nothing to withdraw");
        self.storage_deposits
            .insert(account.clone(), deposit - requested);
        let _ = Promise::new(account.clone()).transfer(NearToken::from_yoctonear(requested));
        self.storage_balance(account)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        if self.accounts.contains_key(&account_id) {
            Some(self.storage_balance(account_id))
        } else {
            None
        }
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: U128(STORAGE_COST.as_yoctonear()),
            max: None,
        }
    }

    fn storage_balance(&self, account_id: AccountId) -> StorageBalance {
        let total = self.storage_deposits.get(&account_id).copied().unwrap_or(0);
        let balance = self.accounts.get(&account_id).copied().unwrap_or(0);
        let locked = if balance > 0 { STORAGE_COST.as_yoctonear() } else { 0 };
        StorageBalance {
            total: U128(total),
            available: U128(total.saturating_sub(locked)),
        }
    }

    // -----------------------------------------------------------------------
    // Demo mint (owner only)
    // -----------------------------------------------------------------------

    pub fn mint(&mut self, account_id: AccountId, amount: U128) -> U128 {
        require!(
            env::predecessor_account_id() == self.owner,
            "only the token owner can mint"
        );
        require!(amount.0 > 0, "amount must be positive");
        require!(
            self.accounts.contains_key(&account_id),
            "account is not storage-registered"
        );
        let balance = self.accounts.get(&account_id).copied().unwrap_or(0);
        self.accounts.insert(account_id.clone(), balance + amount.0);
        self.total_supply += amount.0;
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "nep141",
                "version": "1.0.0",
                "event": "ft_mint",
                "data": [{ "owner_id": account_id, "amount": U128(amount.0) }]
            })
        );
        U128(self.accounts.get(&account_id).copied().unwrap_or(0))
    }

    pub fn get_owner(&self) -> AccountId {
        self.owner.clone()
    }

    // -----------------------------------------------------------------------
    // Internals
    // -----------------------------------------------------------------------

    fn internal_transfer(
        &mut self,
        sender: &AccountId,
        receiver: &AccountId,
        amount: u128,
        memo: Option<String>,
    ) {
        require!(amount > 0, "amount must be positive");
        require!(sender != receiver, "sender and receiver must differ");
        let sender_balance = self.accounts.get(sender).copied().unwrap_or(0);
        require!(sender_balance >= amount, "insufficient token balance");
        require!(
            self.accounts.contains_key(receiver),
            "receiver is not storage-registered"
        );
        self.accounts.insert(sender.clone(), sender_balance - amount);
        let receiver_balance = self.accounts.get(receiver).copied().unwrap_or(0);
        self.accounts
            .insert(receiver.clone(), receiver_balance + amount);
        log!(
            "EVENT_JSON:{}",
            json!({
                "standard": "nep141",
                "version": "1.0.0",
                "event": "ft_transfer",
                "data": [{
                    "old_owner_id": sender,
                    "new_owner_id": receiver,
                    "amount": U128(amount),
                    "memo": memo
                }]
            })
        );
    }
}

fn assert_one_yocto() {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        "requires exactly 1 yoctoNEAR"
    );
}

fn refund_deposit(amount: NearToken) {
    if amount > NearToken::from_yoctonear(0) {
        let _ = Promise::new(env::predecessor_account_id()).transfer(amount);
    }
}
