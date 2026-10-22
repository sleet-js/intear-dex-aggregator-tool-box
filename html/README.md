# intear dex-aggregator tool box — HTML demo

🌐 Tiny browser UI for the dex-aggregator tool box. Connects via the wallet exposed by `@near-kit-tool-box/web`, types `token in` / `amount in` / `token out` / `referrer`, hits `https://router.intear.tech`, then renders every route with full details and an EXECUTE button per route.

Plain HTML + TypeScript. No bundler, no script files, no package.json scripts.

### Defaults

- token in: `shit-1170.meme-cooking.near`
- amount in: `100000000000000000000000` (0.1 NEAR, raw yocto)
- token out: `wrap.near`
- referrer: `ref.huggies.near`

You can paste any token contract into the inputs. Mainnet only — the tool box defaults to mainnet on first visit.

### Run

```sh
bun install
# bun run index.html
bun run html/index.html
```

One command. Bun's dev server serves the entrypoint directly and transpiles the `.ts` imports on the fly — no bundler, no build step, no extra files.

### What you get

- **`LOGIN`** — opens the wallet popup, signs in.
- **`GET ROUTES`** — quotes every viable DEX, prints the full JSON of each route in a `<details>` block, plus a per-route preview of every `NearTransaction` instruction.
- **`EXECUTE ROUTE #n`** — sends the chosen route using the connected wallet in **one popup** (`EXECUTE_ROUTE_BATCHED`); all `NearTransaction` instructions for the route are batched into a single `signAndSendTransactions` call.

### Pattern reference

`src/auth.ts` mirrors your sleet-svelte `setup-near-kit` `button_auth.svelte` line for line — `near_connect_client().wallet().getAccounts()` / `.connect()` / `.signOut()`. The tool box already wires `@hot-labs/near-connect`, so no direct import of the wallet adapter is needed.

==================
<br/>
copyright 2026 by sleet.near
