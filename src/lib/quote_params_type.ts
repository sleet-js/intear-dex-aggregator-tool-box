// =================================================
// quote_params_type
// Per-trade quote parameters for the intear dex-aggregator.
// Things that stay constant across trades (referrer_id, default
// DEXes, wait budget, api key) live on DEX_AGGREGATOR_CLIENT and
// can still be overridden per trade via the matching `?` field
// on QUOTE_PARAMS.
// =================================================
import { DEX_AGGREGATOR_CLIENT_ERROR } from "./client";
// =================================================
/** Which side of the swap the caller fixes.
 *
 *  - `in`: most common — "I sell exactly X", the router quotes what
 *    you receive (`amount_in=...` on the wire).
 *  - `out`: "I want exactly Y", the router quotes what you must pay
 *    (`amount_out=...` on the wire; Rhea does not serve this mode
 *    so fewer routes may come back). */
export type QUOTE_AMOUNT =
  | { kind: "in"; amount_in: string }
  | { kind: "out"; amount_out: string };
// =================================================
/** Slippage tolerance for a quote.
 *
 *  - `fixed`: one decimal, e.g. `0.01` = 1% (`slippage_type=Fixed`).
 *  - `auto`: router picks between `min` and `max` from market
 *    conditions (`slippage_type=Auto`). */
export type SLIPPAGE =
  | { kind: "fixed"; slippage: number }
  | { kind: "auto"; min_slippage: number; max_slippage: number };
// =================================================
/** Sensible default: fixed 1% slippage. */
export const DEFAULT_SLIPPAGE: SLIPPAGE = { kind: "fixed", slippage: 0.01 };
// =================================================
/** Token id accepted by the router. The wire form supports several
 *  flavours:
 *  - `near` — native NEAR (also accepts `nep141:wrap.near` for the
 *    equivalent wrapped form).
 *  - `nep141:<account>` — generic NEP-141 token.
 *  - `rhea-nep141:<account>` — Rhea's inner-balance representation
 *    (the aggregator emits this for tokens sitting on Rhea).
 *  - `intear-dex:<id>` — Intear's native DEX (Plach) representation.
 *  This toolbox passes the string through verbatim; normalize your
 *  own ids before calling to keep your UI in sync with the formatter. */
export type TOKEN_ID = string;
// =================================================
/** One account to pay a referral fee, and the fraction of the swap it
 *  charges. `0.005` is 0.5%. */
export interface FEE_CHARGE {
  /** Account the fee is paid to. */
  account_id: string;
  /** Fraction of the swap, as a decimal: `0.005` is 0.5%. Must be a
   *  multiple of `0.000001`. */
  fee: number;
}
// =================================================
/** Per-trade quote parameters. Everything the router needs that varies
 *  per swap lives here; things that stay constant across trades
 *  (`referrer_id`, default `dexes`, `max_wait_ms`, api key) live on
 *  the client and can still be overridden per trade via the matching
 *  `?` field below.
 *
 *  Amounts are decimal strings in the token's smallest unit. The
 *  router serves mainnet only — testnet tokens return `[]`. */
