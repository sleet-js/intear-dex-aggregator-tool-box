// =================================================
// dex_aggregator_execute_route_fun
// Execute one quoted `Route`. Two named entry points, one shared
// action-building pipeline:
//
//   • executeRouteSequential(near, route, opts)
//       backend / CLI path. One `near.transaction(signer).functionCall(...).send()`
//       per instruction, sequentially. Uses near-kit's `Near` (private-
//       key signer).
//
//   • executeRouteBatched(wallet, route, opts)
//       browser path. Hands the wallet an array of prebuilt transactions
//       and lets it batch them into ONE popup via
//       `wallet.signAndSendTransactions({ transactions: [...] })`.
//       Each NEAR transaction is single-receiver; the wallet signs and
//       broadcasts each in nonce order.
//
// Both paths share `prepareEntries` + `buildActionsForTx` so the
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
/** Minimal wallet contract for the batched browser path. Matches the
 *  `signAndSendTransactions` method on `@hot-labs/near-connect`'s
 *  `NearWalletBase` — every concrete wallet (SandboxedWallet,
 *  ParentFrameWallet, InjectedWallet) implements it. We don't take a
 *  dependency on `@hot-labs/near-connect` here so the lib stays
 *  wallet-framework-agnostic; the consumer casts. */
export interface BatchWallet {
  signAndSendTransactions(params: {
    signerId?: string;
    transactions: Array<{ receiverId: string; actions: ActionLike[] }>;
  }): Promise<FinalExecutionOutcome[]>;
}

/** Minimal `Action` shape we hand to either near-kit or the wallet
 *  adapter — anything `nearActionsToConnectorActions` accepts (and
 *  near-kit's TransactionBuilder.functionCall produces).
 *
 *  `gas` must be a string (digits-only — match's near-kit's `GasInput`
 *  via the `${number}` template branch). `deposit` accepts string
 *  or bigint (near-kit's `AmountInput` is a union of both). */
