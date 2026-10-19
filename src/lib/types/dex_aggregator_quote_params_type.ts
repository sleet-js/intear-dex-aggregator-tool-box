// =================================================
// dex_aggregator_quote_params_type
// Per-trade quote parameters for the intear dex-aggregator.
// Things that stay constant across trades (referrer_id, default
// DEXes, wait budget, api key) live on DEX_AGGREGATOR_CLIENT and
// can still be overridden per trade via the matching `?` field
// on QUOTE_PARAMS_TYPE.
// =================================================
/** Which side of the swap the caller fixes.
 *
 *  - `In`: most common — "I sell exactly X", the router quotes what
 *    you receive (`amount_in=...` on the wire).
 *  - `Out`: "I want exactly Y", the router quotes what you must pay
 *    (`amount_out=...` on the wire; Rhea does not serve this mode
 *    so fewer routes may come back). */
export type QuoteAmount =
  | { kind: "in"; amountIn: string }
  | { kind: "out"; amountOut: string };
// =================================================
/** Slippage tolerance for a quote.
 *
 *  - `Fixed`: one decimal, e.g. `0.01` = 1% (`slippage_type=Fixed`).
 *  - `Auto`: router picks between `min` and `max` from market
 *    conditions (`slippage_type=Auto`). */
export type Slippage =
  | { kind: "fixed"; slippage: number }
  | { kind: "auto"; minSlippage: number; maxSlippage: number };
// =================================================
/** Sensible default: fixed 1% slippage. */
export const DEFAULT_SLIPPAGE: Slippage = { kind: "fixed", slippage: 0.01 };
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
export type TokenId = string;
// =================================================
/** Per-trade quote parameters. Everything the router needs that varies
 *  per swap lives here; things that stay constant across trades
 *  (`referrer_id`, default `dexes`, `max_wait_ms`, api key) live on
 *  the client and can still be overridden per trade via the matching
 *  `?` field below.
 *
 *  Amounts are decimal strings in the token's smallest unit. The
 *  router serves mainnet only — testnet tokens return `[]`. */
export interface QuoteParams {
  /** Token to swap from. */
  tokenIn: TokenId;
  /** Token to swap to. */
  tokenOut: TokenId;
  /** Fixed input vs desired output amount. */
  amount: QuoteAmount;
  /** Slippage tolerance (defaults to fixed 1%). */
  slippage: Slippage;
  /** Max time (ms) the router may spend quoting (up to 60000).
   *  `undefined` falls back to the client's default. */
  maxWaitMs?: number;
  /** Comma-separated DEX allow-list (e.g. `"Rhea,Wrap"`).
   *  `undefined` falls back to the client's default (all DEXes). */
  dexes?: string;
  /** Account used for storage-deposit legs. Pass the signer when
   *  you plan to execute so the aggregator can plan storage. */
  traderAccountId?: string;
  /** Public key for NEAR Intents legs (`add_public_key` needed).
   *  Router never emits those today but the field is kept for forward
   *  compatibility. */
  signingPublicKey?: string;
  /** Per-trade referrer override. `undefined` falls back to the
   *  client's configured referrer. */
  referrerId?: string;
}
// =================================================
/** Quote selling an exact `amount_in` with fixed 1% slippage. */
export function amountIn(
  tokenIn: TokenId,
  tokenOut: TokenId,
  amountIn: string,
): QuoteParams {
  return {
    tokenIn,
    tokenOut,
    amount: { kind: "in", amountIn },
    slippage: DEFAULT_SLIPPAGE,
  };
}
// =================================================
/** Quote buying an exact `amount_out` with fixed 1% slippage. */
export function amountOut(
  tokenIn: TokenId,
  tokenOut: TokenId,
  amountOut: string,
): QuoteParams {
  return {
    ...amountIn(tokenIn, tokenOut, ""),
    amount: { kind: "out", amountOut },
  };
}
// =================================================
/** Set a fixed slippage decimal (e.g. `0.01`). */
export function withFixedSlippage(
  params: QuoteParams,
  slippage: number,
): QuoteParams {
  return { ...params, slippage: { kind: "fixed", slippage } };
}
/** Set auto slippage bounds (router picks between `min` and `max`). */
export function withAutoSlippage(
  params: QuoteParams,
  minSlippage: number,
  maxSlippage: number,
): QuoteParams {
  return {
    ...params,
    slippage: { kind: "auto", minSlippage, maxSlippage },
  };
}
/** Override the router wait budget for this trade. */
export function withMaxWaitMs(
  params: QuoteParams,
  maxWaitMs: number,
): QuoteParams {
  return { ...params, maxWaitMs };
}
/** Restrict this trade to a comma-separated DEX allow-list. */
export function withDexes(params: QuoteParams, dexes: string): QuoteParams {
  return { ...params, dexes };
}
/** Set the trader account (enables storage-deposit legs). */
export function withTraderAccountId(
  params: QuoteParams,
  traderAccountId: string,
): QuoteParams {
  return { ...params, traderAccountId };
}
/** Set the signing public key (needed for Intents legs). */
export function withSigningPublicKey(
  params: QuoteParams,
  signingPublicKey: string,
): QuoteParams {
  return { ...params, signingPublicKey };
}
/** Override the client's referrer for this trade. */
export function withReferrerId(
  params: QuoteParams,
  referrerId: string,
): QuoteParams {
  return { ...params, referrerId };
}
// =================================================
/** `in <amount>` / `out <amount>` for use in error messages. */
export function describeAmount(amount: QuoteAmount): string {
  switch (amount.kind) {
    case "in":
      return `in ${amount.amountIn}`;
    case "out":
      return `out ${amount.amountOut}`;
  }
}
// =================================================
// copyright 2026 by sleet.near
