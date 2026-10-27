export type PaymentStatus =
  | "created"
  | "policy_checking"
  | "awaiting_approval"
  | "authorized"
  | "submitted"
  | "confirming"
  | "succeeded"
  | "denied"
  | "cancelled"
  | "expired"
  | "failed"
  | "unknown";

const TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  created: ["policy_checking", "cancelled"],
  policy_checking: ["denied", "awaiting_approval", "authorized", "failed"],
  awaiting_approval: ["authorized", "denied", "cancelled", "expired"],
  authorized: ["submitted", "failed", "cancelled"],
  submitted: ["confirming", "failed", "unknown"],
  confirming: ["succeeded", "failed", "unknown"],
  unknown: ["succeeded", "failed"],
  succeeded: [],
  denied: [],
  cancelled: [],
  expired: [],
  failed: [],
};

export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set([
  "succeeded",
  "denied",
  "cancelled",
  "expired",
  "failed",
]);

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`illegal payment transition: ${from} -> ${to}`);
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Statuses from which merchant fulfilment may be unlocked. */
export function isFulfillable(status: PaymentStatus): boolean {
  return status === "succeeded";
}

export function isSpendCommitted(status: PaymentStatus): boolean {
  return status === "succeeded";
}

export function isSpendReserved(status: PaymentStatus): boolean {
  return (
    status === "authorized" ||
    status === "submitted" ||
    status === "confirming" ||
    status === "unknown"
  );
}
