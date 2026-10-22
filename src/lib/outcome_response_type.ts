// =================================================
// outcome_response_type
// The typed response of the aggregator's `GET /route/outcome`
// endpoint — what a route's transactions actually did on chain.
//
// Wire source of truth (matches upstream):
//   https://docs.intear.tech/dex-aggregator/reference/outcome
//
// The endpoint does not trust the transactions' return values. It
// waits (up to 60s) for every transaction and receipt to execute,
// then compares the trader's balances before the block of the first
// transaction with the balances after the block of the last receipt,
// in every place a token can be held (native NEAR, wNEAR in the
// wallet, Rhea and Intear DEX inner balances). That is why it sees a
// refund that a `SuccessValue` check cannot.
//
// `charge_fee` is the authoritative success flag: `true` means the
// trader received some of the output. Only then should the route's
// fee transactions be sent.
// =================================================
import type { EXECUTION_INSTRUCTION } from "./route_response_type";
// =================================================
/** One balance of the input or output token that changed, read at the
 *  two blocks the endpoint compares. `change` is a signed decimal
 *  string, negative when the balance went down. */
export interface BALANCE_CHANGE {
  /** Token id of the place the token is held, e.g. `near`,
   *  `nep141:usdt.tether-token.near`, `rhea-nep141:wrap.near`,
   *  `intear-dex:near`. */
  token: string;
  /** Signed amount in the token's smallest unit. */
  change: string;
}
// =================================================
/** What the endpoint answered about one route's transactions.
 *
 *  Two modes, chosen with `wait_until`:
 *
 *  - `executed` (default): everything executed and the balances were
 *    compared. `settled: true`, `balance_changes` and `next_steps`
 *    populated.
 *  - `swap`: answered as soon as the swaps executed, before the
 *    output reaches the trader. `settled: false` and
 *    `balance_changes` / `next_steps` are empty — ask again with
 *    `executed` once the fee transactions are sent to learn what
 *    ended up somewhere else.
 *
 *  A failed swap, a route without a swap (a Wrap route) and
 *  transactions that all executed before their swaps were seen are
 *  answered as with `executed`, so `settled: true`. */
export interface SWAP_OUTCOME {
  /** Whether the swap went through: `true` when the trader received
   *  any of the output. Send the route's fee transactions only when
   *  this is `true`. */
  charge_fee: boolean;
  /** How much of the input the transactions spent, wherever it was
   *  held. For NEAR, gas and storage deposits do not count. What the
   *  fee transactions pay is not included, since they have not been
   *  sent yet. */
  amount_in: string;
  /** How much of the output the transactions gave, wherever it ended
   *  up. */
  amount_out: string;
  /** Every balance of the input and output tokens that changed.
   *  Empty when `settled` is `false`. */
  balance_changes: BALANCE_CHANGE[];
  /** Execution instructions that move whatever ended up somewhere
   *  else to `token_in` / `token_out` — for example the wNEAR left
   *  over when a swap from NEAR fails, or the output of a route whose
   *  `token_output` is not the requested `token_out`.
   *
   *  These are ordinary `EXECUTION_INSTRUCTION`s (`NearTransaction`
   *  with `FunctionCall` actions), so they execute through the same
   *  helpers as a route's own instructions. Send them after the fee
   *  transactions. Usually empty. Empty when `settled` is `false`. */
  next_steps: EXECUTION_INSTRUCTION[];
  /** Why the swap failed, already written to show to the trader.
   *  `null` when `charge_fee` is `true`. */
  error: string | null;
  /** Whether every transaction and receipt executed and the
   *  balances were compared. `false` only for an answer at the swap
   *  (`wait_until=swap`). */
  settled: boolean;
}
// =================================================
/** Params for `GET /route/outcome`.
 *
 *  All four core fields are required: the endpoint re-derives what
 *  happened from the balances of `token_in` / `token_out` for
 *  `trader_account_id`, so it needs the same ids the route was
 *  quoted with. */
