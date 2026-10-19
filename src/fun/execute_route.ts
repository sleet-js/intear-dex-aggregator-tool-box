// =================================================
// execute_route
// Execute one quoted `ROUTE`. Two named entry points, one shared
// action-building pipeline:
//
//   • EXECUTE_ROUTE_SEQUENTIAL(near, route, opts)
//       backend / CLI path. One `near.transaction(signer).functionCall(...).send()`
//       per instruction, sequentially. Uses near-kit's `Near` (private-
//       key signer).
//
//   • EXECUTE_ROUTE_BATCHED(wallet, route, opts)
//       browser path. Hands the wallet an array of prebuilt transactions
//       and lets it batch them into ONE popup via
//       `wallet.signAndSendTransactions({ transactions: [...] })`.
//       Each NEAR transaction is single-receiver; the wallet signs and
//       broadcasts each in nonce order.
//
// Both paths share `prepare_entries` + `build_actions_for_tx` so the
// decoded args, gas, and deposit are computed once.
//
// Per-instruction `continue_if_failed` (or its router alias
// `is_fee_transaction`) is honored in both paths: failed legs with
// the flag are skipped with a stderr note; anything else aborts.
// =================================================
import type { Near } from "near-kit";
import type {
  FinalExecutionOutcome,
} from "near-kit";
import {
  type FUNCTION_CALL_ACTION,
  type NEAR_TRANSACTION_INSTRUCTION,
  type ROUTE,
  SHOULD_CONTINUE_ON_FAILURE,
} from "../lib/route_response_type";
import {
  DEX_AGGREGATOR_CLIENT_ERROR,
} from "../lib/client";
import type { DEX_AGGREGATOR_ERROR } from "../lib/error_type";
import {
  DECODE_INSTRUCTION_ARGS_AS_JSON,
  DEPOSIT_FROM_ROUTE,
  GAS_FROM_ROUTE,
} from "../lib/decode";
// =================================================
/** Minimal wallet contract for the batched browser path. Matches the
 *  `signAndSendTransactions` method on `@hot-labs/near-connect`'s
 *  `NearWalletBase` — every concrete wallet (SandboxedWallet,
 *  ParentFrameWallet, InjectedWallet) implements it. We don't take a
 *  dependency on `@hot-labs/near-connect` here so the lib stays
 *  wallet-framework-agnostic; the consumer casts. */
export interface BATCH_WALLET {
  signAndSendTransactions(params: {
    signerId?: string;
    transactions: Array<{ receiverId: string; actions: ACTION_LIKE[] }>;
  }): Promise<FinalExecutionOutcome[]>;
}

/** Minimal `Action` shape we hand to either near-kit or the wallet
 *  adapter — anything `nearActionsToConnectorActions` accepts (and
 *  near-kit's TransactionBuilder.functionCall produces).
 *
 *  `gas` must be a string (digits-only — match's near-kit's `GasInput`
 *  via the `${number}` template branch). `deposit` accepts string
 *  or bigint (near-kit's `AmountInput` is a union of both). */
export type ACTION_LIKE = {
  functionCall: {
    methodName: string;
    args: unknown;
    gas: string;
    deposit: string | bigint;
  };
};
// =================================================
/** Options shared by both paths. `verbose` is opt-in (defaults to
 *  false) — the library is silent unless the caller asks for a
 *  trace of what it's sending. */
export interface EXECUTE_ROUTE_OPTIONS {
  signer_id?: string;
  verbose?: boolean;
}
// =================================================
/** Sequential execution: one NEAR transaction per route instruction,
 *  sent in order via `near-kit`. Use this when there is no wallet
 *  attached (private-key signer, scripts, tests). */
export async function EXECUTE_ROUTE_SEQUENTIAL(
  near: Near,
  route: ROUTE,
  options: EXECUTE_ROUTE_OPTIONS = {},
): Promise<FinalExecutionOutcome[]> {
  const signer_id = options.signer_id ?? resolve_default_signer_id(near);
  if (!signer_id) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message:
        "EXECUTE_ROUTE_SEQUENTIAL: no signer_id available — pass one explicitly or build Near with defaultSignerId",
    });
  }
  const entries = prepare_entries(route, options.verbose === true);
  if (entries.length === 0) return [];
  return send_one_at_a_time(near, entries, signer_id, options.verbose === true);
}
// =================================================
/** Batched execution: hand the wallet the whole route's transactions
 *  in one popup. The wallet must implement `signAndSendTransactions`
 *  (plural); a missing method throws a typed `DEX_AGGREGATOR_CLIENT_ERROR`
 *  so callers can prompt the user to reconnect a NEAR Connect session
 *  that supports batching.
 *
 *  @example
 *  ```ts
 *  import { EXECUTE_ROUTE_BATCHED } from "intear-dex-aggregator-tool-box";
 *  import { near_connect_client } from "@near-kit-tool-box/web";
 *
 *  const wallet = await near_connect_client().wallet();
 *  const outcomes = await EXECUTE_ROUTE_BATCHED(wallet, route);
 *  ``` */
