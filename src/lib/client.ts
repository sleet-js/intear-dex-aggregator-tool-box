// =================================================
// client
// Reusable client for the intear dex-aggregator `GET /route` API.
//
// Configure once (`referrer_id`, default `dexes`, wait budget, API
// key); every trade then only passes a `QUOTE_PARAMS` with the fields
// that differ per swap.
//
// The client holds no signer — signing stays with your near-kit `Near`
// instance (built directly or via `near_kit_client` / `near_kit_env`
// from near-kit-tool-box-ts), which you hand to
// `EXECUTE_ROUTE_SEQUENTIAL` separately. This keeps quoting (read-
// only, no credentials) cleanly apart from executing (needs a mainnet
// signer). For the browser path, hand a wallet from
// `@hot-labs/near-connect` to `EXECUTE_ROUTE_BATCHED` instead.
// =================================================
import {
  FORMAT_DEX_AGGREGATOR_ERROR,
  type DEX_AGGREGATOR_ERROR,
} from "./error_type";
import {
  DESCRIBE_AMOUNT,
  fees_to_query,
  type QUOTE_PARAMS,
} from "./quote_params_type";
import {
  COERCE_ROUTE,
  type ROUTE,
} from "./route_response_type";
import {
  COERCE_SWAP_OUTCOME,
  type OUTCOME_PARAMS,
  type SWAP_OUTCOME,
} from "./outcome_response_type";
// =================================================
/** A typed error class so it can be `instanceof`-checked and `throw`n
 *  just like a normal error. Always carries a typed `error: DEX_AGGREGATOR_ERROR`
 *  field for exhaustive matching. */
export class DEX_AGGREGATOR_CLIENT_ERROR extends Error {
  override readonly name = "DEX_AGGREGATOR_CLIENT_ERROR";
  readonly error: DEX_AGGREGATOR_ERROR;
  constructor(error: DEX_AGGREGATOR_ERROR) {
    super(FORMAT_DEX_AGGREGATOR_ERROR(error));
    this.error = error;
  }
}
// =================================================
/** Default router base url. */
export const DEX_AGGREGATOR_BASE_URL = "https://router.intear.tech";
/** Default per-request wait budget (ms). */
export const DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS = 2000;
/** Known DEX ids the router may quote (allow-list values for `dexes`). */
export const DEX_AGGREGATOR_KNOWN_DEXES =
  "Rhea,Aidols,Wrap,RheaDcl,MetaPool,Linear,XRhea,RNear,Plach";
// =================================================
/** Reusable client for the intear dex-aggregator `GET /route` API.
 *
 *  Use `WITH_*` builders to set options once, then call `GET_ROUTES`
 *  per trade. The client holds no signer — quoting is read-only.
 *
 *  @example
 *  ```ts
 *  import {
 *    DEX_AGGREGATOR_CLIENT,
 *    AMOUNT_IN,
 *  } from "intear-dex-aggregator-tool-box";
 *
 *  const client = new DEX_AGGREGATOR_CLIENT().WITH_REFERRER_ID("you.near");
 *  const params = AMOUNT_IN(
 *    "near",
 *    "usdt.tether-token.near",
 *    "100000000000000000000000",
 *  );
 *  const routes = await client.GET_ROUTES(params);
 *  ``` */