export interface OUTCOME_PARAMS {
  /** `token_in` of the original route request. */
  token_in: string;
  /** `token_out` of the original route request. Must differ from
   *  `token_in`. */
  token_out: string;
  /** The account that signed the transactions. */
  trader_account_id: string;
  /** Hashes of the route's transactions, without its fee
   *  transactions. 1 to 20 of them, each once. */
  tx_hashes: string[];
  /** The quote's `fee_amount`, so `next_steps` leave the fee in the
   *  wallet for the fee transactions. Defaults to `"0"`. */
  fee_amount?: string;
  /** When to answer. `"executed"` (default) waits for everything;
   *  `"swap"` answers as soon as the swap executed. */
  wait_until?: "executed" | "swap";
}
// =================================================
function read_instructions(
  value: unknown,
  field: string,
): EXECUTION_INSTRUCTION[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${field}: expected an array`);
  }
  return value as EXECUTION_INSTRUCTION[];
}

function read_balance_changes(value: unknown): BALANCE_CHANGE[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new Error("balance_changes: expected an array");
  }
  return value.map((entry, i) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`balance_changes[${i}]: expected an object`);
    }
    const raw = entry as Record<string, unknown>;
    if (typeof raw["token"] !== "string") {
      throw new Error(`balance_changes[${i}].token: expected a string`);
    }
    if (typeof raw["change"] !== "string") {
      throw new Error(
        `balance_changes[${i}].change: expected a signed decimal string`,
      );
    }
    return { token: raw["token"], change: raw["change"] };
  });
}
// =================================================
/** Coerce the router's `/route/outcome` JSON into a typed
 *  `SWAP_OUTCOME`. Strict on the fields a caller branches on
 *  (`charge_fee`, `settled`) and lenient on the rest. */
export function COERCE_SWAP_OUTCOME(raw: unknown): SWAP_OUTCOME {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("outcome: expected an object");
  }
  const record = raw as Record<string, unknown>;
  if (typeof record["charge_fee"] !== "boolean") {
    throw new Error("outcome.charge_fee: expected a boolean");
  }
  if (typeof record["settled"] !== "boolean") {
    throw new Error("outcome.settled: expected a boolean");
  }
  const amount_in = record["amount_in"];
  const amount_out = record["amount_out"];
  if (typeof amount_in !== "string") {
    throw new Error("outcome.amount_in: expected a decimal string");
  }
  if (typeof amount_out !== "string") {
    throw new Error("outcome.amount_out: expected a decimal string");
  }
  const error = record["error"];
  if (error !== null && typeof error !== "string") {
    throw new Error("outcome.error: expected a string or null");
  }
  return {
    charge_fee: record["charge_fee"],
    settled: record["settled"],
    amount_in,
    amount_out,
    error,
    balance_changes: read_balance_changes(record["balance_changes"]),
    next_steps: read_instructions(record["next_steps"], "outcome.next_steps"),
  };
}
// =================================================
// pure helpers on the outcome
/** True when the route's fee transactions should be sent. A swap that
 *  failed on chain still lets its own transaction succeed, so this —
 *  not the transaction status — decides whether fees are owed. */
export function SHOULD_CHARGE_FEE(outcome: SWAP_OUTCOME): boolean {
  return outcome.charge_fee;
}
/** True when anything ended up somewhere other than `token_in` /
 *  `token_out` and needs moving back. Empty unless the outcome is
 *  settled. */
export function HAS_NEXT_STEPS(outcome: SWAP_OUTCOME): boolean {
  return outcome.settled && outcome.next_steps.length > 0;
}
/** True when the swap did not go through. The router writes `error`
 *  for the trader; `charge_fee` is the machine-readable flag. */
export function SWAP_FAILED(outcome: SWAP_OUTCOME): boolean {
  return !outcome.charge_fee;
}
// =================================================
// copyright 2026 by sleet.near