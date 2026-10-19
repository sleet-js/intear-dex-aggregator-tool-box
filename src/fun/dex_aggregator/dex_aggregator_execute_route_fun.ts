// =================================================
// dex_aggregator_execute_route_fun
// Execute one quoted `Route` with your near-kit `Near` client (from
// near-kit directly, `near_kit_client` in near-kit-tool-box-ts/web,
// or `near_kit_env` in near-kit-tool-box-ts/env — all are the same
// `Near` type).
//
// Each `NearTransaction` instruction becomes one multi-action NEAR
// transaction: every `FunctionCall` action is rebuilt with its
// base64-decoded args plus the router's exact `gas` and `deposit`,
// then sent sequentially in instruction order. One near-kit outcome
// is returned per sent transaction.
//
// An instruction flagged `continue_if_failed` (or its router alias
// `is_fee_transaction`) is skipped (with an stderr note) when its
// transaction fails; otherwise the first failure aborts and is
// rethrown as a `DexAggregatorClientError` of kind `"near"`.
//
// Requires a funded mainnet signer on `near` (the router is mainnet
// only; refresh quotes a couple of seconds before executing since
// routes carry short deadlines).
// =================================================
import type { Near } from "near-kit";
import type { FinalExecutionOutcome } from "near-kit";
import {
  type FunctionCallAction,
  type NearTransactionInstruction,
  type Route,
  shouldContinueOnFailure,
} from "../../lib/types/dex_aggregator_route_response_type.ts";
import {
  DexAggregatorClientError,
} from "../../lib/helper/dex_aggregator_client.ts";
import type { DexAggregatorError } from "../../lib/types/dex_aggregator_error_type.ts";
import {
  decodeInstructionArgsAsJson,
  depositFromRoute,
  gasFromRoute,
} from "../../lib/helper/dex_aggregator_decode.ts";
// =================================================
/** Execute one quoted route with your near-kit `Near` client.
 *
 *  Each `NearTransaction` instruction is sent as a separate NEAR
 *  transaction (sequential; the wallet or signer may batch them on
 *  its end, but we walk them one at a time so failure semantics
 *  stay aligned with the route's `continue_if_failed` /
 *  `is_fee_transaction` flags).
 *
 *  Returns one outcome per instruction that actually went out (fee
 *  transactions that failed and were skipped are not in the result).
 *
 *  Throws a `DexAggregatorClientError` of kind `"near"` when a
 *  non-tolerated transaction fails. */