export class DEX_AGGREGATOR_CLIENT {
  private base_url: string;
  private referrer_id?: string;
  private default_dexes?: string;
  private default_max_wait_ms: number;
  private api_key?: string;
  private readonly fetch_impl: typeof fetch;
  // =================================================
  constructor(
    options: {
      base_url?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.base_url = (options.base_url ?? DEX_AGGREGATOR_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.default_max_wait_ms = DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS;
    this.fetch_impl = options.fetch ?? globalThis.fetch;
    if (!this.fetch_impl) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "no fetch implementation available (pass { fetch } in a Node environment)",
      });
    }
  }
  // =================================================
  /** Point at a custom router base url (default `https://router.intear.tech`). */
  WITH_BASE_URL(base_url: string): this {
    const cleaned = base_url.trim().replace(/\/+$/, "");
    this.base_url = cleaned;
    return this;
  }
  /** Credit this account as referrer on every quote (per-trade
   *  `QUOTE_PARAMS.referrer_id` still wins when set). */
  WITH_REFERRER_ID(referrer_id: string): this {
    this.referrer_id = referrer_id;
    return this;
  }
  /** Restrict every quote to a comma-separated DEX allow-list
   *  (e.g. `"Rhea,RheaDcl,Plach"`). `undefined` uses all DEXes. */
  WITH_DEFAULT_DEXES(dexes: string): this {
    this.default_dexes = dexes;
    return this;
  }
  /** Default wait budget (ms) used when a trade sets no `max_wait_ms`. */
  WITH_MAX_WAIT_MS(max_wait_ms: number): this {
    this.default_max_wait_ms = max_wait_ms;
    return this;
  }
  /** API key for unlimited usage (sent as `&key=...`). */
  WITH_API_KEY(api_key: string): this {
    this.api_key = api_key;
    return this;
  }
  // =================================================
  /** Build a client from environment variables (Node/Bun/Deno):
   *  `DEX_AGGREGATOR_BASE_URL`, `DEX_AGGREGATOR_REFERRER_ID`,
   *  `DEX_AGGREGATOR_DEXES`, `DEX_AGGREGATOR_MAX_WAIT_MS`,
   *  `DEX_AGGREGATOR_API_KEY`. The `DEX_AGG_*` short aliases are
   *  accepted too. */
  static FROM_ENV(
    env: Record<string, string | undefined> = globalThis.process?.env ?? {},
  ): DEX_AGGREGATOR_CLIENT {
    const client = new DEX_AGGREGATOR_CLIENT();
    const base_url = env["DEX_AGGREGATOR_BASE_URL"] ?? env["DEX_AGG_BASE_URL"];
    if (base_url) client.WITH_BASE_URL(base_url);
    const referrer =
      env["DEX_AGGREGATOR_REFERRER_ID"] ?? env["DEX_AGG_REFERRER_ID"];
    if (referrer) client.WITH_REFERRER_ID(referrer);
    const dexes = env["DEX_AGGREGATOR_DEXES"] ?? env["DEX_AGG_DEXES"];
    if (dexes) client.WITH_DEFAULT_DEXES(dexes);
    const wait = env["DEX_AGGREGATOR_MAX_WAIT_MS"] ?? env["DEX_AGG_MAX_WAIT_MS"];
    if (wait) {
      const ms = Number(wait);
      if (Number.isFinite(ms)) client.WITH_MAX_WAIT_MS(ms);
    }
    const key = env["DEX_AGGREGATOR_API_KEY"] ?? env["DEX_AGG_API_KEY"];
    if (key) client.WITH_API_KEY(key);
    return client;
  }
  // =================================================
  /** Router base url in use. */
  BASE_URL_VALUE(): string {
    return this.base_url;
  }
  /** Configured default referrer, if any. */
  REFERRER_ID_VALUE(): string | undefined {
    return this.referrer_id;
  }
  /** Configured api key, if any. The `/route/subscribe` WebSocket
   *  takes its key in the URL rather than in a message's query, so
   *  `SUBSCRIBE_ROUTES` reads it from here. */
  API_KEY_VALUE(): string | undefined {
    return this.api_key;
  }
  // =================================================
  /** Build the query pairs for one trade, layering per-trade values
   *  over client defaults. Pure helper exposed for callers that want
   *  to reuse the same query logic in their own HTTP layer. */
  BUILD_QUERY_PAIRS(params: QUOTE_PARAMS): URLSearchParams {
    const q = new URLSearchParams();
    q.set("token_in", params.token_in);
    q.set("token_out", params.token_out);
    if (params.amount.kind === "in") {
      q.set("amount_in", params.amount.amount_in);
    } else {
      q.set("amount_out", params.amount.amount_out);
    }
    const max_wait = params.max_wait_ms ?? this.default_max_wait_ms;
    q.set("max_wait_ms", String(max_wait));
    if (params.slippage.kind === "fixed") {
      q.set("slippage_type", "Fixed");
      q.set("slippage", String(params.slippage.slippage));
    } else {
      q.set("slippage_type", "Auto");
      q.set("max_slippage", String(params.slippage.max_slippage));
      q.set("min_slippage", String(params.slippage.min_slippage));
    }
    const dexes = params.dexes ?? this.default_dexes;
    if (dexes && dexes.trim().length > 0) q.set("dexes", dexes);
    if (params.trader_account_id && params.trader_account_id.trim().length > 0) {
      q.set("trader_account_id", params.trader_account_id);
    }
    // Validated against the router's limits here, so a breach is a
    // typed invalid_params error rather than an opaque 400.
    const fees = fees_to_query(params.fees);
    if (fees !== undefined) q.set("fees", fees);
    if (params.signing_public_key && params.signing_public_key.trim().length > 0) {
      q.set("signing_public_key", params.signing_public_key);
    }
    const referrer = params.referrer_id ?? this.referrer_id;
    if (referrer && referrer.trim().length > 0) {
      q.set("referrer_id", referrer);
    }
    if (this.api_key) q.set("key", this.api_key);
    return q;
  }
  // =================================================
  /** Fetch all quoted routes for a trade (best first). Returns an
   *  empty array when no DEX can serve the pair — use `GET_BEST_ROUTE`
   *  when you want that case as a typed `RouteNotFound` error. */
  async GET_ROUTES(params: QUOTE_PARAMS): Promise<ROUTE[]> {
    if (params.token_in.trim().length === 0 || params.token_out.trim().length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "token_in and token_out must both be non-empty",
      });
    }
    if (params.token_in.trim() === params.token_out.trim()) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "token_in and token_out must be different",
      });
    }
    if (params.amount.kind === "in" && params.amount.amount_in.trim() === "0") {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "amount_in must be greater than 0",
      });
    }
    if (params.amount.kind === "out" && params.amount.amount_out.trim() === "0") {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "amount_out must be greater than 0",
      });
    }
    const qs = this.BUILD_QUERY_PAIRS(params);
    const url = `${this.base_url}/route?${qs.toString()}`;
    // Browser `fetch` enforces strict `this`-binding to the global
    // object. Detached calls fail with `Illegal invocation` on Chrome
    // (Android) and Safari; Node/Bun ignore it, so this slips past
    // typecheck. Reflect.apply preserves the receiver across runtimes.
    const res = await Reflect.apply(this.fetch_impl, globalThis, [
      url,
      { method: "GET" },
    ]);
    if (!res.ok) {
      const body = await safe_text(res);
      const snippet = body.slice(0, 300);
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "http",
        message: `router answered ${res.status} ${res.statusText}: ${snippet}`,
      });
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "parse",
        message: `response was not JSON: ${(cause as Error)?.message ?? cause}`,
      });
    }
    if (!Array.isArray(raw)) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "parse",
        message: `expected a JSON array of routes, got ${typeof raw}`,
      });
    }
    const routes: ROUTE[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        throw new DEX_AGGREGATOR_CLIENT_ERROR({
          kind: "parse",
          message: "each route must be an object",
        });
      }
      routes.push(COERCE_ROUTE(entry as Record<string, unknown>));
    }
    return routes;
  }
  // =================================================
  /** Fetch the single best route for a trade. Maps the router's empty
   *  array (`[]`) to a typed `RouteNotFound` error so callers can
   *  distinguish "unknown / unserved pair" from transport failures. */
  async GET_BEST_ROUTE(params: QUOTE_PARAMS): Promise<ROUTE> {
    const routes = await this.GET_ROUTES(params);
    if (routes.length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "route_not_found",
        token_in: params.token_in,
        token_out: params.token_out,
        amount_desc: DESCRIBE_AMOUNT(params.amount),
        hint:
          "router returned []. Check both token ids (testnet tokens are unsupported — the router is mainnet only), try amount_in mode, a smaller amount, or more dexes.",
      });
    }
    return routes[0]!;
  }
  // =================================================
  /** Ask the router what a route's transactions actually did on chain.
   *
   *  The endpoint waits (up to 60s) for every transaction and receipt
   *  to execute, then compares the trader's balances before the first
   *  transaction's block with the balances after the last receipt's
   *  block. That is the only reliable way to see a refund: the
   *  transaction carrying an `ft_transfer_call` swap still succeeds
   *  when the DEX refunds it, so `SuccessValue` looks like success.
   *
   *  Two things callers usually want:
   *
   *  - `charge_fee` — send the route's fee transactions only when
   *    `true`. A swap that failed on chain still lets its own
   *    transaction succeed, so a failed swap does not stop the fees
   *    from being sent unless you check.
   *  - `next_steps` — instructions that move whatever ended up
   *    somewhere else back (for example the `near_withdraw` that
   *    unwraps wNEAR stranded by a failed NEAR swap). They are
   *    ordinary `EXECUTION_INSTRUCTION`s, executable with the same
   *    helpers as a route's own instructions.
   *
   *  @example
   *  ```ts
   *  const outcome = await client.GET_ROUTE_OUTCOME({
   *    token_in: "near",
   *    token_out: "usdt.tether-token.near",
   *    trader_account_id: "you.near",
   *    tx_hashes: outcomes.map((o) => o.transaction!.hash),
   *    fee_amount: route.fee_amount ?? "0",
   *  });
   *  if (outcome.charge_fee) { /* send the fee legs *\/ }
   *  else { /* show outcome.error, run outcome.next_steps *\/ }
   *  ```
   *
   *  @param params The ids of the original route request, the trader's
   *    hashes (without the fee transactions), and optionally
   *    `fee_amount` and `wait_until`.
   *  @throws `DEX_AGGREGATOR_CLIENT_ERROR` with `kind: "invalid_params"`
   *    on an empty or over-long `tx_hashes` list, or on
   *    `token_in === token_out`.
   *  @throws `DEX_AGGREGATOR_CLIENT_ERROR` with `kind: "http"` if the
   *    router cannot answer within its budget (a `504` here means the
   *    *check* failed, not that the swap failed).
   */
  async GET_ROUTE_OUTCOME(params: OUTCOME_PARAMS): Promise<SWAP_OUTCOME> {
    if (params.token_in.trim().length === 0 || params.token_out.trim().length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "token_in and token_out must both be non-empty",
      });
    }
    if (params.token_in.trim() === params.token_out.trim()) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "token_in and token_out must be different",
      });
    }
    if (params.trader_account_id.trim().length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "trader_account_id must be non-empty",
      });
    }
    const hashes = params.tx_hashes
      .map((h) => h.trim())
      .filter((h) => h.length > 0);
    if (hashes.length === 0) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "tx_hashes must have 1 to 20 transaction hashes",
      });
    }
    if (hashes.length > 20) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: `tx_hashes must have 1 to 20 transaction hashes, got ${hashes.length}`,
      });
    }
    if (new Set(hashes).size !== hashes.length) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "invalid_params",
        message: "tx_hashes must not repeat a transaction",
      });
    }
    const qs = new URLSearchParams();
    qs.set("token_in", params.token_in);
    qs.set("token_out", params.token_out);
    qs.set("trader_account_id", params.trader_account_id);
    qs.set("tx_hashes", hashes.join(","));
    const fee_amount = params.fee_amount?.trim();
    qs.set("fee_amount", fee_amount && fee_amount.length > 0 ? fee_amount : "0");
    if (params.wait_until === "swap") qs.set("wait_until", "swap");
    if (this.api_key) qs.set("key", this.api_key);
    const url = `${this.base_url}/route/outcome?${qs.toString()}`;
    const res = await Reflect.apply(this.fetch_impl, globalThis, [
      url,
      { method: "GET" },
    ]);
    if (!res.ok) {
      const body = await safe_text(res);
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "http",
        message: `route/outcome answered ${res.status} ${res.statusText}: ${body.slice(0, 300)}`,
      });
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "parse",
        message: `route/outcome response was not JSON: ${(cause as Error)?.message ?? cause}`,
      });
    }
    try {
      return COERCE_SWAP_OUTCOME(raw);
    } catch (cause) {
      throw new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "parse",
        message: `route/outcome response was malformed: ${(cause as Error)?.message ?? cause}`,
      });
    }
  }
}
// =================================================
async function safe_text(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
// =================================================
// copyright 2026 by sleet.near