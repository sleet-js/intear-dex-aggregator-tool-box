#!/usr/bin/env bun
// =================================================
// dex_aggregator_subscribe_bin
// Watch live quotes for a swap on the intear dex-aggregator.
//
// A quote is only good for a few seconds: pools change every block.
// This opens the router's WebSocket (`/route/subscribe`) and prints
// every update the server pushes, so you can watch the best route
// change as pools move instead of polling `GET /route`.
//
// Needs no credentials — routing is free and read-only.
//
// Run:
//   bun run bin/dex_aggregator_subscribe_bin.ts [token_in] [amount_in] [token_out]
//   bun run subscribe [token_in] [amount_in] [token_out] [seconds]
//
// Env (see .env.example; CLI args win over env):
//   DEX_AGG_TOKEN_IN / DEX_AGG_AMOUNT_IN / DEX_AGG_TOKEN_OUT
//   DEX_AGG_SLIPPAGE DEX_AGG_DEXES DEX_AGG_REFERRER_ID
//   DEX_AGG_TRADER_ACCOUNT_ID DEX_AGG_SIGNING_PUBLIC_KEY DEX_AGG_API_KEY
//
// Examples:
//   bun run bin/dex_aggregator_subscribe_bin.ts
//   bun run bin/dex_aggregator_subscribe_bin.ts near 10000000000000000000000 usdt.tether-token.near
//   bun run bin/dex_aggregator_subscribe_bin.ts near 10000000000000000000000 usdt.tether-token.near 30
//
// Ctrl-C to stop early.
// =================================================
import { NEAR_ACCOUNT_ID } from "@near-kit-tool-box/env";
import {
  AMOUNT_IN,
  DEX_AGGREGATOR_CLIENT,
  DEX_AGGREGATOR_CLIENT_ERROR,
  FORMAT_DEX_AGGREGATOR_ERROR,
  SUBSCRIBE_ROUTES,
  WITH_DEXES,
  WITH_FEES,
  WITH_FIXED_SLIPPAGE,
  WITH_REFERRER_ID,
  WITH_SIGNING_PUBLIC_KEY,
  WITH_TRADER_ACCOUNT_ID,
  type QUOTE_PARAMS,
  type ROUTE,
} from "../src/index.ts";
// =================================================
function env_or(key: string, fallback: string): string {
  const raw = process.env[key];
  const value = raw?.trim() ?? "";
  return value.length > 0 ? value : fallback;
}

function env_opt(key: string): string | undefined {
  const value = process.env[key]?.trim() ?? "";
  return value.length > 0 ? value : undefined;
}
// =================================================
/** One-line summary of the best route in an update. */
function describe_best(routes: ROUTE[]): string {
  const best = routes[0];
  if (!best) return "no DEX can serve this pair";
  const estimated = best.estimated_amount.amount_out ?? best.estimated_amount.amount_in;
  const worst = best.worst_case_amount.amount_out ?? best.worst_case_amount.amount_in;
  const mode = best.estimated_amount.amount_out !== undefined ? "out" : "in";
  return (
    `best ${best.dex_id}: ${estimated} ${mode} (worst ${worst})` +
    ` | ${best.execution_instructions.length} tx` +
    ` | output ${best.token_output}`
  );
}

