// =================================================
// dex_aggregator_route_response_type
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
function valueToBigInt(value: unknown): bigint {
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
export interface RouteAmount {
  /** Quoted output amount (present for `amount_in` requests). */
  amount_out?: string;
  /** Required input amount (present for `amount_out` requests). */
  amount_in?: string;
}
// =================================================
/** A `FunctionCall` action inside a `NearTransaction` instruction. */
export interface FunctionCallAction {
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
export type NearTransactionAction = { FunctionCall: FunctionCallAction };
// =================================================
/** A NEAR transaction execution instruction: send one standard NEAR
 *  transaction with these actions, in order. */
export interface NearTransactionInstruction {
  /** Contract receiving the transaction. */
  receiver_id: string;
  /** Actions to include in the single transaction, in order. */
  actions: NearTransactionAction[];
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
export type ExecutionInstruction = { NearTransaction: NearTransactionInstruction };
// =================================================
/** One quoted swap route: one element of the array returned by
 *  `GET /route`. When no DEX can serve a pair the router answers
 *  `200` with an empty array (`[]`) — maps to `RouteNotFound` in
 *  `getBestRoute`.
 *
 *  Field names reflect the current upstream schema (dex-aggregator
 *  `swap-router/src/types.rs`). The legacy `has_slippage` and
 *  `deadline` fields are absent in newer responses, so we make them
 *  optional and let callers infer "AMM" by absence of `fee_amount`. */
export interface Route {
  /** Route expiry (often absent on the wire; deprecated upstream). */
  deadline?: number | string | null;
  /** Legacy field: was `true` for AMM quotes (slippage applies),
   *  `false` for guaranteed request-for-quote legs. Newer responses
   *  omit it; we treat absence as "unknown / AMM" so call sites that
   *  depended on the field still see a sensible default. */
  has_slippage?: boolean;
  /** Expected swap amount. */
  estimated_amount: RouteAmount;
  /** Minimum guaranteed amount after slippage. */
  worst_case_amount: RouteAmount;
  /** Which DEX serves this route. Router emits one of:
   *  "Rhea", "Aidols", "Wrap", "RheaDcl", "MetaPool", "Linear",
   *  "XRhea", "RNear", "Plach" (the un-served entries are kept for
   *  backwards-compatible parsing). */
  dex_id: string;
  /** Instructions to execute in order. */
  execution_instructions: ExecutionInstruction[];
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
  discount?: RouteAmount;
}
// =================================================
/** Internal helpers used by the rs tool-box's typed `ROUTE_TYPE`.
 *  Mirror the rs tool-box's `tx_count()`, `action_count()` and
 *  `is_directly_executable()` so the bin's table matches. */
export interface RouteDerived {
  txCount(): number;
  actionCount(): number;
  isDirectlyExecutable(): boolean;
}
// =================================================
/** True when an instruction is a referral-fee leg (router name) or
 *  carries the older "continue on failure" flag. The rs tool-box
 *  used `continue_if_failed`, the router emits `is_fee_transaction`;
 *  both indicate the same thing. */
export function shouldContinueOnFailure(
  tx: NearTransactionInstruction,
): boolean {
  return tx.continue_if_failed === true || tx.is_fee_transaction === true;
}
// =================================================
/** True when this route has any fee (referral-payout) legs that
 *  need to be sent only after `POST /route/outcome` reports
 *  `charge_fee: true`. */
export function hasFeeLegs(route: Route): boolean {
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
function valueToNumberOrNull(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  const big = valueToBigInt(value);
  const max = BigInt(Number.MAX_SAFE_INTEGER);
  if (big > max) {
    throw new Error(
      `numeric value ${big.toString()} exceeds Number.MAX_SAFE_INTEGER`,
    );
  }
  return Number(big);
}
// =================================================
/** Coerce one decoded `Route` from the raw router JSON shape into
 *  the typed `Route` interface. Strict on critical fields (`dex_id`,
 *  `token_output`, execution instructions) and lenient on optionals. */
export function coerceRoute(raw: Record<string, unknown>): Route {
  if (!raw || typeof raw !== "object") {
    throw new Error("route: expected an object");
  }
  const instructionsRaw = raw["execution_instructions"];
  if (!Array.isArray(instructionsRaw)) {
    throw new Error("route.execution_instructions: expected an array");
  }
  const instructions: ExecutionInstruction[] = instructionsRaw.map(
    (entry, i) => {
      if (!entry || typeof entry !== "object") {
        throw new Error(
          `route.execution_instructions[${i}]: expected an object`,
        );
      }
      const txEntry = (entry as Record<string, unknown>)["NearTransaction"];
      if (!txEntry || typeof txEntry !== "object") {
        throw new Error(
          `route.execution_instructions[${i}]: only NearTransaction is supported today`,
        );
      }
      const tx = txEntry as Record<string, unknown>;
      const actionsRaw = tx["actions"];
      if (!Array.isArray(actionsRaw)) {
        throw new Error(
          `route.execution_instructions[${i}].actions: expected an array`,
        );
      }
      const actions: NearTransactionAction[] = actionsRaw.map(
        (act, j) => {
          if (!act || typeof act !== "object") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}]: expected an object`,
            );
          }
          const fcEntry = (act as Record<string, unknown>)["FunctionCall"];
          if (!fcEntry || typeof fcEntry !== "object") {
            throw new Error(
              `route.execution_instructions[${i}].actions[${j}]: only FunctionCall is supported today`,
            );
          }
          const fc = fcEntry as Record<string, unknown>;
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
      const continueIfFailed =
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
          continue_if_failed: continueIfFailed,
          is_fee_transaction: continueIfFailed,
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
    deadline: valueToNumberOrNull(raw["deadline"]),
    has_slippage: typeof raw["has_slippage"] === "boolean"
      ? (raw["has_slippage"] as boolean)
      : undefined,
    estimated_amount: (raw["estimated_amount"] ?? {}) as RouteAmount,
    worst_case_amount: (raw["worst_case_amount"] ?? {}) as RouteAmount,
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
    discount: raw["discount"] as RouteAmount | undefined,
  };
}
// =================================================
// pure helpers (mirror Rust tool-box methods on the type)
export function txCount(route: Route): number {
  return route.execution_instructions.length;
}
export function actionCount(route: Route): number {
  return route.execution_instructions.reduce(
    (n, i) =>
      n + ("NearTransaction" in i ? i.NearTransaction.actions.length : 0),
    0,
  );
}
export function isDirectlyExecutable(route: Route): boolean {
  return route.execution_instructions.every((i) => "NearTransaction" in i);
}
export function bestAmount(amount: RouteAmount): string | undefined {
  return amount.amount_out ?? amount.amount_in;
}
export function amountMode(amount: RouteAmount): "out" | "in" {
  return amount.amount_out !== undefined ? "out" : "in";
}
// =================================================
// copyright 2026 by sleet.near
