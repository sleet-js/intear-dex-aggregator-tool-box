# @sleet-js/intear-dex-aggregator-tool-box

🟦 Typed **TypeScript** tool box for the [intear dex-aggregator](https://docs.intear.tech/docs/dex-aggregator/) (`GET https://router.intear.tech/route`), designed to be used **with [near-kit](https://github.com/r-near/near-kit) and [near-kit-tool-box-ts](https://github.com/sleet-js/near-kit-tool-box)**: quote routes through this crate's client, sign + send them with your near-kit `Near` client.

ℹ️ quoting is read-only (no credentials). Executing needs a funded **mainnet** signer — the router is mainnet only. `Near` types from `near-kit` (0.20+) plug straight in.

Covers the whole documented API surface:

| Endpoint | Support |
|---|---|
| `GET /route` | ✅ `GET_ROUTES` / `GET_BEST_ROUTE` |
| `wss://…/route/subscribe` | ✅ `SUBSCRIBE_ROUTES` — live quotes |
| `GET /route/outcome` | ✅ `GET_ROUTE_OUTCOME` — what the swap actually did |
| fee legs (`is_fee_transaction`) | ✅ `EXECUTE_ROUTE_FULL` gates them on `charge_fee` |
| `signing_public_key` | ✅ parsed into `ROUTE_SIGNING`, nonces via `ROUTE_SIGNING_NONCES` |
| `fees` | ✅ `WITH_FEES`, validated against the router's limits |

---

## HOW TO USE

### 0. Install

```bash
bun add @sleet-js/intear-dex-aggregator-tool-box
# for the browser / wallet path (EXECUTE_ROUTE_BATCHED):
bun add @near-kit-tool-box/web
```

Runs on Bun 1.x and Node 18+ (only runtime constraint is `fetch` + `Uint8Array`).

### 1. Configure the client once

Things that stay constant across trades (`referrer_id`, default DEX allow-list, wait budget, api key) live on the client. Everything that differs per trade lives on `QUOTE_PARAMS`.

```ts
import {
  DEX_AGGREGATOR_CLIENT,
  AMOUNT_IN,
} from "@sleet-js/intear-dex-aggregator-tool-box";

// configure once (or DEX_AGGREGATOR_CLIENT.FROM_ENV() for env vars)
const client = new DEX_AGGREGATOR_CLIENT().WITH_REFERRER_ID("you.near");
```

### 2. Quote per trade

```ts
import {
  DEX_AGGREGATOR_CLIENT,
  AMOUNT_IN,
  GET_ROUTES,
  GET_BEST_ROUTE,
  WITH_TRADER_ACCOUNT_ID,
} from "@sleet-js/intear-dex-aggregator-tool-box";

const params = AMOUNT_IN(
  "near",                    // token_in (`near` or an NEP-141 contract id)
  "usdt.tether-token.near",  // token_out
  "100000000000000000000000", // amount_in in the token's smallest unit (0.1 NEAR)
).WITH_TRADER_ACCOUNT_ID("you.near"); // enables storage-deposit legs for execution

// all routes, best first (empty array = no DEX can serve the pair)
const routes = await GET_ROUTES(client, params);

// or the single best route (empty `[]` maps to a typed RouteNotFound error)
const best = await GET_BEST_ROUTE(client, params);
```

`AMOUNT_OUT` mode, auto slippage, DEX allow-lists, and per-trade referrer overrides are all on `QUOTE_PARAMS`.

### 3. Execute with your near-kit client

Three entry points. **Use `EXECUTE_ROUTE_FULL` unless you have a reason not to** — it is the one that does not pay referral fees on swaps that failed.

- **`EXECUTE_ROUTE_FULL(near, route, opts)`** — backend / CLI, and the only one that is correct for routes with fees. Runs the documented three phases: send the swap's transactions → ask `GET /route/outcome` → send the fee transactions only if it says `charge_fee: true` → check again and run the recovery `next_steps`.
- `EXECUTE_ROUTE_SEQUENTIAL(near, route, opts)` — backend, sends every leg in order and stops at the first failure. Fine for a route with no fee legs; on one that has them it will pay fees for a swap that never happened.
- `EXECUTE_ROUTE_BATCHED(wallet, route, opts)` — browser. Hands the wallet an array of prebuilt transactions and lets it batch them into **one popup** via `wallet.signAndSendTransactions({ transactions: [...] })`. This is the only way to ship a multi-leg swap through a NEAR Connect / Intear Wallet session without N popups in a row (`near-kit`'s `Near` only exposes the singular `signAndSendTransaction`).

#### Why the outcome check matters

The transaction carrying an `ft_transfer_call` swap **succeeds even when the DEX refunds it**. A refund shows up as `SuccessValue: "IjAi"` — a success, as far as a status check is concerned. So a swap can move zero tokens and still look perfect:

```
tx status: {"SuccessValue":"IjAi"}          ← reported as SUCCESS by a status check
outcome : charge_fee=false, amount_out=0    ← what actually happened
           error: "The price moved more than your slippage allows..."
```

That is also why fee legs must not be sent unconditionally. And when a swap from NEAR fails, the endpoint's `next_steps` return the recovery — here a `wrap.near::near_withdraw` that unwraps the wNEAR a successful `near_deposit` had already stranded:

```ts
import {
  EXECUTE_ROUTE_FULL,
  DEX_AGGREGATOR_CLIENT,
  DEX_AGGREGATOR_CLIENT_ERROR,
} from "@sleet-js/intear-dex-aggregator-tool-box";
import { near_kit_env } from "@near-kit-tool-box/env";

const client = new DEX_AGGREGATOR_CLIENT();

try {
  const result = await EXECUTE_ROUTE_FULL(near_kit_env, best, {
    client,
    token_in: "near",
    token_out: "usdt.tether-token.near",
    on_failure: "recover", // run next_steps and hand the tokens back
    verbose: true,
  });

  if (result.swap_succeeded) {
    console.log("got", result.final_outcome.amount_out);
    console.log("paid", result.fee_outcomes.length, "fee transaction(s)");
  } else {
    // recovered: the trader is back to their starting balances
    console.log("swap failed:", result.outcome.error);
  }
} catch (err) {
  if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
    // kind === "swap_failed"          the swap did not go through
    // kind === "outcome_unavailable"  the CHECK failed — the swap may be fine
    // kind === "near"                 a transaction itself failed
  }
}
```

`on_failure` is `"throw"` (default), `"recover"`, or `"ignore"`. Fees are withheld in all three — the choice is only about what happens to a failed swap.

#### Raw sequential / batched

```ts
import { EXECUTE_ROUTE_SEQUENTIAL } from "@sleet-js/intear-dex-aggregator-tool-box";
import { Near } from "near-kit";

const near = new Near({
  network: "mainnet",
  privateKey: "ed25519:...",
  defaultSignerId: "you.near",
});

const outcomes = await EXECUTE_ROUTE_SEQUENTIAL(near, best, { verbose: true });
```

`NEAR_PRIVATE_KEY` must be the 64-byte secret key — `ed25519:` followed by ~88 base58 characters. The account's *public* key is accepted by near-kit's validator and then fails with an opaque `HTTP 400`; `.env.example` says so too.

### 4. Live quotes over the WebSocket

A quote is only good for a few seconds — pools change every block. `SUBSCRIBE_ROUTES` opens `wss://router.intear.tech/route/subscribe` and pushes a fresh best-first array every time a pool change moves the result, so a swap form re-renders without polling.

Needs no credentials.

```ts
import { DEX_AGGREGATOR_CLIENT, SUBSCRIBE_ROUTES, AMOUNT_IN } from "@sleet-js/intear-dex-aggregator-tool-box";

const client = new DEX_AGGREGATOR_CLIENT();
const sub = await SUBSCRIBE_ROUTES(
  client,
  AMOUNT_IN("near", "usdt.tether-token.near", "10000000000000000000000"),
  {
    on_update: (update) => {
      if (update.kind === "error") return show_error(update.message);
      render(update.routes[0]?.estimated_amount);
    },
  },
);

// later
sub.close();
await sub.closed;
```

Updates arrive only when the result changes, and the server throttles re-routing to ~10× the routing time (max 3s). An invalid query answers in-band (`{ kind: "error" }`) and leaves the socket open, so one bad request needs no reconnect. Each call owns its socket and request id, so you cannot be tripped by an update for a request you superseded.

`WebSocket` is global in Node 22+, Bun, Deno and browsers. On Node 18 pass `{ socket_factory }`.

### 5. Browser path (one popup per route)

```ts
import {
  EXECUTE_ROUTE_BATCHED,
} from "@sleet-js/intear-dex-aggregator-tool-box";
import { near_connect_client } from "@near-kit-tool-box/web";

const wallet = await near_connect_client().wallet();
// signer_id must be passed explicitly — read it from
// `wallet.getAccounts()` (or your own state) before calling.
const [{ accountId: signer_id }] = await wallet.getAccounts();
const outcomes = await EXECUTE_ROUTE_BATCHED(wallet, best, {
  signer_id,
  verbose: true,
});
```

`EXECUTE_ROUTE_BATCHED` does the runtime check for `wallet.signAndSendTransactions` (plural) inside the package and throws a typed `DEX_AGGREGATOR_CLIENT_ERROR` if the connected session doesn't support batching — prompt the user to reconnect a NEAR Connect / Intear Wallet session.

### 6. Try the interactive bins

`.env` is loaded by [`@near-kit-tool-box/env`](https://github.com/sleet-js/near-kit-tool-box), so there is nothing to `source`.

```bash
cp .env.example .env   # no credentials needed just to quote

# quote + pick a route + dry-run preview (default pair: 0.1 NEAR -> USDT)
bun run swap

# custom pair / route-not-found demo (unknown token -> router answers `[]`)
bun run swap near 100000000000000000000000 usdt.tether-token.near
bun run swap near 100000000000000000000000 this-token-does-not-exist-xyz123.near

# execute the picked route (funded mainnet signer required)
bun run swap near 100000000000000000000000 usdt.tether-token.near --execute

# watch live quotes over the WebSocket (no credentials needed)
bun run subscribe near 10000000000000000000000 usdt.tether-token.near 30
```

```
$ bun run subscribe near 10000000000000000000000 usdt.tether-token.near 12
Watching 10000000000000000000000 near -> usdt.tether-token.near for 12s ...
socket open: wss://router.intear.tech/route/subscribe (request id 1)

[0.4s] update #1: 3 route(s)
    0. Rhea                     49747 out worst                  49249  1 tx  -> nep141:usdt.tether-token.near
    1. RheaDcl                  50117 out worst                  49615  1 tx  -> nep141:usdt.tether-token.near
    2. Plach                    49995 out worst                  49495  1 tx  -> nep141:usdt.tether-token.near
    best Rhea: 49747 out (worst 49249) | 1 tx | output nep141:usdt.tether-token.near

done: 1 route update(s), 0 server error(s), 1 message(s) in 12.0s
```

The bin prints a route table (`# | dex | estimated | worst-case | plan | exec | out`), prompts for the route number (default = best), previews every decoded transaction, then either stops (dry run) or sends.

### 5. Run the HTML UI demo

A browser-only demo lives in [`html/`](./html). It uses `@near-kit-tool-box/web` for the wallet and this crate for the dex-aggregator. Bun's dev server serves the entrypoint directly — no bundler or build step.

```bash
cd html
bun install
bun run html/index.html   
```

See [`html/README.md`](./html/README.md) for details and the full list of UX knobs.

---

## ERROR HANDLING

All failures surface as a single typed class: `DEX_AGGREGATOR_CLIENT_ERROR` whose `.error` field is a discriminated `DEX_AGGREGATOR_ERROR` union:

| `kind` | Meaning |
|---|---|
| `route_not_found` | Router answered `200` with `[]` — no DEX serves the pair/amount. Check token ids (testnet tokens unsupported), try `amount_in` mode, a smaller amount, or more DEXes. |
| `invalid_params` | Empty token id, same `token_in` / `token_out`, or amount = 0 — caught before the request. |
| `http` | Transport failure or non-2xx router status (with body snippet). |
| `parse` | Body was not a route array (with body snippet). |
| `base64_decode` / `invalid_number` | Malformed instruction payload. |
| `near` | Wraps an error from `near-kit` during signing / sending. |
| `swap_failed` | The swap did not go through, per `GET /route/outcome`. Carries the router's trader-facing `message`, the actual `amount_in` / `amount_out`, and `next_steps` that move anything stranded back to the trader. |
| `outcome_unavailable` | The outcome **check** could not complete (60s budget, malformed request). The swap may well have succeeded — do not report it as failed. |

The last two are deliberately distinct: one means the swap failed, the other means we could not tell. Collapsing them is how a working swap gets reported as a failure.

```ts
try {
  const best = await client.GET_BEST_ROUTE(params);
} catch (err) {
  if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR && err.error.kind === "route_not_found") {
    // typed branch — show the user "no DEX serves this pair, try a smaller amount or a different token"
  } else {
    throw err;
  }
}
```

Verified live on mainnet against a real swap, both directions:

- **success** — `charge_fee: true`, `amount_out: 493252`, `next_steps: []`
- **refund** — transaction returned `SuccessValue: "IjAi"` (which a status check reads as success), `charge_fee: false`, `amount_out: 0`, `error: "The price moved more than your slippage allows…"`, `next_steps` → `wrap.near::near_withdraw` returning the stranded wNEAR

Quote-level responses:

- known pair (`near -> usdt.tether-token.near`, 0.1 NEAR) → `200` with 3 routes (`Rhea`, `RheaDcl`, `Plach`), estimates + `NearTransaction` instructions.
- unknown token (`near -> this-token-does-not-exist-xyz123.near`) → `200` with `[]` → `route_not_found`.
- with `signing_public_key` → each quote carries `signing: { nonce, block_hash }`; the nonce progression matches the account's on-chain access key.
- over the WebSocket → `{ id, routes }` updates, and `{ id, error }` in-band for a bad query with the socket left open.

---

### DEV

to develop and publish this package
```bash
bun install
bun run typecheck
bun run build
bun publish --dry-run
bunx npm login
bun publish --access public
```

---

## LINKS

- router docs: <https://docs.intear.tech/docs/dex-aggregator/>
- aggregator source: <https://github.com/INTEARnear/dex-aggregator>
- near-kit (TypeScript): <https://github.com/r-near/near-kit>
- near-kit tool box TS: <https://github.com/sleet-js/near-kit-tool-box>
- rust twin: <https://github.com/sleet-rs/intear-dex-aggregator-tool-box>

==================
<br/>
copyright 2026 by sleet.near
