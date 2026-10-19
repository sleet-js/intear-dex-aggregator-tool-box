# intear dex-aggregator tool box — HTML demo

🌐 Tiny browser UI for the dex-aggregator tool box. Connects via Hot Wallet, types `token in` / `amount in` / `token out` / `referrer`, hits `https://router.intear.tech`, then renders every route with full details and an EXECUTE button per route.

Plain HTML + TypeScript (no React/Preact), bundled with [rsbuild](https://rsbuild.dev/). Same shape as [`sleet-hot-hello/html`](https://github.com/sleetplayground/sleet-hot-hello/tree/main/html).

### Defaults

- token in: `shit-1170.meme-cooking.near`
- amount in: `100000000000000000000000` (0.1 NEAR, raw yocto)
- token out: `wrap.near`
- referrer: `ref.huggies.near`

You can paste any token contract into the inputs.

### DEV

```sh
bun install
bun run dev
bun run build
bun run preview
bun run typecheck
```

### What you get

- **`GET ROUTES`** — quotes every viable DEX, prints the full JSON of each route in a `<details>` block, plus a per-route preview of every `NearTransaction` instruction.
- **`EXECUTE ROUTE #n`** — sends the chosen route using the connected wallet (one popup per `NearTransaction` instruction; the wallet decides how to batch).
- **`LOGIN`** — required before any execute (quoting is read-only).

---

copyright 2026 by sleet.near