export async function EXECUTE_ROUTE_BATCHED(
  wallet: BATCH_WALLET | unknown,
  route: ROUTE,
  options: EXECUTE_ROUTE_OPTIONS = {},
): Promise<FinalExecutionOutcome[]> {
  const signer_id = options.signer_id ??
    (typeof wallet === "object" && wallet !== null &&
      "accounts" in wallet && Array.isArray(
        (wallet as { accounts?: unknown }).accounts,
      )
      ? (((wallet as { accounts: Array<{ accountId: string }> })
        .accounts[0]?.accountId) || undefined)
      : undefined);
  if (!signer_id) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message:
        "EXECUTE_ROUTE_BATCHED: no signer_id available — pass `signer_id` explicitly",
    });
  }
  assert_supports_batching(wallet);
  const entries = prepare_entries(route, options.verbose === true);
  if (entries.length === 0) return [];
  return send_batched(
    wallet as BATCH_WALLET,
    entries,
    signer_id,
    options.verbose === true,
  );
}
// =================================================
/** Throw a clear typed error when the connected wallet does not
 *  expose `signAndSendTransactions` (plural). The feature check lives
 *  here so consumers don't have to know about near-kit's wallet
 *  adapter surface. */
function assert_supports_batching(
  wallet: unknown,
): asserts wallet is BATCH_WALLET {
  if (
    !wallet ||
    typeof wallet !== "object" ||
    typeof (wallet as { signAndSendTransactions?: unknown })
      .signAndSendTransactions !== "function"
  ) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message:
        "EXECUTE_ROUTE_BATCHED: wallet does not expose signAndSendTransactions — reconnect a NEAR Connect / Intear Wallet session that supports transaction batching.",
    });
  }
}
// =================================================
/** Build the (instruction_index, NEAR_TRANSACTION_INSTRUCTION, ACTION_LIKE[])
 *  tuples both paths share. */
