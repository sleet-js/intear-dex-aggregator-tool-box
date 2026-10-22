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
// Swap execution has two failure kinds that are easy to confuse and
// worth keeping apart: `swap_failed` means the swap did not go
// through (detected by `GET /route/outcome`'s balance comparison,
// never by a transaction status), while `outcome_unavailable` means
// the check itself could not be completed and the swap may well have
// succeeded.
//
// The thrown runtime class (`DEX_AGGREGATOR_CLIENT_ERROR`) is defined
// in `client.ts` because it has to live where the runtime errors are
// constructed.
// =================================================
import type { EXECUTION_INSTRUCTION } from "./route_response_type";
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
/** `GET /route/outcome` could not answer — the transactions did not
 *  execute in the endpoint's 60s budget, the balances could not be
 *  read, or the request was malformed (a repeated or missing
 *  `tx_hash`, a `token_in` equal to `token_out`, ...).
 *
 *  This means the *check* failed, not that the swap failed. Re-read
 *  `hashes` and try again, or fall back to reading the receipts
 *  yourself. Distinct from `swap_failed` so callers do not report a
 *  swap that may well have succeeded as a failed one. */
export interface DEX_AGGREGATOR_OUTCOME_UNAVAILABLE_ERROR {
  kind: "outcome_unavailable";
  message: string;
  /** The hashes the check was asked about, so a retry can reuse
   *  them without reconstructing the call. */
  tx_hashes: string[];
}
/** The swap itself did not go through, as reported by
 *  `GET /route/outcome`.
 *
 *  The transaction carrying an `ft_transfer_call` swap still
 *  *succeeds* when the DEX refunds it, so this is invisible in a
 *  transaction status — only the endpoint's balance comparison sees
 *  it. `error` is the router's trader-facing message; `next_steps`
 *  are the recovery instructions it suggests (for example the
 *  `near_withdraw` that unwraps wNEAR stranded by a failed NEAR
 *  swap), and should be executed to return the trader to their
 *  starting balances. */
export interface DEX_AGGREGATOR_SWAP_FAILED_ERROR {
  kind: "swap_failed";
  /** The router's trader-facing explanation, e.g. "The price moved
   *  more than your slippage allows while the transaction was on its
   *  way." */
  message: string;
  /** Actual input spent (may be non-zero on a partial fill). */
  amount_in: string;
  /** Actual output received. `"0"` on a full refund. */
  amount_out: string;
  /** Recovery instructions, ready to execute through
   *  `EXECUTE_ROUTE_SEQUENTIAL`. */
  next_steps: EXECUTION_INSTRUCTION[];
  /** The hashes of the transactions that were checked. */
  tx_hashes: string[];
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
  | DEX_AGGREGATOR_NEAR_ERROR
  | DEX_AGGREGATOR_OUTCOME_UNAVAILABLE_ERROR
  | DEX_AGGREGATOR_SWAP_FAILED_ERROR;
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
    case "outcome_unavailable":
      return `dex-aggregator: could not check the outcome of ${e.tx_hashes.length} transaction(s): ${e.message} (the swap may still have succeeded)`;
    case "swap_failed":
      return `dex-aggregator: swap failed (spent ${e.amount_in}, received ${e.amount_out}): ${e.message}`;
    case "near":
      return `dex-aggregator: near transaction failed: ${e.message}`;
  }
}
// =================================================
// copyright 2026 by sleet.near