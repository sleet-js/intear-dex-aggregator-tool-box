// =================================================
// route_response_type
// One quoted swap route and its execution instructions, exactly
// as the intear dex-aggregator returns them in `GET /route`.
//
// Wire source of truth (matches upstream):
//   https://github.com/INTEARnear/dex-aggregator (swap-router/src/types.rs)
//
// The router serves `Vec<Quote>`; `Quote` extends `Route` with cost
// estimates (gas + storage deposits). `Route` itself has no
// `has_slippage` field in today's wire format — older responses did
// (the rust tool-box was written against them). We accept either
// shape by defaulting to `true` (AMM-style), which mirrors what
// callers used to do.
// =================================================
// Decode any JSON value into a `bigint` (number-or-string on the wire).
// Used for `gas` (raw gas units) and other u64 / yoctoNEAR fields.
function value_to_bigint(value: unknown): bigint {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`invalid bigint number: ${value}`);
    }
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    try {
      return BigInt(value);
    } catch {
      throw new Error(`invalid bigint string: ${value}`);
    }
  }
  throw new Error(`expected bigint, got: ${JSON.stringify(value)}`);
}
// =================================================
// Estimate / worst-case amount of one side of a quoted route.
//
// The router fills exactly one field depending on the quote mode:
// `amount_out` for `amount_in` requests (most common), `amount_in`
// for `amount_out` requests. Both are decimal strings in the
// token's smallest unit.
export interface ROUTE_AMOUNT {
  /** Quoted output amount (present for `amount_in` requests). */
  amount_out?: string;
  /** Required input amount (present for `amount_out` requests). */
  amount_in?: string;
}
// =================================================
/** A `FunctionCall` action inside a `NearTransaction` instruction. */
export interface FUNCTION_CALL_ACTION {
  /** Contract method to call (e.g. `ft_transfer_call`). */
  method_name: string;
  /** Base64-encoded call args. */
  args: string;
  /** Gas units (number or string on the wire). */
  gas: number | string;
  /** Attached deposit in yoctoNEAR (string or number on the wire). */
  deposit: string | number;
}
/** One action inside a `NearTransaction` instruction. The router
 *  only ever emits `FunctionCall` today; the union keeps us forward
 *  compatible if transfer / deposit variants appear later. */
export type NEAR_TRANSACTION_ACTION = { FunctionCall: FUNCTION_CALL_ACTION };
// =================================================
/** A NEAR transaction execution instruction: send one standard NEAR
 *  transaction with these actions, in order. */
export interface NEAR_TRANSACTION_INSTRUCTION {
  /** Contract receiving the transaction. */
  receiver_id: string;
  /** Actions to include in the single transaction, in order. */
  actions: NEAR_TRANSACTION_ACTION[];
  /** True for referral-fee legs — the router calls these `is_fee_transaction`.
   *  After a route's swap transactions land, call `POST /route/outcome`
   *  with their hashes + `fee_amount` to find out whether the fee
   *  transactions should be sent. The rust tool-box named this flag
   *  `continue_if_failed`; we accept either name on deserialize. */
  continue_if_failed?: boolean;
  is_fee_transaction?: boolean;
}
// =================================================
/** One step of a quoted route. Process instructions sequentially. */
export type EXECUTION_INSTRUCTION = {
  NearTransaction: NEAR_TRANSACTION_INSTRUCTION;
};
// =================================================
/** One quoted swap route: one element of the array returned by
 *  `GET /route`. When no DEX can serve a pair the router answers
 *  `200` with an empty array (`[]`) — maps to `RouteNotFound` in
 *  `GET_BEST_ROUTE`.
 *
 *  Field names reflect the current upstream schema (dex-aggregator
 *  `swap-router/src/types.rs`). The legacy `has_slippage` and
 *  `deadline` fields are absent in newer responses, so we make them
 *  optional and let callers infer "AMM" by absence of `fee_amount`. */
