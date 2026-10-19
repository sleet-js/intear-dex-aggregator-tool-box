# intear dex-aggregator tool box — HTML demo

🌐 Tiny browser UI for the dex-aggregator tool box. Connects via the wallet exposed by `@near-kit-tool-box/web`, types `token in` / `amount in` / `token out` / `referrer`, hits `https://router.intear.tech`, then renders every route with full details and an EXECUTE button per route.

Plain HTML + TypeScript (no React/Preact, no bundler). Bun's HTML dev server runs it directly.

### Defaults

- token in: `shit-1170.meme-cooking.near`
- amount in: `100000000000000000000000` (0.1 NEAR, raw yocto)
- token out: `wrap.near`
- referrer: `ref.huggies.near`

You can paste any token contract into the inputs. Mainnet only — the tool box defaults to mainnet on first visit.

### DEV

```sh
bun install
bun run dev               # → http://localhost:3000/

# custom port / host (LAN):
bun --port 5180 ./index.html
```

The dev server is `bun run index.html` — Bun reads the `<script type="module" src="./src/index.ts">` tag from `index.html`, transpiles the TypeScript on the fly, and serves it. No bundler, no config.

### What you get

- **`LOGIN`** — opens the wallet popup, signs in.
- **`GET ROUTES`** — quotes every viable DEX, prints the full JSON of each route in a `<details>` block, plus a per-route preview of every `NearTransaction` instruction.
- **`EXECUTE ROUTE #n`** — sends the chosen route using the connected wallet (one popup per `NearTransaction` instruction).

### Pattern reference

`src/auth.ts` mirrors your sleet-svelte `setup-near-kit` `button_auth.svelte` line for line — `near_connect_client().wallet().getAccounts()` / `.connect()` / `.signOut()`. The tool box already wires `@hot-labs/near-connect`, so no direct import of the wallet adapter is needed.

---

copyright 2026 by sleet.near
