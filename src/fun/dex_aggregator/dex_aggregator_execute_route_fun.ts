// =================================================
// dex_aggregator_execute_route_fun
// Execute one quoted `Route` against a `near-kit` `Near` client.
//
// Backend path (private-key signer, no wallet): one
// `near.transaction(signer).functionCall(...).send()` per
// instruction, sequentially.
//
// Browser path (wallet attached, e.g. via `fromHotConnect` adapter):
// callers may pass a `wallet` directly — when set, we hand the
// wallet an array of prebuilt transactions and let it batch them
// into ONE popup via `wallet.signAndSendTransactions({ transactions:
// [...] })`. Each NEAR transaction is single-receiver; the wallet
// signs and broadcasts each in nonce order.
//
// An instruction flagged `continue_if_failed` (or its router alias
// `is_fee_transaction`) is skipped (with an stderr note) when its
// transaction fails; otherwise the first failure aborts.
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
/** Minimal contract callers need to satisfy when batching. The
 *  underlying `@hot-labs/near-connect` `NearWalletBase` matches
 *  this exactly. */
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

/** Execute one quoted route.
 *
 *  When `wallet` is provided the whole route is sent to the wallet
 *  in ONE popup via `wallet.signAndSendTransactions({ transactions
 *  })`. When omitted, the function falls back to the per-tx
 *  near-kit path (one NEAR transaction per route instruction).
 *  Per-instruction `continue_if_failed` is honored in both paths. */
export async function executeRoute(
  near: Near,
  route: Route,
  options: {
    signerId?: string;
    verbose?: boolean;
    /** Wallet batching adapter. When present, we hand the wallet
     *  all transactions at once (one popup). When omitted, we
     *  fall back to near-kit's per-tx path. */
    wallet?: BatchWallet;
  } = {},
): Promise<FinalExecutionOutcome[]> {
  const signerId = options.signerId ?? resolveDefaultSignerId(near);
  if (!signerId) {
    throw new DexAggregatorClientError({
      kind: "invalid_params",
      message:
        "executeRoute: no signerId available — pass one explicitly or build Near with defaultSignerId",
    });
  }
  const verbose = options.verbose !== false;
  // Pre-extract every (receiverId, actions[]) pair so both paths
  // share one source of truth for the actions.
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
  if (entries.length === 0) return [];

  // Wallet batch path: ONE popup, ALL transactions.
  if (options.wallet) {
    return sendBatched(options.wallet, entries, signerId, verbose);
  }
  // Per-tx path: one send per instruction, sequential.
  return sendOneAtATime(near, entries, signerId, verbose);
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