export interface ROUTE {
  /** Route expiry (often absent on the wire; deprecated upstream). */
  deadline?: number | string | null;
  /** Legacy field: was `true` for AMM quotes (slippage applies),
   *  `false` for guaranteed request-for-quote legs. Newer responses
   *  omit it; we treat absence as "unknown / AMM" so call sites that
   *  depended on the field still see a sensible default. */
  has_slippage?: boolean;
  /** Expected swap amount. */
  estimated_amount: ROUTE_AMOUNT;
  /** Minimum guaranteed amount after slippage. */
  worst_case_amount: ROUTE_AMOUNT;
  /** Which DEX serves this route. Router emits one of:
   *  "Rhea", "Aidols", "Wrap", "RheaDcl", "MetaPool", "Linear",
   *  "XRhea", "RNear", "Plach" (the un-served entries are kept for
   *  backwards-compatible parsing). */
  dex_id: string;
  /** Instructions to execute in order. */
  execution_instructions: EXECUTION_INSTRUCTION[];
  /** Output token of this route. May differ from the requested
   *  `token_out` when the exact output location is not known yet —
   *  request a second `Wrap`-only quote from here to the desired
   *  token in that case. */
  token_output: string;
  /** Whether the output still needs unwrapping. Upstream has renamed
   *  this to `deprecated_needs_unwrap_always_false`; the literal name
   *  on the wire is still `needs_unwrap`. Absent in newer responses. */
  needs_unwrap?: boolean;
  /** Server-side cost estimates (router `Quote` shape). Surfaced so
   *  frontends can show "this will cost ~X NEAR in gas + storage". */
  estimated_max_gas_cost?: string;
  estimated_gas_usage?: string;
  storage_deposits?: string;
  max_storage_deposits?: string;
  /** What the fee transactions pay out of the wallet balance (wNEAR
   *  for NEAR), to pass to `POST /route/outcome`. */
  fee_amount?: string;
  /** Quote discount (referral fee savings) signed into this route. */
  discount?: ROUTE_AMOUNT;
}
// =================================================
/** True when an instruction is a referral-fee leg (router name) or
 *  carries the older "continue on failure" flag. The rs tool-box
 *  used `continue_if_failed`, the router emits `is_fee_transaction`;
 *  both indicate the same thing. */
export function SHOULD_CONTINUE_ON_FAILURE(
  tx: NEAR_TRANSACTION_INSTRUCTION,
): boolean {
  return tx.continue_if_failed === true || tx.is_fee_transaction === true;
}
/** True when this route has any fee (referral-payout) legs that
 *  need to be sent only after `POST /route/outcome` reports
 *  `charge_fee: true`. */