export async function executeRoute(
  near: Near,
  route: Route,
  options: { signerId?: string; verbose?: boolean } = {},
): Promise<FinalExecutionOutcome[]> {
  const signerId = options.signerId ?? resolveDefaultSignerId(near);
  if (!signerId) {
    throw new DexAggregatorClientError({
      kind: "invalid_params",
      message:
        "executeRoute: no signerId available — pass one explicitly or build Near with defaultSignerId",
    });
  }
  const outcomes: FinalExecutionOutcome[] = [];
  for (let i = 0; i < route.execution_instructions.length; i++) {
    const instruction = route.execution_instructions[i];
    if (!instruction) continue;
    if (!("NearTransaction" in instruction)) {
      throw new DexAggregatorClientError({
        kind: "near",
        message:
          "route contains a non-NearTransaction instruction (forward-compat; this toolbox only executes NearTransaction today)",
      });
    }
    const tx: NearTransactionInstruction = instruction.NearTransaction;
    try {
      const outcome = await sendOneTx(near, signerId, tx, options.verbose);
      outcomes.push(outcome);
    } catch (cause) {
      if (shouldContinueOnFailure(tx)) {
        if (options.verbose !== false) {
          console.warn(
            `[dex-aggregator] note: tx to ${tx.receiver_id} failed but continue_if_failed is set, skipping: ${(cause as Error).message ?? cause}`,
          );
        }
        continue;
      }
      throw wrapNearError(cause);
    }
  }
  return outcomes;
}
// =================================================
async function sendOneTx(
  near: Near,
  signerId: string,
  tx: NearTransactionInstruction,
  verbose: boolean | undefined,
): Promise<FinalExecutionOutcome> {
  let builder = near.transaction(signerId);
  for (let i = 0; i < tx.actions.length; i++) {
    const action = tx.actions[i]!;
    if (!("FunctionCall" in action)) {
      throw new DexAggregatorClientError({
        kind: "near",
        message: `action ${i} is not a FunctionCall — only FunctionCall actions are supported`,
      });
    }
    const fc: FunctionCallAction = action.FunctionCall;
    const context = `${tx.receiver_id}.${fc.method_name}`;
    // Decode the base64 args into a parsed JSON object (falling back
    // to a string or Uint8Array for legacy raw-binary payloads).
    // Returning an object — not a Uint8Array — avoids a wallet-side
    // serialization trap where JSON.stringify(Uint8Array) yields an
    // opaque `{ "0": 123, "1": 34, ... }` object that the contract
    // cannot parse.
    const args = decodeInstructionArgsAsJson(fc.args, context);
    // Force a clear diagnosis so we can tell the exact type — even
    // when the helper is the shipped ts version and the bundle was
    // rebuilt. ObjectIsUint8Array check is what matters here.
    console.log(`[dex-aggregator.exec] ${context}`,
      "raw_b64.length:", fc.args.length,
      "args is Uint8Array?", args instanceof Uint8Array,
      "args typeof:", typeof args,
      "args.kind:", args instanceof Uint8Array ? "Uint8Array" : (typeof args === "object" && !Array.isArray(args) ? "Object" : typeof args),
      "value:", args instanceof Uint8Array ? `<bytes ${args.length}>` : args,
    );
    // Log what we are about to sign so the user can compare against
    // the args shown in their wallet popup — useful when debugging
    // wallet-side re-serialization issues.
    if (verbose) {
      console.log(
        `[dex-aggregator] → ${tx.receiver_id}.${fc.method_name}`,
        "args:", args,
      );
    }
    const gas = gasFromRoute(fc.gas);
    const deposit = depositFromRoute(fc.deposit);
    // near-kit's `GasInput` is a template literal type that only
    // accepts `"<num> Tgas"` / `"<num>"` strings. Our gasFromRoute
    // always returns a digits-only string that is a valid input at
    // runtime, so we cast to `any` just past the strict template
    // literal check (avoiding pulling in the internal subpath).
    const gasInput: any = gas;
    // near-kit's `functionCall(contractId, methodName, args, options)`
    // accepts `object | Uint8Array`. We always hand it a JSON-parsed
    // object so the wallet re-serializes the same shape the contract
    // expects; the Uint8Array fallback path is reserved for legacy
    // raw-binary payloads.
    builder = builder.functionCall(
      tx.receiver_id,
      fc.method_name,
      args as object | Uint8Array,
      {
        gas: gasInput,
        attachedDeposit: deposit,
      },
    );
  }
  if (verbose) {
    console.log(
      `[dex-aggregator] sending ${tx.actions.length} action(s) to ${tx.receiver_id} as ${signerId}`,
    );
  }
  return (await builder.send()) as FinalExecutionOutcome;
}
// =================================================
function wrapNearError(cause: unknown): DexAggregatorClientError {
  const message =
    cause instanceof Error
      ? cause.message
      : (typeof cause === "string" ? cause : JSON.stringify(cause));
  const wrapped: DexAggregatorError = {
    kind: "near",
    message,
  };
  return new DexAggregatorClientError(wrapped);
}
// =================================================
function resolveDefaultSignerId(near: Near): string | undefined {
  const candidate = (near as unknown as { defaultSignerId?: string })
    .defaultSignerId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return undefined;
}
// =================================================
// copyright 2026 by sleet.near
