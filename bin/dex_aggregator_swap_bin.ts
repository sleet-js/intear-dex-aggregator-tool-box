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
// Examples (quoting needs no credentials — the router is mainnet only):
//   bun run bin/dex_aggregator_swap_bin.ts
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 usdt.tether-token.near
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 wrap.near
//
// Execute (needs a funded mainnet signer in env):
//   set -a; source .env; set +a
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 usdt.tether-token.near --execute
//
// Route-not-found demo (unknown token -> router answers `[]`):
//   bun run bin/dex_aggregator_swap_bin.ts near 100000000000000000000000 this-token-does-not-exist-xyz123.near
// =================================================
import { Near } from "near-kit";
import type { PrivateKey } from "near-kit";
import {
  amountIn,
  DexAggregatorClient,
  DexAggregatorClientError,
  executeRouteSequential,
  formatDexAggregatorError,
  getRoutes,
  printRoutesTable,
  printRoutePreview,
  withDexes,
  withFixedSlippage,
  withMaxWaitMs,
  withReferrerId,
  withSigningPublicKey,
  withTraderAccountId,
  isDirectlyExecutable,
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

  let params = amountIn(tokenIn, tokenOut, amountIn_);

  const slippage = envOpt(["DEX_AGG_SLIPPAGE", "DEX_AGGREGATOR_SLIPPAGE"]);
  if (slippage !== undefined) {
    const v = Number(slippage);
    if (!Number.isFinite(v)) {
      throw new Error(`DEX_AGG_SLIPPAGE is not a decimal: ${slippage}`);
    }
    params = withFixedSlippage(params, v);
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
    params = withMaxWaitMs(params, v);
  }
  const dexes = envOpt(["DEX_AGG_DEXES", "DEX_AGGREGATOR_DEXES"]);
  if (dexes !== undefined) params = withDexes(params, dexes);
  const referrer = envOpt(["DEX_AGG_REFERRER_ID", "DEX_AGGREGATOR_REFERRER_ID"]);
  if (referrer !== undefined) params = withReferrerId(params, referrer);
  // Default the trader to the signer so storage-deposit legs are
  // included when you go on to execute.
  const trader = envOpt(["DEX_AGG_TRADER_ACCOUNT_ID"]) ??
    envOpt(["NEAR_ACCOUNT_ID"]);
  if (trader !== undefined) params = withTraderAccountId(params, trader);
  const pubKey = envOpt(["DEX_AGG_SIGNING_PUBLIC_KEY"]);
  if (pubKey !== undefined) params = withSigningPublicKey(params, pubKey);

  const client = DexAggregatorClient.fromEnv();
  console.log(
    `Quoting ${amountIn_} ${tokenIn} -> ${tokenOut} via ${client.baseUrlValue()} ...`,
  );
  const routes = await getRoutes(client, params);
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
  printRoutesTable(routes);

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
  printRoutePreview(route);

  if (!isDirectlyExecutable(route)) {
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
      "signer (NEAR_NETWORK=mainnet NEAR_ACCOUNT_ID NEAR_PRIVATE_KEY) to swap.",
    );
    return;
  }

  if (envOr("NEAR_NETWORK", "testnet") !== "mainnet") {
    console.error(
      "Refusing to execute: the intear router is mainnet only but NEAR_NETWORK is not mainnet.",
    );
    console.error(
      "Set NEAR_NETWORK=mainnet (with a funded mainnet signer) to execute.",
    );
    process.exit(1);
  }
  const pk = envOpt(["NEAR_PRIVATE_KEY"]);
  if (!pk) {
    console.error("Refusing to execute: NEAR_PRIVATE_KEY is not set.");
    process.exit(1);
  }
  const near = new Near({
    network: "mainnet",
    privateKey: pk as PrivateKey,
    defaultSignerId: envOr("NEAR_ACCOUNT_ID", ""),
  });
  console.log();
  console.log(`Executing route ${index} via ${route.dex_id} ...`);
  try {
    const outcomes = await executeRouteSequential(near, route, {
      verbose: true,
    });
    for (let i = 0; i < outcomes.length; i++) {
      const outcome = outcomes[i]!;
      const status = outcome.status && typeof outcome.status === "object" &&
          "SuccessValue" in outcome.status
        ? "SUCCESS"
        : "FAILED";
      const hash = (outcome.transaction?.hash as string | undefined) ??
        "(unknown)";
      console.log(`  [tx ${i}] ${status} hash ${hash}`);
      console.log(`          https://nearblocks.io/txns/${hash}`);
    }
  } catch (err) {
    if (err instanceof DexAggregatorClientError) {
      console.error(formatDexAggregatorError(err.error));
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}
// =================================================
main().catch((err) => {
  if (err instanceof DexAggregatorClientError) {
    console.error(formatDexAggregatorError(err.error));
  } else {
    console.error(err);
  }
  process.exit(1);
});
// =================================================
// copyright 2026 by sleet.near