export function HAS_FEE_LEGS(route: ROUTE): boolean {
  return route.execution_instructions.some(
    (i) =>
      "NearTransaction" in i &&
      (i.NearTransaction.is_fee_transaction === true ||
        i.NearTransaction.continue_if_failed === true),
  );
}
// =================================================
// Lightweight runtime coercion for fields the bin uses.
// Keep this cheap and sync — Zod would be heavier than we need here.
function value_to_number_or_null(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const big = value_to_bigint(value);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (big > max) {
    throw new Error(
      `numeric value ${big.toString()} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  return Number(big);
}
// =================================================
/** Coerce one decoded `ROUTE` from the raw router JSON shape into
 *  the typed `ROUTE` interface. Strict on critical fields (`dex_id`,
 *  `token_output`, execution instructions) and lenient on optionals. */
export function COERCE_ROUTE(raw: Record<string, unknown>): ROUTE {
  if (!raw || typeof raw !== "object") {
    throw new Error("route: expected an object");
  }
  const instructions_raw = raw["execution_instructions"];
  if (!Array.isArray(instructions_raw)) {
    throw new Error("route.execution_instructions: expected an array");
  }
  const instructions: EXECUTION_INSTRUCTION[] = instructions_raw.map(
    (entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `route.execution_instructions[${i}]: expected an object`,
        );
      }
      const tx_entry = (entry as Record<string, unknown>)["NearTransaction"];
      if (!tx_entry || typeof tx_entry !== "object") {
        throw new Error(
          `route.execution_instructions[${i}]: only NearTransaction is supported today`,
        );
      }
      const tx = tx_entry as Record<string, unknown>;
      const actions_raw = tx["actions"];
      if (!Array.isArray(actions_raw)) {
        throw new Error(
          `route.execution_instructions[${i}].actions: expected an array`,
        );
      }
      const actions: NEAR_TRANSACTION_ACTION[] = actions_raw.map(
        (act, j) => {
          if (!act || typeof act !== "object") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}]: expected an object`,
            );
          }
          const fc_entry = (act as Record<string, unknown>)["FunctionCall"];
          if (!fc_entry || typeof fc_entry !== "object") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}]: only FunctionCall is supported today`,
            );
          }
          const fc = fc_entry as Record<string, unknown>;
          if (typeof fc["method_name"] !== "string") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}].method_name: expected a string`,
            );
          }
          if (typeof fc["args"] !== "string") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}].args: expected a base64 string`,
            );
          }
          return {
            FunctionCall: {
              method_name: fc["method_name"] as string,
              args: fc["args"] as string,
              gas: fc["gas"] as number | string,
              deposit: (fc["deposit"] ?? "0") as string | number,
            },
          };
        },
      );
      const continue_if_failed =
        (typeof tx["continue_if_failed"] === "boolean" &&
          (tx["continue_if_failed"] as boolean)) ||
        (typeof tx["is_fee_transaction"] === "boolean" &&
          (tx["is_fee_transaction"] as boolean)) ||
        false;
      if (typeof tx["receiver_id"] !== "string") {
        throw new Error(
          `route.execution_instructions[${i}].receiver_id: expected a string`,
        );
      }
      return {
        NearTransaction: {
          receiver_id: tx["receiver_id"] as string,
          actions,
          continue_if_failed: continue_if_failed,
          is_fee_transaction: continue_if_failed,
        },
      };
    },
  );
  if (typeof raw["dex_id"] !== "string") {
    throw new Error("route.dex_id: expected a string");
  }
  if (typeof raw["token_output"] !== "string") {
    throw new Error("route.token_output: expected a string");
  }
  return {
    deadline: value_to_number_or_null(raw["deadline"]),
    has_slippage: typeof raw["has_slippage"] === "boolean"
      ? (raw["has_slippage"] as boolean)
      : undefined,
    estimated_amount: (raw["estimated_amount"] ?? {}) as ROUTE_AMOUNT,
    worst_case_amount: (raw["worst_case_amount"] ?? {}) as ROUTE_AMOUNT,
    dex_id: raw["dex_id"] as string,
    execution_instructions: instructions,
    token_output: raw["token_output"] as string,
    needs_unwrap: typeof raw["needs_unwrap"] === "boolean"
      ? (raw["needs_unwrap"] as boolean)
      : undefined,
    estimated_max_gas_cost:
      typeof raw["estimated_max_gas_cost"] === "string"
        ? (raw["estimated_max_gas_cost"] as string)
        : undefined,
    estimated_gas_usage:
      typeof raw["estimated_gas_usage"] === "string"
        ? (raw["estimated_gas_usage"] as string)
        : undefined,
    storage_deposits:
      typeof raw["storage_deposits"] === "string"
        ? (raw["storage_deposits"] as string)
        : undefined,
    max_storage_deposits:
      typeof raw["max_storage_deposits"] === "string"
        ? (raw["max_storage_deposits"] as string)
        : undefined,
    fee_amount:
      typeof raw["fee_amount"] === "string"
        ? (raw["fee_amount"] as string)
        : undefined,
    discount: raw["discount"] as ROUTE_AMOUNT | undefined,
  };
}
// =================================================
// pure helpers (mirror Rust tool-box methods on the type)
export function TX_COUNT(route: ROUTE): number {
  return route.execution_instructions.length;
}
export function ACTION_COUNT(route: ROUTE): number {
  return route.execution_instructions.reduce(
    (n, i) =>
      n + ("NearTransaction" in i ? i.NearTransaction.actions.length : 0),
    0,
  );
}
export function IS_DIRECTLY_EXECUTABLE(route: ROUTE): boolean {
  return route.execution_instructions.every((i) => "NearTransaction" in i);
}
export function BEST_AMOUNT(amount: ROUTE_AMOUNT): string | undefined {
  return amount.amount_out ?? amount.amount_in;
}
export function AMOUNT_MODE(amount: ROUTE_AMOUNT): "out" | "in" {
  return amount.amount_out !== undefined ? "out" : "in";
}
// =================================================
// copyright 2026 by sleet.near