export interface QUOTE_PARAMS {
  /** Token to swap from. */
  token_in: TOKEN_ID;
  /** Token to swap to. */
  token_out: TOKEN_ID;
  /** Fixed input vs desired output amount. */
  amount: QUOTE_AMOUNT;
  /** Slippage tolerance (defaults to fixed 1%). */
  slippage: SLIPPAGE;
  /** Max time (ms) the router may spend quoting (up to 60000).
   *  `undefined` falls back to the client's default. */
  max_wait_ms?: number;
  /** Comma-separated DEX allow-list (e.g. `"Rhea,Wrap"`).
   *  `undefined` falls back to the client's default (all DEXes). */
  dexes?: string;
  /** Account used for storage-deposit legs. Pass the signer when
   *  you plan to execute so the aggregator can plan storage. */
  trader_account_id?: string;
  /** Your own referral fee, charged once on the input, on every DEX.
   *
   *  Up to 4 accounts and 5% in total, each in steps of `0.000001`.
   *  Each account receives 80% of its fee and 20% goes to the
   *  aggregator. Set on a route, the fee is part of the quote: its
   *  `estimated_amount` and `worst_case_amount` already have it taken
   *  out, so do not subtract it again.
   *
   *  Routes with fees carry `fee_amount`, and on Rhea and Rhea DCL the
   *  payout is a trailing `is_fee_transaction: true` leg. Send it only
   *  when `GET /route/outcome` reports `charge_fee: true` — see
   *  `EXECUTE_ROUTE_FULL`. */
  fees?: FEE_CHARGE[];
  /** The **signer's own** public key, e.g.
 *  `ed25519:6QxhpH1WENv3mS8Gr1Yx2iZQqZQdVZHi1s8VqEBnCLx`.
   *
   *  The router reads this key's current nonce and a recent block hash
   *  and returns them as `signing` on every quote, so the route's
   *  transactions can be signed without asking an RPC first. The first
   *  transaction takes `nonce + 1`, and each one after it the nonce
   *  after the one before — see `ROUTE_SIGNING_NONCES`.
   *
   *  Pass the public key of the account in `trader_account_id`, not
   *  that account's *private* key, and not some other key's. A
   *  mismatched key is not rejected: the router answers `200` and
   *  simply omits `signing`, so the optimization silently does nothing.
   *
   *  A malformed key is a `400`. Nothing else on the wire relates to
   *  this parameter — there are no Intents instructions in the router's
   *  format, so no `add_public_key` transaction is needed. */
  signing_public_key?: string;
  /** Per-trade referrer override. `undefined` falls back to the
   *  client's configured referrer. */
  referrer_id?: string;
}
// =================================================
/** Quote selling an exact `amount_in` with fixed 1% slippage. */
export function AMOUNT_IN(
  token_in: TOKEN_ID,
  token_out: TOKEN_ID,
  amount_in: string,
): QUOTE_PARAMS {
  return {
    token_in,
    token_out,
    amount: { kind: "in", amount_in },
    slippage: DEFAULT_SLIPPAGE,
  };
}
// =================================================
/** Quote buying an exact `amount_out` with fixed 1% slippage. */
export function AMOUNT_OUT(
  token_in: TOKEN_ID,
  token_out: TOKEN_ID,
  amount_out: string,
): QUOTE_PARAMS {
  return {
    ...AMOUNT_IN(token_in, token_out, ""),
    amount: { kind: "out", amount_out },
  };
}
// =================================================
/** Set a fixed slippage decimal (e.g. `0.01`). */
export function WITH_FIXED_SLIPPAGE(
  params: QUOTE_PARAMS,
  slippage: number,
): QUOTE_PARAMS {
  return { ...params, slippage: { kind: "fixed", slippage } };
}
/** Set auto slippage bounds (router picks between `min` and `max`). */
export function WITH_AUTO_SLIPPAGE(
  params: QUOTE_PARAMS,
  min_slippage: number,
  max_slippage: number,
): QUOTE_PARAMS {
  return {
    ...params,
    slippage: { kind: "auto", min_slippage, max_slippage },
  };
}
/** Override the router wait budget for this trade. */
export function WITH_MAX_WAIT_MS(
  params: QUOTE_PARAMS,
  max_wait_ms: number,
): QUOTE_PARAMS {
  return { ...params, max_wait_ms };
}
/** Restrict this trade to a comma-separated DEX allow-list. */
export function WITH_DEXES(params: QUOTE_PARAMS, dexes: string): QUOTE_PARAMS {
  return { ...params, dexes };
}
/** Set the trader account (enables storage-deposit legs). */
export function WITH_TRADER_ACCOUNT_ID(
  params: QUOTE_PARAMS,
  trader_account_id: string,
): QUOTE_PARAMS {
  return { ...params, trader_account_id };
}
/** Set the signer's own public key, so the route can be signed without
 *  an RPC round trip for the nonce. See `QUOTE_PARAMS.signing_public_key`
 *  — a mismatched key is accepted but silently yields no `signing`. */
