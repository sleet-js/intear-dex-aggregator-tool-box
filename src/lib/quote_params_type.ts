// =================================================
// quote_params_type
// Per-trade quote parameters for the intear dex-aggregator.
// Things that stay constant across trades (referrer_id, default
// DEXes, wait budget, api key) live on DEX_AGGREGATOR_CLIENT and
// can still be overridden per trade via the matching `?` field
// on QUOTE_PARAMS.
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
  /** Public key for NEAR Intents legs (`add_public_key` needed).
   *  Router never emits those today but the field is kept for forward
   *  compatibility. */
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
/** Set the signing public key (needed for Intents legs). */
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