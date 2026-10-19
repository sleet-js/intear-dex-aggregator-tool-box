// =================================================
// intear-dex-aggregator-tool-box
// Typed client + near-kit execution helpers for the intear
// dex-aggregator (`GET https://router.intear.tech/route`).
//
// Quote with `DexAggregatorClient`, execute with `executeRoute`.
// Designed to plug straight into a `Near` from `near-kit` (or
// `near_kit_client` / `near_kit_env` from near-kit-tool-box-ts —
// all are the same `Near` instance).
//
// Quoting is read-only (no credentials). Executing needs a funded
// mainnet signer — the router is mainnet only.
// copyright 2026 by sleet.near
// =================================================
// client
export {
  DexAggregatorClient,
  DexAggregatorClientError,
  DEX_AGGREGATOR_BASE_URL,
  DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS,
  DEX_AGGREGATOR_KNOWN_DEXES,
} from "./lib/helper/dex_aggregator_client.ts";
// helpers (raw decoding)
export {
  decodeInstructionArgs,
  depositFromRoute,
  gasFromRoute,
} from "./lib/helper/dex_aggregator_decode.ts";
// formatters (used by the bin / your UI)
export {
  printRoutesTable,
  printRoutePreview,
  routeRow,
  shortToken,
} from "./lib/helper/dex_aggregator_format.ts";
// types
export type {
  DexAggregatorError,
  DexAggregatorRouteNotFoundError,
  DexAggregatorInvalidParamsError,
  DexAggregatorHttpError,
  DexAggregatorParseError,
  DexAggregatorBase64DecodeError,
  DexAggregatorInvalidNumberError,
  DexAggregatorNearError,
} from "./lib/types/dex_aggregator_error_type.ts";
export { formatDexAggregatorError } from "./lib/types/dex_aggregator_error_type.ts";
export type {
  QuoteParams,
  QuoteAmount,
  Slippage,
  TokenId,
} from "./lib/types/dex_aggregator_quote_params_type.ts";
export {
  amountIn,
  amountOut,
  withAutoSlippage,
  withDexes,
  withFixedSlippage,
  withMaxWaitMs,
  withReferrerId,
  withSigningPublicKey,
  withTraderAccountId,
  describeAmount,
  DEFAULT_SLIPPAGE,
} from "./lib/types/dex_aggregator_quote_params_type.ts";
export type {
  Route,
  RouteAmount,
  ExecutionInstruction,
  NearTransactionInstruction,
  NearTransactionAction,
  FunctionCallAction,
} from "./lib/types/dex_aggregator_route_response_type.ts";
export {
  bestAmount,
  amountMode,
  txCount,
  actionCount,
  isDirectlyExecutable,
  shouldContinueOnFailure,
  hasFeeLegs,
} from "./lib/types/dex_aggregator_route_response_type.ts";
// functions
export { executeRoute } from "./fun/dex_aggregator/dex_aggregator_execute_route_fun.ts";
export {
  getRoutes,
  getBestRoute,
} from "./fun/dex_aggregator/dex_aggregator_get_routes_fun_json.ts";
// =================================================
