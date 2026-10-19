// =================================================
// error_type
// Every failure mode of this toolbox in one typed union.
//
// The most common one to match on is `route_not_found`: the router
// answers `200` with `[]` when no DEX can serve a pair (unknown
// token, no liquidity, `amount_out` mode on Rhea-only pairs, ...).
// It is deliberately distinct from transport / parse errors so
// callers can e.g. fall back to another pair instead of retrying.
//
// The thrown runtime class (`DEX_AGGREGATOR_CLIENT_ERROR`) is defined
// in `client.ts` because it has to live where the runtime errors are
// constructed.
// =================================================
/** No DEX returned a route for this pair + amount. Check the token
 *  ids (testnet tokens are unsupported — the router is mainnet only),
 *  try a smaller amount, `amount_in` mode, or more `dexes`. */
export interface DEX_AGGREGATOR_ROUTE_NOT_FOUND_ERROR {
  kind: "route_not_found";
  token_in: string;
  token_out: string;
  amount_desc: string;
  hint: string;
}
/** Quote parameters were inconsistent (e.g. empty token id). */
export interface DEX_AGGREGATOR_INVALID_PARAMS_ERROR {
  kind: "invalid_params";
  message: string;
}
/** HTTP transport failure or non-2xx router status. */
export interface DEX_AGGREGATOR_HTTP_ERROR {
  kind: "http";
  message: string;
}
/** Router answered with a body that is not a route array. */
export interface DEX_AGGREGATOR_PARSE_ERROR {
  kind: "parse";
  message: string;
}
/** A base64 `args` payload in an instruction did not decode. */
export interface DEX_AGGREGATOR_BASE64_DECODE_ERROR {
  kind: "base64_decode";
  context: string;
  message: string;
}
/** A numeric field (`deposit`, ...) did not parse. */
export interface DEX_AGGREGATOR_INVALID_NUMBER_ERROR {
  kind: "invalid_number";
  context: string;
  value: string;
  message: string;
}
/** A NEAR transaction (or client setup) failed via near-kit. */
export interface DEX_AGGREGATOR_NEAR_ERROR {
  kind: "near";
  message: string;
  /** Original near-kit error for advanced matching; you usually do
   *  not need to inspect this. */
  cause?: unknown;
}
// =================================================
/** Discriminated union of every failure mode this toolbox surfaces. */
export type DEX_AGGREGATOR_ERROR =
  | DEX_AGGREGATOR_ROUTE_NOT_FOUND_ERROR
  | DEX_AGGREGATOR_INVALID_PARAMS_ERROR
  | DEX_AGGREGATOR_HTTP_ERROR
  | DEX_AGGREGATOR_PARSE_ERROR
  | DEX_AGGREGATOR_BASE64_DECODE_ERROR
  | DEX_AGGREGATOR_INVALID_NUMBER_ERROR
  | DEX_AGGREGATOR_NEAR_ERROR;
// =================================================
/** Format a `DEX_AGGREGATOR_ERROR` for `console.error` / log output.
 *
 *  Exported from the types module so callers can print a typed error
 *  even when the throwable class lives in `client.ts`. */
export function FORMAT_DEX_AGGREGATOR_ERROR(e: DEX_AGGREGATOR_ERROR): string {
  switch (e.kind) {
    case "route_not_found":
      return `dex-aggregator: no route found for ${e.token_in} -> ${e.token_out} (${e.amount_desc}): ${e.hint}`;
    case "invalid_params":
      return `dex-aggregator: invalid params: ${e.message}`;
    case "http":
      return `dex-aggregator: request failed: ${e.message}`;
    case "parse":
      return `dex-aggregator: failed to parse response: ${e.message}`;
    case "base64_decode":
      return `dex-aggregator: base64 decode failed for ${e.context}: ${e.message}`;
    case "invalid_number":
      return `dex-aggregator: invalid number in route (${e.context}): ${e.value}`;
    case "near":
      return `dex-aggregator: near transaction failed: ${e.message}`;
  }
}
// =================================================
// copyright 2026 by sleet.near