function prepare_entries(
  route: ROUTE,
  verbose: boolean,
): Array<{
  instruction_index: number;
  tx: NEAR_TRANSACTION_INSTRUCTION;
  actions: ACTION_LIKE[];
}> {
  const entries: Array<{
    instruction_index: number;
    tx: NEAR_TRANSACTION_INSTRUCTION;
    actions: ACTION_LIKE[];
  }> = [];
  for (let i = 0; i < route.execution_instructions.length; i++) {
    const instruction = route.execution_instructions[i];
    if (!instruction) continue;
    if (!("NearTransaction" in instruction)) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "near",
        message:
          "route contains a non-NearTransaction instruction (forward-compat; this toolbox only executes NearTransaction today)",
      });
    }
    const tx: NEAR_TRANSACTION_INSTRUCTION = instruction.NearTransaction;
    const actions = build_actions_for_tx(tx, verbose);
    entries.push({ instruction_index: i, tx, actions });
  }
  return entries;
}
// =================================================
async function send_batched(
  wallet: BATCH_WALLET,
  entries: Array<{
    instruction_index: number;
    tx: NEAR_TRANSACTION_INSTRUCTION;
    actions: ACTION_LIKE[];
  }>,
  signer_id: string,
  verbose: boolean,
): Promise<FinalExecutionOutcome[]> {
  const transactions = entries.map((entry) => ({
    receiverId: entry.tx.receiver_id,
    actions: entry.actions,
  }));
  if (verbose) {
    console.log(
      `[dex-aggregator] batching ${transactions.length} transaction(s) into one wallet popup:`,
      entries
        .map((e) => `${e.instruction_index}:${e.tx.receiver_id}`)
        .join(", "),
    );
  }
  let raw_outcomes: FinalExecutionOutcome[];
  try {
    raw_outcomes = await wallet.signAndSendTransactions({
      signerId: signer_id,
      transactions,
    });
  } catch (cause) {
    throw wrap_near_error(cause);
  }
  const outcomes: FinalExecutionOutcome[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const outcome = raw_outcomes[i];
    if (!outcome) continue;
    const success = !!(outcome.status &&
      typeof outcome.status === "object" &&
      "SuccessValue" in outcome.status);
    if (!success) {
      if (SHOULD_CONTINUE_ON_FAILURE(entry.tx)) {
        if (verbose) {
          console.warn(
            `[dex-aggregator] note: batched outcome ${entry.instruction_index} (${entry.tx.receiver_id}) returned failure but continue_if_failed is set, skipping`,
          );
        }
        continue;
      }
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "near",
        message:
          `route ${entry.instruction_index} (${entry.tx.receiver_id}) returned a failure status: ${JSON.stringify(outcome.status)}`,
      });
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
// =================================================
async function send_one_at_a_time(
  near: Near,
  entries: Array<{
    instruction_index: number;
    tx: NEAR_TRANSACTION_INSTRUCTION;
    actions: ACTION_LIKE[];
  }>,
  signer_id: string,
  verbose: boolean,
): Promise<FinalExecutionOutcome[]> {
  const outcomes: FinalExecutionOutcome[] = [];
  for (const entry of entries) {
    try {
      const outcome = await send_one_tx(near, signer_id, entry.tx, entry.actions, verbose);
      outcomes.push(outcome);
    } catch (cause) {
      if (SHOULD_CONTINUE_ON_FAILURE(entry.tx)) {
        if (verbose) {
          console.warn(
            `[dex-aggregator] note: tx ${entry.instruction_index} to ${entry.tx.receiver_id} failed but continue_if_failed is set, skipping: ${(cause as Error).message ?? cause}`,
          );
        }
        continue;
      }
      throw wrap_near_error(cause);
    }
  }
  return outcomes;
}
// =================================================
async function send_one_tx(
  near: Near,
  signer_id: string,
  tx: NEAR_TRANSACTION_INSTRUCTION,
  actions: ACTION_LIKE[],
  verbose: boolean,
): Promise<FinalExecutionOutcome> {
  let builder = near.transaction(signer_id);
  for (const action of actions) {
    const fc = action.functionCall;
    // Our prebuilt action shape matches near-kit's internal call form
    // for the most part. Two type quirks remain:
    //  - `gas`: near-kit's parameter is the template-literal
    //    `${number} Tgas` | `${number}.${number} Tgas` | `${number}`,
    //    which is narrower than `string` from TypeScript's view. Cast
    //    through unknown — runtime accepts a digits-only string fine.
    //  - `attachedDeposit`: AmountInput is a union of string | bigint,
    //    also narrower than our `string | bigint`. Same cast.
    builder = builder.functionCall(
      tx.receiver_id,
      fc.methodName,
      fc.args as object | Uint8Array,
      {
        gas: fc.gas as never,
        attachedDeposit: fc.deposit as never,
      },
    );
  }
  if (verbose) {
    console.log(
      `[dex-aggregator] sending ${actions.length} action(s) to ${tx.receiver_id} as ${signer_id}`,
    );
  }
  return (await builder.send()) as FinalExecutionOutcome;
}
// =================================================
/** Build the typed action objects for one route instruction. They
 *  match what near-kit's `TransactionBuilder.functionCall` produces
 *  internally (`{ functionCall: { methodName, args, gas, deposit } }`),
 *  so the wallet adapter's `nearActionsToConnectorActions` can
 *  normalize them straight to the wallet protocol format. */
function build_actions_for_tx(
  tx: NEAR_TRANSACTION_INSTRUCTION,
  verbose: boolean,
): ACTION_LIKE[] {
  const actions: ACTION_LIKE[] = [];
  for (let i = 0; i < tx.actions.length; i++) {
    const act = tx.actions[i]!;
    if (!("FunctionCall" in act)) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "near",
        message: `action ${i} is not a FunctionCall — only FunctionCall actions are supported`,
      });
    }
    const fc: FUNCTION_CALL_ACTION = act.FunctionCall;
    const context = `${tx.receiver_id}.${fc.method_name}`;
    // Decode the base64 args into a parsed JSON object (falling back
    // to a string or Uint8Array for legacy raw-binary payloads).
    // Returning an object — not a Uint8Array — avoids a wallet-side
    // serialization trap where JSON.stringify(Uint8Array) yields an
    // opaque `{ "0": 123, "1": 34, ... }` object that the contract
    // cannot parse.
    const args = DECODE_INSTRUCTION_ARGS_AS_JSON(fc.args, context);
    if (verbose) {
      console.log(
        `[dex-aggregator] → ${context}`,
        "args:", args,
      );
    }
    // near-kit's `gas` option expects a string (z.string() in
    // normalizeGas); `attachedDeposit` accepts string or bigint
    // (union in normalizeAmount). Keep gas as a string to avoid the
    // bigint Zod error we hit earlier.
    actions.push({
      functionCall: {
        methodName: fc.method_name,
        args,
        gas: GAS_FROM_ROUTE(fc.gas),
        deposit: DEPOSIT_FROM_ROUTE(fc.deposit),
      },
    });
  }
  return actions;
}
// =================================================
function wrap_near_error(cause: unknown): DEX_AGGREGATOR_CLIENT_ERROR {
  const message =
    cause instanceof Error
      ? cause.message
      : (typeof cause === "string" ? cause : JSON.stringify(cause));
  const wrapped: DEX_AGGREGATOR_ERROR = {
    kind: "near",
    message,
  };
  return new DEX_AGGREGATOR_CLIENT_ERROR(wrapped);
}
function resolve_default_signer_id(near: Near): string | undefined {
  const candidate = (near as unknown as { defaultSignerId?: string })
    .defaultSignerId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return undefined;
}
// =================================================
// copyright 2026 by sleet.near