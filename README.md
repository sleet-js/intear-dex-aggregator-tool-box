# intear-dex-aggregator-tool-box

🟦 Typed **TypeScript** tool box for the [intear dex-aggregator](https://docs.intear.tech/docs/dex-aggregator/) (`GET https://router.intear.tech/route`), designed to be used **with [near-kit](https://github.com/r-near/near-kit) and [near-kit-tool-box-ts](https://github.com/sleet-js/near-kit-tool-box)**: quote routes through this crate's client, sign + send them with your near-kit `Near` client.

ℹ️ quoting is read-only (no credentials). Executing needs a funded **mainnet** signer — the router is mainnet only. `Near` types from `near-kit` (0.20+) plug straight in.

---

## HOW TO USE

### 0. Install

```bash
bun add intear-dex-aggregator-tool-box
# peer-style usage with near-kit + near-connect (browser):
bun add near-kit @hot-labs/near-connect
```

Runs on Bun 1.x and Node 18+ (only runtime constraint is `fetch` + `Uint8Array`).

### 1. Configure the client once

Things that stay constant across trades (`referrer_id`, default DEX allow-list, wait budget, api key) live on the client. Everything that differs per trade lives on `QUOTE_PARAMS`.

```ts
import {
  DEX_AGGREGATOR_CLIENT,
  AMOUNT_IN,
} from "intear-dex-aggregator-tool-box";

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
} from "intear-dex-aggregator-tool-box";

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

Two named entry points, one per execution strategy — pick the one that matches how your `Near` (or wallet) signs transactions:

- `EXECUTE_ROUTE_SEQUENTIAL(near, route, opts)` — backend / CLI path. The same `Near` you already use (built directly, or via `near_kit_client` / `near_kit_env` from `near-kit-tool-box-ts`). Each `NearTransaction` instruction becomes one multi-action transaction with the router's exact gas + deposit, sent **sequentially** in instruction order.
- `EXECUTE_ROUTE_BATCHED(wallet, route, opts)` — browser path. Hands the wallet an array of prebuilt transactions and lets it batch them into **one popup** via `wallet.signAndSendTransactions({ transactions: [...] })`. This is the only way to ship a multi-leg swap through a NEAR Connect / Intear Wallet session without N popups in a row (`near-kit`'s `Near` only exposes the singular `signAndSendTransaction`).

Fee instructions (`is_fee_transaction: true` on the router, or `continue_if_failed: true` for forward-compat) are skipped on failure in both paths; anything else aborts. `verbose` is opt-in on both paths (defaults to `false` — the library is silent unless you ask for a trace).

```ts
import {
  EXECUTE_ROUTE_SEQUENTIAL,
  DEX_AGGREGATOR_CLIENT_ERROR,
} from "intear-dex-aggregator-tool-box";
import { Near } from "near-kit";
// or for a browser: import { near_connect_client } from "@near-kit-tool-box/web";

const near = new Near({
  network: "mainnet",
  privateKey: "ed25519:...",
  defaultSignerId: "you.near",
});

try {
  const outcomes = await EXECUTE_ROUTE_SEQUENTIAL(near, best, {
    verbose: true, // opt-in: log every leg as it sends
  });
  for (const outcome of outcomes) {
    console.log(outcome.transaction?.hash, "/", outcome.status);
  }
} catch (err) {
  if (err instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
    // typed: kind === "near" / "route_not_found" / "http" / ...
  }
}
```

#### Browser path (one popup per route)

```ts
import {
  EXECUTE_ROUTE_BATCHED,
} from "intear-dex-aggregator-tool-box";
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

### 4. Try the interactive bin

```bash
cp .env.example .env   # no credentials needed just to quote
set -a; source .env; set +a

# quote + pick a route + dry-run preview (default pair: 0.1 NEAR -> USDT)
bun run swap

# custom pair / route-not-found demo (unknown token -> router answers `[]`)
bun run swap near 100000000000000000000000 usdt.tether-token.near
bun run swap near 100000000000000000000000 this-token-does-not-exist-xyz123.near

# execute the picked route (funded mainnet signer required)
bun run swap near 100000000000000000000000 usdt.tether-token.near --execute
```

The bin prints a route table (`# | dex | estimated | worst-case | plan | exec | out`), prompts for the route number (default = best), previews every decoded transaction, then either stops (dry run) or sends.

### 5. Run the HTML UI demo

A browser-only demo lives in [`html/`](./html). It uses `@near-kit-tool-box/web` for the wallet and this crate for the dex-aggregator. No bundler — Bun compiles the entrypoint directly into a single self-contained `dist/index.html`.

```bash
cd html
bun install

bun build --compile --target=browser ./index.html --outdir ./dist

cd dist && python3 -m http.server 5180 --bind 0.0.0.0
# → http://localhost:5180/ — connect wallet, paste any token
# contract pair (defaults: shit-1170.meme-cooking.near → wrap.near,
# referrer ref.huggies.near), click GET ROUTES, click EXECUTE per route
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

Verified live responses (run `bun run swap near 100000000000000000000000 usdt.tether-token.near`):

- known pair (`near -> usdt.tether-token.near`, 0.1 NEAR) → `200` with 3+ routes (`Plach`, `Rhea`, `RheaDcl`), estimates + `NearTransaction` instructions.
- unknown token (`near -> this-token-does-not-exist-xyz123.near`) → `200` with `[]` → `route_not_found`.

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