export function WITH_SIGNING_PUBLIC_KEY(
  params: QUOTE_PARAMS,
  signing_public_key: string,
): QUOTE_PARAMS {
  return { ...params, signing_public_key };
}
/** Override the client's referrer for this trade. */
export function WITH_REFERRER_ID(
  params: QUOTE_PARAMS,
  referrer_id: string,
): QUOTE_PARAMS {
  return { ...params, referrer_id };
}
// =================================================
/** Charge your own referral fee on this trade's swap.
 *
 *  The router takes the fee once, on the input, on every DEX, and the
 *  quote already has it subtracted from `estimated_amount` and
 *  `worst_case_amount`.
 *
 *  @example
 *  ```ts
 *  WITH_FEES(params, [
 *  { account_id: "you.near", fee: 0.005 },   // 0.5%
 *  ]);
 *  ``` */
export function WITH_FEES(
  params: QUOTE_PARAMS,
  fees: FEE_CHARGE[],
): QUOTE_PARAMS {
  return { ...params, fees };
}
// =================================================
/** The router's limits on the `fees` parameter. Exceeding any of them
 *  is a `400`, so they are checked before the request. */
export const FEES_MAX_ACCOUNTS = 4;
export const FEES_MAX_TOTAL = 0.05;
export const FEES_MAX_EACH = 0.05;
/** Fees are charged in steps of a ten-thousandth of a percent. */
export const FEES_STEP = 0.000001;
// =================================================
/** Validate the `fees` list against the router's limits and return
 *  the JSON object it expects as the `fees` query value.
 *
 *  Throws `DEX_AGGREGATOR_CLIENT_ERROR` with `kind: "invalid_params"`
 *  on a limit breach, so a caller finds out before the request rather
 *  ��than as an opaque `400`. */
export function fees_to_query(
  fees: FEE_CHARGE[] | undefined,
): string | undefined {
  if (fees === undefined) return undefined;
  if (fees.length === 0) return undefined;
  if (fees.length > FEES_MAX_ACCOUNTS) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message: `fees: at most ${FEES_MAX_ACCOUNTS} accounts, got ${fees.length}`,
    });
  }
  const by_account: Record<string, number> = {};
  let total = 0;
  for (const charge of fees) {
    const account = charge.account_id.trim();
    if (account.length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "fees: every charge needs a non-empty account_id",
      });
    }
    if (by_account[account] !== undefined) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: `fees: ${account} is charged twice`,
      });
    }
    const fee = charge.fee;
    if (!Number.isFinite(fee) || fee < 0 || fee > FEES_MAX_EACH) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: `fees: ${account} has fee ${fee}, must be between 0 and ${FEES_MAX_EACH}`,
      });
    }
    // Steps of 0.000001, checked on the scaled integer to avoid
    // floating point drift (0.0000005 * 1e6 = 0.4999999999999999).
    const scaled = Math.round(fee / FEES_STEP);
    if (Math.abs(fee - scaled * FEES_STEP) > 1e-12) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: `fees: ${account} has fee ${fee}, must be a multiple of ${FEES_STEP}`,
      });
    }
    by_account[account] = fee;
    total += fee;
  }
  if (total > FEES_MAX_TOTAL + 1e-12) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message: `fees: total ${total} exceeds the ${FEES_MAX_TOTAL} limit`,
    });
  }
  return JSON.stringify(by_account);
}
// =================================================
/** `in <amount>` / `out <amount>` for use in error messages. */
export function DESCRIBE_AMOUNT(amount: QUOTE_AMOUNT): string {
  switch (amount.kind) {
    case "in":
      return `in ${amount.amount_in}`;
    case "out":
      return `out ${amount.amount_out}`;
  }
}
// =================================================
// copyright 2026 by sleet.near