/** Every route in an update, one line each. */
function format_routes(routes: ROUTE[]): string {
  if (routes.length === 0) return "    (no route)";
  const rows = routes.map((route, i) => {
    // Both fields are optional on the wire: the router fills exactly
    // one depending on the quote mode, so neither can be assumed.
    const estimated = route.estimated_amount.amount_out ??
      route.estimated_amount.amount_in ?? "?";
    const worst = route.worst_case_amount.amount_out ??
      route.worst_case_amount.amount_in ?? "?";
    const mode = route.estimated_amount.amount_out !== undefined ? "out" : "in";
    const legs = route.execution_instructions.length;
    return (
      `    ${i}. ${route.dex_id.padEnd(7)} ${estimated.padStart(22)} ${mode} ` +
      `worst ${worst.padStart(22)}  ${legs} tx  -> ${route.token_output}`
    );
  });
  return rows.join("\n");
}
// =================================================
async function main(): Promise<void> {
  const raw = process.argv.slice(2);
  const token_in = raw[0] ?? env_or("DEX_AGG_TOKEN_IN", "near");
  const amount_in = raw[1] ?? env_or("DEX_AGG_AMOUNT_IN", "10000000000000000000000");
  const token_out = raw[2] ?? env_or("DEX_AGG_TOKEN_OUT", "usdt.tether-token.near");
  // Optional 4th arg: how long to watch, in seconds (default 20).
  const seconds = Number(raw[3] ?? env_or("DEX_AGG_SUBSCRIBE_SECONDS", "20"));
  if (!Number.isFinite(seconds) || seconds <= 0) {
    console.error(`Not a positive number of seconds: ${raw[3]}`);
    process.exit(1);
  }

  let params: QUOTE_PARAMS = AMOUNT_IN(token_in, token_out, amount_in);
  const slippage = env_opt("DEX_AGG_SLIPPAGE");
  if (slippage !== undefined) {
    const value = Number(slippage);
    if (!Number.isFinite(value)) {
      console.error(`DEX_AGG_SLIPPAGE is not a decimal: ${slippage}`);
      process.exit(1);
    }
    params = WITH_FIXED_SLIPPAGE(params, value);
  }
  const dexes = env_opt("DEX_AGG_DEXES");
  if (dexes !== undefined) params = WITH_DEXES(params, dexes);
  const referrer = env_opt("DEX_AGG_REFERRER_ID");
  if (referrer !== undefined) params = WITH_REFERRER_ID(params, referrer);
  // Default the trader to the connected signer, the way the swap bin
  // does. Without it the router cannot plan the storage deposits and
  // registrations this account is missing, so a quote shown here would
  // not match the one the swap bin quotes a second later.
  //
  // Must go through env_opt, not process.env: an unset variable in a
  // .env file is often present but EMPTY (`KEY=`), and `??` only
  // catches null/undefined, so the raw read would yield "" and
  // silently send no trader at all.
  const trader = env_opt("DEX_AGG_TRADER_ACCOUNT_ID") ??
    (NEAR_ACCOUNT_ID.length > 0 ? NEAR_ACCOUNT_ID : undefined);
  if (trader !== undefined) params = WITH_TRADER_ACCOUNT_ID(params, trader);
  const pub_key = env_opt("DEX_AGG_SIGNING_PUBLIC_KEY");
  if (pub_key !== undefined) params = WITH_SIGNING_PUBLIC_KEY(params, pub_key);
  const fee_account = env_opt("DEX_AGG_FEE_ACCOUNT_ID");
  const fee_value = env_opt("DEX_AGG_FEE");
  if (fee_account !== undefined && fee_value !== undefined) {
    const fee = Number(fee_value);
    if (!Number.isFinite(fee)) {
      console.error(`DEX_AGG_FEE is not a decimal: ${fee_value}`);
      process.exit(1);
    }
    params = WITH_FEES(params, [{ account_id: fee_account, fee }]);
  }

  const client = DEX_AGGREGATOR_CLIENT.FROM_ENV();
  console.log(
    `Watching ${amount_in} ${token_in} -> ${token_out} for ${seconds}s via ${client.BASE_URL_VALUE()} ...`,
  );
  console.log("(live quotes — the server pushes on every pool change that moves the result)");

  const started = Date.now();
  const elapsed = (): string => ((Date.now() - started) / 1000).toFixed(1);
  let updates = 0;
  let route_updates = 0;
  let errors = 0;
  let subscription: {
    url: string;
    id: number;
    close(): void;
    closed: Promise<void>;
  } | undefined;

  try {
    subscription = await SUBSCRIBE_ROUTES(client, params, {
      on_update: (update) => {
        updates++;
        if (update.kind === "error") {
          errors++;
          console.log(`\n[${elapsed()}s] server error: ${update.message}`);
          return;
        }
        route_updates++;
        console.log(`\n[${elapsed()}s] update #${route_updates}: ${update.routes.length} route(s)`);
        console.log(format_routes(update.routes));
        console.log(`    ${describe_best(update.routes)}`);
      },
      on_error: (error) => {
        console.error(`\nsocket error: ${error.message}`);
      },
      on_close: (info) => {
        if (info.code !== undefined) {
          console.log(`\nsocket closed (code ${info.code}${info.reason ? `, ${info.reason}` : ""})`);
        }
      },
    });
    console.log(`socket open: ${subscription.url} (request id ${subscription.id})`);

    // Ctrl-C should close the socket rather than kill the process.
    const on_sigint = () => {
      console.log("\nstopping...");
      subscription?.close();
    };
    process.once("SIGINT", on_sigint);
    try {
      await Promise.race([
        subscription.closed,
        new Promise<void>((resolve) => setTimeout(resolve, seconds * 1000)),
      ]);
    } finally {
      process.off("SIGINT", on_sigint);
    }
    subscription.close();
    await subscription.closed;
  } catch (err) {
    if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
      console.error(FORMAT_DEX_AGGREGATOR_ERROR(err.error));
    } else {
      console.error(err);
    }
    process.exit(1);
  }

  console.log(
    `\ndone: ${route_updates} route update(s), ${errors} server error(s), ${updates} message(s) in ${elapsed()}s`,
  );
  if (route_updates === 0) {
    console.log(
      "no quotes arrived — check the token pair, or that the router considers any DEX able to serve it",
    );
  }
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