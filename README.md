# intear-dex-aggregator-tool-box

🟦 Typed **TypeScript** tool box for the [intear dex-aggregator](https://docs.intear.tech/docs/dex-aggregator/) (`GET https://router.intear.tech/route`), designed to be used **with [near-kit](https://github.com/r-near/near-kit) and [near-kit-tool-box-ts](https://github.com/sleet-js/near-kit-tool-box)**: quote routes through this crate's client, sign + send them with your near-kit `Near` client.

ℹ️ quoting is read-only (no credentials). Executing needs a funded **mainnet** signer — the router is mainnet only. A TypeScript port of the [Rust tool box](https://github.com/sleet-rs/intear-dex-aggregator-tool-box): same shape, same URL, same wire format — `Near` types from `near-kit` (0.20+) plug straight in.

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

Things that stay constant across trades (`referrer_id`, default DEX allow-list, wait budget, api key) live on the client. Everything that differs per trade lives on `QuoteParams`.

```ts
import {
  DexAggregatorClient,
  amountIn,
} from "intear-dex-aggregator-tool-box";

// configure once (or DexAggregatorClient.fromEnv() for env vars)
const client = new DexAggregatorClient().withReferrerId("you.near");
```

### 2. Quote per trade

```ts
import {
  DexAggregatorClient,
  amountIn,
  getRoutes,
  getBestRoute,
  withTraderAccountId,
} from "intear-dex-aggregator-tool-box";

const params = amountIn(
  "near",                    // token_in (`near` or an NEP-141 contract id)
  "usdt.tether-token.near",  // token_out
  "100000000000000000000000", // amount_in in the token's smallest unit (0.1 NEAR)
).withTraderAccountId("you.near"); // enables storage-deposit legs for execution

// all routes, best first (empty array = no DEX can serve the pair)
const routes = await getRoutes(client, params);

// or the single best route (empty `[]` maps to a typed RouteNotFound error)
const best = await getBestRoute(client, params);
```

`amountOut` mode, auto slippage, DEX allow-lists, and per-trade referrer overrides are all on `QuoteParams`.

### 3. Execute with your near-kit client

`executeRoute` takes the same `Near` you already use — built directly, or via `near_kit_client` (`near-kit-tool-box-ts/web`) or `near_kit_env` (`near-kit-tool-box-ts/env`) — all of them produce a `Near` that plugs straight in. Each `NearTransaction` instruction becomes one multi-action transaction with the router's exact gas + deposit, sent **sequentially** in instruction order. Fee instructions (`is_fee_transaction: true` on the router, or `continue_if_failed: true` for forward-compat) are skipped on failure; anything else aborts.

```ts
import {
  DexAggregatorClient,
  executeRoute,
  DexAggregatorClientError,
} from "intear-dex-aggregator-tool-box";
import { Near } from "near-kit";
// or for a browser: import { near_kit_client } from "@near-kit-tool-box/web";

const near = new Near({
  network: "mainnet",
  privateKey: "ed25519:...",
  defaultSignerId: "you.near",
});

try {
  const outcomes = await executeRoute(near, best);
  for (const outcome of outcomes) {
    console.log(outcome.transaction?.hash, "/", outcome.status);
  }
} catch (err) {
  if (err instanceof DexAggregatorClientError) {
    // typed: kind === "near" / "route_not_found" / "http" / ...
  }
}
```

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

A rsbuild-driven, browser-only demo lives in [`html/`](./html). It uses `@near-kit-tool-box/web` for the wallet, this crate for the dex-aggregator, and Sleetcss for the look. Same shape as `sleet-hot-hello/html`.

```bash
cd html
bun install
bun run dev   # http://localhost:5180 — connect wallet, paste any token
              # contract pair (defaults: shit-1170.meme-cooking.near → wrap.near,
              # referrer ref.huggies.near), click GET ROUTES, click EXECUTE per route
```

---

## ERROR HANDLING

All failures surface as a single typed class: `DexAggregatorClientError` whose `.error` field is a discriminated `DexAggregatorError` union:

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
  const best = await client.getBestRoute(params);
} catch (err) {
  if (err instanceof DexAggregatorClientError && err.error.kind === "route_not_found") {
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

## LAYOUT (mirrors the rust tool-box)

```
./
├── src/                                          # library
│   ├── index.ts                                  # re-exports
│   ├── lib/
│   │   ├── helper/
│   │   │   ├── dex_aggregator_client.ts          # DexAggregatorClient (getRoutes / getBestRoute)
│   │   │   ├── dex_aggregator_decode.ts          # base64 / gas / deposit converters
│   │   │   └── dex_aggregator_format.ts          # route table + preview printers
│   │   └── types/
│   │       ├── dex_aggregator_quote_params_type.ts    # QuoteParams + Slippage + with* builders
│   │       ├── dex_aggregator_route_response_type.ts  # Route + instructions + coerceRoute()
│   │       └── dex_aggregator_error_type.ts           # DexAggregatorError union + format helper
│   └── fun/
│       └── dex_aggregator/
│           ├── dex_aggregator_get_routes_fun_json.ts       # getRoutes / getBestRoute (1:1 parity with rs path)
│           └── dex_aggregator_execute_route_fun.ts         # executeRoute (near-kit send)
├── bin/                                          # top-level CLI bin (not part of lib)
│   └── dex_aggregator_swap_bin.ts                # interactive quote → pick → preview → execute
└── html/                                         # rsbuild browser demo with @near-kit-tool-box/web
    ├── package.json
    ├── rsbuild.config.ts
    ├── tsconfig.json
    ├── public/index.html
    └── src/{index.ts, ts/{auth, swap_form}.ts}
```

Notes vs the rs tool-box:

- **`is_fee_transaction` first**, falls back to **`continue_if_failed`** — the rs tool-box only knows `continue_if_failed`, which the router never actually emits (it emits `is_fee_transaction: true` instead). The TS decoder accepts both.
- Surfaces the router's `Quote` cost fields (`estimated_max_gas_cost`, `estimated_gas_usage`, `storage_deposits`, `max_storage_deposits`, `fee_amount`) so frontends can show "this will cost ~0.001 NEAR in gas + storage". The rs tool-box silently drops them today.
- Token id format mirrors the router's full surface: `near` for native, plus `nep141:`, `rhea-nep141:`, and `intear-dex:` prefixes — all passed through verbatim.
- The on-wire schema is checked against current upstream `dex-aggregator/src/types.rs` on every change.

`near-kit` peer dep is `^0.20.2`; the consumer is responsible for choosing browser (`@hot-labs/near-connect`) or backend (privateKey) signer.

---

## COMMANDS

```bash
bun install                                            # lib deps
bun run typecheck                                      # tsc --noEmit
bun run swap                                           # interactive bin (no creds)

cd html && bun install && bun run dev                  # rsbuild browser demo on :5180
cd html && bun run typecheck                           # html demo typecheck
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
