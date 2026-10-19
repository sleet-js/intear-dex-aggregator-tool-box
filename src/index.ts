// =================================================
// intear-dex-aggregator-tool-box
// Typed client + near-kit execution helpers for the intear
// dex-aggregator (`GET https://router.intear.tech/route`).
//
// Quote with `DEX_AGGREGATOR_CLIENT`, execute with
// `EXECUTE_ROUTE_SEQUENTIAL` (backend / near-kit `Near`) or
// `EXECUTE_ROUTE_BATCHED` (browser / `@hot-labs/near-connect` wallet).
//
// Quoting is read-only (no credentials). Executing needs a funded
// mainnet signer — the router is mainnet only.
// copyright 2026 by sleet.near
// =================================================
// client
export {
  DEX_AGGREGATOR_CLIENT,
  DEX_AGGREGATOR_CLIENT_ERROR,
  DEX_AGGREGATOR_BASE_URL,
  DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS,
  DEX_AGGREGATOR_KNOWN_DEXES,
} from "./lib/client";
// helpers (raw decoding)
export {
  DECODE_INSTRUCTION_ARGS,
  DECODE_INSTRUCTION_ARGS_AS_JSON,
  DEPOSIT_FROM_ROUTE,
  GAS_FROM_ROUTE,
} from "./lib/decode";
// formatters (used by the bin / your UI)
export {
  PRINT_ROUTES_TABLE,
  PRINT_ROUTE_PREVIEW,
  ROUTE_ROW,
  SHORT_TOKEN,
} from "./lib/format";
// types
export type {
  DEX_AGGREGATOR_ERROR,
  DEX_AGGREGATOR_ROUTE_NOT_FOUND_ERROR,
  DEX_AGGREGATOR_INVALID_PARAMS_ERROR,
  DEX_AGGREGATOR_HTTP_ERROR,
  DEX_AGGREGATOR_PARSE_ERROR,
  DEX_AGGREGATOR_BASE64_DECODE_ERROR,
  DEX_AGGREGATOR_INVALID_NUMBER_ERROR,
  DEX_AGGREGATOR_NEAR_ERROR,
} from "./lib/error_type";
export { FORMAT_DEX_AGGREGATOR_ERROR } from "./lib/error_type";
export type {
  QUOTE_PARAMS,
  QUOTE_AMOUNT,
  SLIPPAGE,
  TOKEN_ID,
} from "./lib/quote_params_type";
export {
  AMOUNT_IN,
  AMOUNT_OUT,
  WITH_AUTO_SLIPPAGE,
  WITH_DEXES,
  WITH_FIXED_SLIPPAGE,
  WITH_MAX_WAIT_MS,
  WITH_REFERRER_ID,
  WITH_SIGNING_PUBLIC_KEY,
  WITH_TRADER_ACCOUNT_ID,
  DESCRIBE_AMOUNT,
  DEFAULT_SLIPPAGE,
} from "./lib/quote_params_type";
export type {
  ROUTE,
  ROUTE_AMOUNT,
  EXECUTION_INSTRUCTION,
  NEAR_TRANSACTION_INSTRUCTION,
  NEAR_TRANSACTION_ACTION,
  FUNCTION_CALL_ACTION,
} from "./lib/route_response_type";
export {
  BEST_AMOUNT,
  AMOUNT_MODE,
  TX_COUNT,
  ACTION_COUNT,
  IS_DIRECTLY_EXECUTABLE,
  SHOULD_CONTINUE_ON_FAILURE,
  HAS_FEE_LEGS,
} from "./lib/route_response_type";
// functions
export {
  EXECUTE_ROUTE_SEQUENTIAL,
  EXECUTE_ROUTE_BATCHED,
  type BATCH_WALLET,
  type ACTION_LIKE,
  type EXECUTE_ROUTE_OPTIONS,
} from "./fun/execute_route";
export {
  GET_ROUTES,
  GET_BEST_ROUTE,
} from "./fun/get_routes";
// =================================================