export type ActionLike = {
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
export interface ExecuteRouteOptions {
  signerId?: string;
  verbose?: boolean;
}
// =================================================
/** Sequential execution: one NEAR transaction per route instruction,
 *  sent in order via `near-kit`. Use this when there is no wallet
 *  attached (private-key signer, scripts, tests). */
export async function executeRouteSequential(
  near: Near,
  route: Route,
  options: ExecuteRouteOptions = {},
): Promise<FinalExecutionOutcome[]> {
  const signerId = options.signerId ?? resolveDefaultSignerId(near);
  if (!signerId) {
    throw new DexAggregatorClientError({
      kind: "invalid_params",
      message:
        "executeRouteSequential: no signerId available — pass one explicitly or build Near with defaultSignerId",
    });
  }
  const entries = prepareEntries(route, options.verbose === true);
  if (entries.length === 0) return [];
  return sendOneAtATime(near, entries, signerId, options.verbose === true);
}
// =================================================
/** Batched execution: hand the wallet the whole route's transactions
 *  in one popup. The wallet must implement `signAndSendTransactions`
 *  (plural); a missing method throws a typed `DexAggregatorClientError`
 *  so callers can prompt the user to reconnect a NEAR Connect session
 *  that supports batching.
 *
 *  @example
 *  ```ts
 *  import { executeRouteBatched } from "intear-dex-aggregator-tool-box";
 *  import { near_connect_client } from "@near-kit-tool-box/web";
 *
 *  const wallet = await near_connect_client().wallet();
 *  const outcomes = await executeRouteBatched(wallet, route);
 *  ``` */
export async function executeRouteBatched(
  wallet: BatchWallet | unknown,
  route: Route,
  options: ExecuteRouteOptions = {},
): Promise<FinalExecutionOutcome[]> {
  const signerId = options.signerId ??
    (typeof wallet === "object" && wallet !== null &&
      "accounts" in wallet && Array.isArray(
        (wallet as { accounts?: unknown }).accounts,
      )
      ? (((wallet as { accounts: Array<{ accountId: string }> })
        .accounts[0]?.accountId) || undefined)
      : undefined);
  if (!signerId) {
    throw new DexAggregatorClientError({
      kind: "invalid_params",
      message:
        "executeRouteBatched: no signerId available — pass `signerId` explicitly",
    });
  }
  assertSupportsBatching(wallet);
  const entries = prepareEntries(route, options.verbose === true);
  if (entries.length === 0) return [];
  return sendBatched(
    wallet as BatchWallet,
    entries,
    signerId,
    options.verbose === true,
  );
}
// =================================================
/** Throw a clear typed error when the connected wallet does not
 *  expose `signAndSendTransactions` (plural). The feature check lives
 *  here so consumers don't have to know about near-kit's wallet
 *  adapter surface. */
function assertSupportsBatching(wallet: unknown): asserts wallet is BatchWallet {
  if (
    !wallet ||
    typeof wallet !== "object" ||
    typeof (wallet as { signAndSendTransactions?: unknown })
      .signAndSendTransactions !== "function"
  ) {
    throw new DexAggregatorClientError({
      kind: "invalid_params",
      message:
        "executeRouteBatched: wallet does not expose signAndSendTransactions — reconnect a NEAR Connect / Intear Wallet session that supports transaction batching.",
    });
  }
}
// =================================================
/** Build the (instructionIndex, NearTransactionInstruction, ActionLike[])
 *  tuples both paths share. */
function prepareEntries(
  route: Route,
  verbose: boolean,
): Array<{
  instructionIndex: number;
  tx: NearTransactionInstruction;
  actions: ActionLike[];
}> {
  const entries: Array<{
    instructionIndex: number;
    tx: NearTransactionInstruction;
    actions: ActionLike[];
  }> = [];
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
    const actions = buildActionsForTx(tx, verbose);
    entries.push({ instructionIndex: i, tx, actions });
  }
  return entries;
}
// =================================================
async function sendBatched(
  wallet: BatchWallet,
  entries: Array<{
    instructionIndex: number;
    tx: NearTransactionInstruction;
    actions: ActionLike[];
  }>,
  signerId: string,
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
        .map((e) => `${e.instructionIndex}:${e.tx.receiver_id}`)
        .join(", "),
    );
  }
  let rawOutcomes: FinalExecutionOutcome[];
  try {
    rawOutcomes = await wallet.signAndSendTransactions({
      signerId,
      transactions,
    });
  } catch (cause) {
    throw wrapNearError(cause);
  }
  const outcomes: FinalExecutionOutcome[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const outcome = rawOutcomes[i];
    if (!outcome) continue;
    const success = !!(outcome.status &&
      typeof outcome.status === "object" &&
      "SuccessValue" in outcome.status);
    if (!success) {
      if (shouldContinueOnFailure(entry.tx)) {
        if (verbose) {
          console.warn(
            `[dex-aggregator] note: batched outcome ${entry.instructionIndex} (${entry.tx.receiver_id}) returned failure but continue_if_failed is set, skipping`,
          );
        }
        continue;
      }
      throw new DexAggregatorClientError({
        kind: "near",
        message:
          `route ${entry.instructionIndex} (${entry.tx.receiver_id}) returned a failure status: ${JSON.stringify(outcome.status)}`,
      });
    }
    outcomes.push(outcome);
  }
  return outcomes;
}
// =================================================
async function sendOneAtATime(
  near: Near,
  entries: Array<{
    instructionIndex: number;
    tx: NearTransactionInstruction;
    actions: ActionLike[];
  }>,
  signerId: string,
  verbose: boolean,
): Promise<FinalExecutionOutcome[]> {
  const outcomes: FinalExecutionOutcome[] = [];
  for (const entry of entries) {
    try {
      const outcome = await sendOneTx(near, signerId, entry.tx, entry.actions, verbose);
      outcomes.push(outcome);
    } catch (cause) {
      if (shouldContinueOnFailure(entry.tx)) {
        if (verbose) {
          console.warn(
            `[dex-aggregator] note: tx ${entry.instructionIndex} to ${entry.tx.receiver_id} failed but continue_if_failed is set, skipping: ${(cause as Error).message ?? cause}`,
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
  actions: ActionLike[],
  verbose: boolean,
): Promise<FinalExecutionOutcome> {
  let builder = near.transaction(signerId);
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
      `[dex-aggregator] sending ${actions.length} action(s) to ${tx.receiver_id} as ${signerId}`,
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
function buildActionsForTx(
  tx: NearTransactionInstruction,
  verbose: boolean,
): ActionLike[] {
  const actions: ActionLike[] = [];
  for (let i = 0; i < tx.actions.length; i++) {
    const act = tx.actions[i]!;
    if (!("FunctionCall" in act)) {
      throw new DexAggregatorClientError({
        kind: "near",
        message: `action ${i} is not a FunctionCall — only FunctionCall actions are supported`,
      });
    }
    const fc: FunctionCallAction = act.FunctionCall;
    const context = `${tx.receiver_id}.${fc.method_name}`;
    // Decode the base64 args into a parsed JSON object (falling back
    // to a string or Uint8Array for legacy raw-binary payloads).
    // Returning an object — not a Uint8Array — avoids a wallet-side
    // serialization trap where JSON.stringify(Uint8Array) yields an
    // opaque `{ "0": 123, "1": 34, ... }` object that the contract
    // cannot parse.
    const args = decodeInstructionArgsAsJson(fc.args, context);
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
        gas: gasFromRoute(fc.gas),
        deposit: depositFromRoute(fc.deposit),
      },
    });
  }
  return actions;
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
function resolveDefaultSignerId(near: Near): string | undefined {
  const candidate = (near as unknown as { defaultSignerId?: string })
    .defaultSignerId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return undefined;
}
// =================================================
// copyright 2026 by sleet.near