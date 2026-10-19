// =================================================
// dex_aggregator_execute_route_fun
// Execute one quoted `Route` with your near-kit `Near` client.
//
// Browser (wallet) path: every route instruction targets one
// receiver and IS its own NEAR transaction (NEAR txs are single-
// receiver). We batch them into a SINGLE wallet popup via
// `wallet.signAndSendTransactions({ transactions: [...] })` —
// one popup, one approval, even for Plach's 2-step swap.
//
// Backend (privateKey) path: no wallet is involved, so we just call
// `near.transaction(signer).functionCall(...).send()` once per
// instruction (sequential, await each) and stream outcomes.
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
/** Execute one quoted route with your near-kit `Near` client.
 *
 *  Each `NearTransaction` instruction becomes one NEAR transaction
 *  (a NEAR tx has exactly one receiver). On the browser path we
 *  hand the wallet an array of prebuilt transactions — it signs
 *  all of them under ONE popup; on the backend we send each
 *  sequentially via the local signer.
 *
 *  Returns one outcome per instruction that actually went out (fee
 *  instructions that failed and were skipped are not in the result).
 *
 *  Throws a `DexAggregatorClientError` of kind `"near"` when a
 *  non-tolerated transaction fails. */
export async function executeRoute(
  near: Near,
  route: Route,
  options: {
    signerId?: string;
    verbose?: boolean;
    /** Override batched-wallet dispatch. When true and a wallet is
     *  attached, build all transactions and call
     *  `wallet.signAndSendTransactions({ transactions: [...] })`
     *  in ONE popup. Default: true. */
    batchTransactions?: boolean;
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
  // Pre-extract every (receiverId, actions[]) pair so we can feed it
  // to either the wallet batch path or the per-tx path without two
  // different code paths through the action builder.
  const entries: Array<{
    instructionIndex: number;
    tx: NearTransactionInstruction;
    actions: BuildAction[];
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
  const wallet = resolveWallet(near);
  const useBatch = (options.batchTransactions !== false) && wallet &&
    typeof (wallet as { signAndSendTransactions?: unknown })
      .signAndSendTransactions === "function";
  if (useBatch) {
    return sendBatched(wallet as WalletLike, entries, signerId, verbose);
  }

  // Per-tx path: one send per instruction, sequential.
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
/** Minimal contract: NearWalletBase's `signAndSendTransactions`. We
 *  accept any object that implements the two methods we need; we
 *  don't depend on near-kit's private types. */
interface WalletLike {
  signAndSendTransaction(params: {
    signerId?: string;
    receiverId: string;
    actions: unknown[];
  }): Promise<FinalExecutionOutcome>;
  signAndSendTransactions(params: {
    signerId?: string;
    transactions: Array<{ receiverId: string; actions: unknown[] }>;
  }): Promise<FinalExecutionOutcome[]>;
  signOut?: (data?: { network?: string }) => Promise<void>;
}

/** Shape we build for each `FunctionCall` action — matches what
 *  near-kit's TransactionBuilder produces internally, so the
 *  wallet's `signAndSendTransactions` accepts it as-is (the
 *  `near-connect` adapter normalizes it into the wallet's
 *  `ConnectorAction` JSON shape at the protocol boundary).
 *
 *  `gas` must be a string (z.string() in near-kit's normalizeGas),
 *  `deposit` accepts string | bigint (the union in normalizeAmount). */
type BuildAction = { functionCall: {
  methodName: string;
  args: unknown;
  gas: string;
  deposit: string | bigint;
} };

function resolveWallet(near: Near): WalletLike | undefined {
  const candidate = (near as unknown as { wallet?: unknown }).wallet;
  if (!candidate || typeof (candidate as WalletLike).signAndSendTransaction !== "function") {
    return undefined;
  }
  return candidate as WalletLike;
}
// =================================================
async function sendBatched(
  wallet: WalletLike,
  entries: Array<{
    instructionIndex: number;
    tx: NearTransactionInstruction;
    actions: BuildAction[];
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
  // The wallet returns FinalExecutionOutcome[] — same shape as
  // near-kit's per-tx builder, so callers don't need to know which
  // path we took.
  let rawOutcomes: FinalExecutionOutcome[];
  try {
    rawOutcomes = await wallet.signAndSendTransactions({
      signerId,
      transactions,
    });
  } catch (cause) {
    throw wrapNearError(cause);
  }
  if (verbose) {
    console.log(
      `[dex-aggregator] wallet returned ${rawOutcomes.length} outcome(s)`,
    );
  }
  // Honor per-instruction continue_if_failed by mapping batch
  // outcomes back to entries.
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
async function sendOneTx(
  near: Near,
  signerId: string,
  tx: NearTransactionInstruction,
  actions: BuildAction[],
  verbose: boolean,
): Promise<FinalExecutionOutcome> {
  let builder = near.transaction(signerId);
  for (const action of actions) {
    const fc = action.functionCall;
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
/** Build the typed action objects for one route instruction. We
 *  construct them in the same shape near-kit's TransactionBuilder
 *  produces internally (i.e. { functionCall: { methodName, args,
 *  gas, deposit } }), so the batched wallet path and the per-tx
 *  path both see identical action shapes. */
function buildActionsForTx(
  tx: NearTransactionInstruction,
  verbose: boolean,
): BuildAction[] {
  const actions: BuildAction[] = [];
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
    // near-kit's `gas` option expects a string (passes through GasSchema
    // which is z.string()); `attachedDeposit` accepts either string or
    // bigint (AmountSchema is union). Keep gas as a string to match
    // near-kit's accepted type — passing bigint here triggers a Zod
    // parse error in normalizeGas().
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
