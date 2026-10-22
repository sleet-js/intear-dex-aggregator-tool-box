#!/usr/bin/env bun
// =================================================
// dex_aggregator_swap (json quote + typed execute)
//
// Quote a swap on the intear dex-aggregator, print a minimal route
// table, let you pick a route, preview its transactions (dry run),
// and optionally execute the picked route with your near-kit signer.
//
// Run:
//   bun run bin/dex_aggregator_swap_bin.ts [token_in] [amount_in] [token_out] [--execute]
//
// Env (see .env.example; CLI args win over env):
//   DEX_AGG_TOKEN_IN / DEX_AGG_AMOUNT_IN / DEX_AGG_TOKEN_OUT
//   DEX_AGG_SLIPPAGE DEX_AGG_MAX_WAIT_MS DEX_AGG_DEXES DEX_AGG_REFERRER_ID
//   DEX_AGG_TRADER_ACCOUNT_ID DEX_AGG_SIGNING_PUBLIC_KEY
//   NEAR_NETWORK (must be mainnet to --execute) NEAR_ACCOUNT_ID NEAR_PRIVATE_KEY
//
// The NEAR signer comes from `@near-kit-tool-box/env`, which loads
// `.env` itself and exports `near_kit_env`, `NEAR_NETWORK` and
// `NEAR_ACCOUNT_ID`. Quoting needs no credentials; only `--execute`
// touches the signer.
//
// Examples (quoting needs no credentials — the router is mainnet only):
//   bun run bin/dex_aggregator_swap_bin.ts
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 usdt.tether-token.near
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 wrap.near
//
// Execute (needs a funded mainnet signer in .env):
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 usdt.tether-token.near --execute
//
// Route-not-found demo (unknown token -> router answers `[]`):
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 this-token-does-not-exist-xyz123.near
// =================================================
import {
  NEAR_ACCOUNT_ID,
  NEAR_NETWORK,
  near_kit_env,
} from "@near-kit-tool-box/env";
import {
  AMOUNT_IN,
  DEX_AGGREGATOR_CLIENT,
  DEX_AGGREGATOR_CLIENT_ERROR,
  EXECUTE_ROUTE_FULL,
  FORMAT_DEX_AGGREGATOR_ERROR,
  GET_ROUTES,
  PRINT_ROUTES_TABLE,
  PRINT_ROUTE_PREVIEW,
  WITH_DEXES,
  WITH_FEES,
  WITH_FIXED_SLIPPAGE,
  WITH_MAX_WAIT_MS,
  WITH_REFERRER_ID,
  WITH_SIGNING_PUBLIC_KEY,
  WITH_TRADER_ACCOUNT_ID,
  IS_DIRECTLY_EXECUTABLE,
} from "../src/index.ts";
// =================================================
function envOr(key: string, fallback: string): string {
  const raw = process.env[key];
  const value = raw?.trim() ?? "";
  return value.length > 0 ? value : fallback;
}
function envOpt(keys: string[]): string | undefined {
  for (const k of keys) {
    const raw = process.env[k];
    const value = raw?.trim() ?? "";
    if (value.length > 0) return value;
  }
  return undefined;
}
// =================================================
async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const execute = rawArgs.includes("--execute");
  const positional = rawArgs.filter((a) => a !== "--execute");

  const tokenIn = positional[0] ?? envOr("DEX_AGG_TOKEN_IN", "near");
  const amountIn_ = positional[1] ?? envOr(
    "DEX_AGG_AMOUNT_IN",
    "100000000000000000000000",
  );
  const tokenOut = positional[2] ?? envOr(
    "DEX_AGG_TOKEN_OUT",
    "usdt.tether-token.near",
  );

  let params = AMOUNT_IN(tokenIn, tokenOut, amountIn_);

  const slippage = envOpt(["DEX_AGG_SLIPPAGE", "DEX_AGGREGATOR_SLIPPAGE"]);
  if (slippage !== undefined) {
    const v = Number(slippage);
    if (!Number.isFinite(v)) {
      throw new Error(`DEX_AGG_SLIPPAGE is not a decimal: ${slippage}`);
    }
    params = WITH_FIXED_SLIPPAGE(params, v);
  }
  const maxWait = envOpt([
    "DEX_AGG_MAX_WAIT_MS",
    "DEX_AGGREGATOR_MAX_WAIT_MS",
  ]);
  if (maxWait !== undefined) {
    const v = Number(maxWait);
    if (!Number.isFinite(v)) {
      throw new Error(`DEX_AGG_MAX_WAIT_MS is not an integer: ${maxWait}`);
    }
    params = WITH_MAX_WAIT_MS(params, v);
  }
  const dexes = envOpt(["DEX_AGG_DEXES", "DEX_AGGREGATOR_DEXES"]);
  if (dexes !== undefined) params = WITH_DEXES(params, dexes);
  const referrer = envOpt(["DEX_AGG_REFERRER_ID", "DEX_AGGREGATOR_REFERRER_ID"]);
  if (referrer !== undefined) params = WITH_REFERRER_ID(params, referrer);
  // Default the trader to the signer so storage-deposit legs are
  // included when you go on to execute.
  const trader = envOpt(["DEX_AGG_TRADER_ACCOUNT_ID"]) ??
    (NEAR_ACCOUNT_ID.length > 0 ? NEAR_ACCOUNT_ID : undefined);
  if (trader !== undefined) params = WITH_TRADER_ACCOUNT_ID(params, trader);
  const pubKey = envOpt(["DEX_AGG_SIGNING_PUBLIC_KEY"]);
  if (pubKey !== undefined) params = WITH_SIGNING_PUBLIC_KEY(params, pubKey);
  // Optional referral fee charged on the input of every swap. Both
  // halves are required: the account to pay, and the fraction. Routes
  // quoted with fees carry an `is_fee_transaction` leg, which
  // EXECUTE_ROUTE_FULL only sends once the outcome says the swap went
  // through.
  const fee_account = envOpt(["DEX_AGG_FEE_ACCOUNT_ID"]);
  const fee_value = envOpt(["DEX_AGG_FEE"]);
  if (fee_account !== undefined && fee_value !== undefined) {
    const fee = Number(fee_value);
    if (!Number.isFinite(fee)) {
      console.error(`DEX_AGG_FEE is not a decimal: ${fee_value}`);
      process.exit(1);
    }
    params = WITH_FEES(params, [{ account_id: fee_account, fee }]);
  } else if (fee_account !== undefined || fee_value !== undefined) {
    console.error(
      "Set BOTH DEX_AGG_FEE_ACCOUNT_ID (who to pay) and DEX_AGG_FEE (fraction, e.g. 0.005) to charge a referral fee.",
    );
    process.exit(1);
  }

  const client = DEX_AGGREGATOR_CLIENT.FROM_ENV();
  console.log(
    `Quoting ${amountIn_} ${tokenIn} -> ${tokenOut} via ${client.BASE_URL_VALUE()} ...`,
  );
  const routes = await GET_ROUTES(client, params);
  if (routes.length === 0) {
    console.error(`No routes found for ${amountIn_} ${tokenIn} -> ${tokenOut}.`);
    console.error(
      "The router answers `[]` when no DEX can serve a pair: check both token ids",
    );
    console.error(
      "(testnet tokens are unsupported — the router is mainnet only), try a smaller",
    );
    console.error(
      "amount, or leave DEX_AGG_DEXES empty to use every DEX.",
    );
    process.exit(1);
  }
  console.log(`Found ${routes.length} route(s) (best first):`);
  PRINT_ROUTES_TABLE(routes);

  process.stdout.write("Select route [0]: ");
  const input = (await new Promise<string>((resolve) => {
    process.stdin.once("data", (chunk) => resolve(chunk.toString("utf-8")));
    process.stdin.once("end", () => resolve(""));
  })).trim();
  const index = input.length === 0 ? 0 : Number(input);
  if (!Number.isInteger(index) || index < 0 || index >= routes.length) {
    console.error(
      `Route ${index} is out of range (0..${routes.length}).`,
    );
    process.exit(1);
  }
  const route = routes[index]!;
  console.log();
  PRINT_ROUTE_PREVIEW(route);

  if (!IS_DIRECTLY_EXECUTABLE(route)) {
    console.error();
    console.error(
      `Route ${index} (dex ${route.dex_id}) needs manual handling (non-NearTransaction leg).`,
    );
    process.exit(1);
  }

  if (!execute) {
    console.log();
    console.log(
      "Dry run — no transaction sent. Re-run with --execute plus a funded mainnet",
    );
    console.log(
      "signer (NEAR_NETWORK=mainnet NEAR_ACCOUNT_ID NEAR_PRIVATE_KEY in .env) to swap.",
    );
    return;
  }

  if (NEAR_NETWORK !== "mainnet") {
    console.error(
      "Refusing to execute: the intear router is mainnet only but NEAR_NETWORK is not mainnet.",
    );
    console.error(
      "Set NEAR_NETWORK=mainnet (with a funded mainnet signer) to execute.",
    );
    process.exit(1);
  }
  if (NEAR_ACCOUNT_ID.length === 0) {
    console.error("Refusing to execute: NEAR_ACCOUNT_ID is not set.");
    process.exit(1);
  }
  console.log();
  console.log(`Executing route ${index} via ${route.dex_id} ...`);
  try {
    // Three phases, so a refunded swap is not reported as a success
    // and fee legs are only sent when the swap actually went through.
    const result = await EXECUTE_ROUTE_FULL(near_kit_env, route, {
      client,
      token_in: tokenIn,
      token_out: tokenOut,
      signer_id: NEAR_ACCOUNT_ID,
      fee_amount: route.fee_amount ?? "0",
      on_failure: "recover",
      verbose: true,
    });
    print_outcomes("swap", result.swap_outcomes);
    if (result.fee_outcomes.length > 0) {
      print_outcomes("fee", result.fee_outcomes);
    }
    if (result.recovery_outcomes.length > 0) {
      print_outcomes("recovery", result.recovery_outcomes);
    }
    console.log();
    if (result.swap_succeeded) {
      console.log(
        `OK — spent ${result.final_outcome.amount_in} ${tokenIn}, ` +
        `received ${result.final_outcome.amount_out} ${tokenOut}`,
      );
    } else {
      console.log(
        `SWAP FAILED — ${result.outcome.error ?? "the DEX refunded the input"}`,
      );
      console.log(
        `  spent ${result.outcome.amount_in}, received ${result.outcome.amount_out}` +
        (result.recovery_outcomes.length > 0
          ? `\n  ${result.recovery_outcomes.length} recovery transaction(s) sent to return your tokens`
          : ""),
      );
    }
  } catch (err) {
    if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
      console.error(FORMAT_DEX_AGGREGATOR_ERROR(err.error));
      if (err.error.kind === "swap_failed") {
        console.error(
          "The swap did not go through and no recovery was run. Re-quote and try again," +
          " or raise your slippage.",
        );
      }
      if (err.error.kind === "outcome_unavailable") {
        console.error(
          "This is a failed CHECK, not a failed swap — the swap may well have succeeded." +
          " Verify the hashes on nearblocks before retrying, or you will double-spend.",
        );
      }
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

/** Print each transaction with a label and its explorer link. */
function print_outcomes(
  label: string,
  outcomes: readonly { transaction?: { hash?: string } }[],
): void {
  outcomes.forEach((outcome, i) => {
    const hash = (outcome.transaction?.hash as string | undefined) ??
      "(unknown)";
    console.log(`  [${label} ${i}] hash ${hash}`);
    console.log(`          https://nearblocks.io/txns/${hash}`);
  });
}
// =================================================
main().catch((err) => {
  if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
    console.error(FORMAT_DEX_AGGREGATOR_ERROR(err.error));
  } else {
    console.error(err);
  }
  process.exit(1);
});
// =================================================
// copyright 2026 by sleet.near
