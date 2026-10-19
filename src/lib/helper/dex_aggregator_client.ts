// =================================================
// dex_aggregator_client
// Reusable client for the intear dex-aggregator `GET /route` API.
//
// Configure once (`referrer_id`, default `dexes`, wait budget, API
// key); every trade then only passes a `QuoteParams` with the fields
// that differ per swap.
//
// The client holds no signer — signing stays with your near-kit `Near`
// instance (built directly or via `near_kit_client` / `near_kit_env`
// from near-kit-tool-box-ts), which you hand to `executeRoute`
// separately. This keeps quoting (read-only, no credentials) cleanly
// apart from executing (needs a mainnet signer).
// =================================================
import {
  formatDexAggregatorError,
  type DexAggregatorError,
} from "../types/dex_aggregator_error_type.ts";
import {
  describeAmount,
  type QuoteParams,
} from "../types/dex_aggregator_quote_params_type.ts";
import {
  coerceRoute,
  type Route,
} from "../types/dex_aggregator_route_response_type.ts";
// =================================================
/** A typed error class so it can be `instanceof`-checked and `throw`n
 *  just like a normal error. Always carries a typed `error: DexAggregatorError`
 *  field for exhaustive matching. */
export class DexAggregatorClientError extends Error {
  override readonly name = "DexAggregatorClientError";
  readonly error: DexAggregatorError;
  constructor(error: DexAggregatorError) {
    super(formatDexAggregatorError(error));
    this.error = error;
  }
}
// =================================================
// =================================================
/** Default router base url. */
export const DEX_AGGREGATOR_BASE_URL = "https://router.intear.tech";
/** Default per-request wait budget (ms). */
export const DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS = 2000;
/** Known DEX ids the router may quote (allow-list values for `dexes`).
 *  Mirrors the constants on the rs tool-box for cross-language parity. */
export const DEX_AGGREGATOR_KNOWN_DEXES =
  "Rhea,Aidols,Wrap,RheaDcl,MetaPool,Linear,XRhea,RNear,Plach";
// =================================================
/** Reusable client for the intear dex-aggregator `GET /route` API.
 *
 *  Use `with*` builders to set options once, then call `getRoutes`
 *  per trade. The client holds no signer — quoting is read-only.
 *
 *  @example
 *  ```ts
 *  import {
 *    DexAggregatorClient,
 *    amountIn,
 *  } from "intear-dex-aggregator-tool-box";
 *
 *  const client = new DexAggregatorClient().withReferrerId("you.near");
 *  const params = amountIn(
 *    "near",
 *    "usdt.tether-token.near",
 *    "100000000000000000000000",
 *  );
 *  const routes = await client.getRoutes(params);
 *  ``` */
export class DexAggregatorClient {
  private baseUrl: string;
  private referrerId?: string;
  private defaultDexes?: string;
  private defaultMaxWaitMs: number;
  private apiKey?: string;
  private readonly fetchImpl: typeof fetch;
  // =================================================
  constructor(
    options: {
      baseUrl?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.baseUrl = (options.baseUrl ?? DEX_AGGREGATOR_BASE_URL).replace(
      /\/+$/,
      "",
    );
    this.defaultMaxWaitMs = DEX_AGGREGATOR_DEFAULT_MAX_WAIT_MS;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new DexAggregatorClientError({
        kind: "invalid_params",
        message: "no fetch implementation available (pass { fetch } in a Node environment)",
      });
    }
  }
  // =================================================
  /** Point at a custom router base url (default `https://router.intear.tech`). */
  withBaseUrl(baseUrl: string): this {
    const cleaned = baseUrl.trim().replace(/\/+$/, "");
    this.baseUrl = cleaned;
    return this;
  }
  /** Credit this account as referrer on every quote (per-trade
   *  `QuoteParams.referrerId` still wins when set). */
  withReferrerId(referrerId: string): this {
    this.referrerId = referrerId;
    return this;
  }
  /** Restrict every quote to a comma-separated DEX allow-list
   *  (e.g. `"Rhea,RheaDcl,Plach"`). `undefined` uses all DEXes. */
  withDefaultDexes(dexes: string): this {
    this.defaultDexes = dexes;
    return this;
  }
  /** Default wait budget (ms) used when a trade sets no `maxWaitMs`. */
  withMaxWaitMs(maxWaitMs: number): this {
    this.defaultMaxWaitMs = maxWaitMs;
    return this;
  }
  /** API key for unlimited usage (sent as `&key=...`). */
  withApiKey(apiKey: string): this {
    this.apiKey = apiKey;
    return this;
  }
  // =================================================
  /** Build a client from environment variables (Node/Bun/Deno):
   *  `DEX_AGGREGATOR_BASE_URL`, `DEX_AGGREGATOR_REFERRER_ID`,
   *  `DEX_AGGREGATOR_DEXES`, `DEX_AGGREGATOR_MAX_WAIT_MS`,
   *  `DEX_AGGREGATOR_API_KEY`. The `DEX_AGG_*` short aliases are
   *  accepted too. */
  static fromEnv(
    env: Record<string, string | undefined> = globalThis.process?.env ?? {},
  ): DexAggregatorClient {
    const client = new DexAggregatorClient();
    const baseUrl = env["DEX_AGGREGATOR_BASE_URL"] ?? env["DEX_AGG_BASE_URL"];
    if (baseUrl) client.withBaseUrl(baseUrl);
    const referrer =
      env["DEX_AGGREGATOR_REFERRER_ID"] ?? env["DEX_AGG_REFERRER_ID"];
    if (referrer) client.withReferrerId(referrer);
    const dexes = env["DEX_AGGREGATOR_DEXES"] ?? env["DEX_AGG_DEXES"];
    if (dexes) client.withDefaultDexes(dexes);
    const wait = env["DEX_AGGREGATOR_MAX_WAIT_MS"] ?? env["DEX_AGG_MAX_WAIT_MS"];
    if (wait) {
      const ms = Number(wait);
      if (Number.isFinite(ms)) client.withMaxWaitMs(ms);
    }
    const key = env["DEX_AGGREGATOR_API_KEY"] ?? env["DEX_AGG_API_KEY"];
    if (key) client.withApiKey(key);
    return client;
  }
  // =================================================
  /** Router base url in use. */
  baseUrlValue(): string {
    return this.baseUrl;
  }
  /** Configured default referrer, if any. */
  referrerIdValue(): string | undefined {
    return this.referrerId;
  }
  // =================================================
  /** Build the query pairs for one trade, layering per-trade values
   *  over client defaults. Pure helper exposed for callers that want
   *  to reuse the same query logic in their own HTTP layer. */
  buildQueryPairs(params: QuoteParams): URLSearchParams {
    const q = new URLSearchParams();
    q.set("token_in", params.tokenIn);
    q.set("token_out", params.tokenOut);
    if (params.amount.kind === "in") {
      q.set("amount_in", params.amount.amountIn);
    } else {
      q.set("amount_out", params.amount.amountOut);
    }
    const maxWait = params.maxWaitMs ?? this.defaultMaxWaitMs;
    q.set("max_wait_ms", String(maxWait));
    if (params.slippage.kind === "fixed") {
      q.set("slippage_type", "Fixed");
      q.set("slippage", String(params.slippage.slippage));
    } else {
      q.set("slippage_type", "Auto");
      q.set("max_slippage", String(params.slippage.maxSlippage));
      q.set("min_slippage", String(params.slippage.minSlippage));
    }
    const dexes = params.dexes ?? this.defaultDexes;
    if (dexes && dexes.trim().length > 0) q.set("dexes", dexes);
    if (params.traderAccountId && params.traderAccountId.trim().length > 0) {
      q.set("trader_account_id", params.traderAccountId);
    }
    if (params.signingPublicKey && params.signingPublicKey.trim().length > 0) {
      q.set("signing_public_key", params.signingPublicKey);
    }
    const referrer = params.referrerId ?? this.referrerId;
    if (referrer && referrer.trim().length > 0) {
      q.set("referrer_id", referrer);
    }
    if (this.apiKey) q.set("key", this.apiKey);
    return q;
  }
  // =================================================
  /** Fetch all quoted routes for a trade (best first). Returns an
   *  empty array when no DEX can serve the pair — use `getBestRoute`
   *  when you want that case as a typed `RouteNotFound` error. */
  async getRoutes(params: QuoteParams): Promise<Route[]> {
    if (params.tokenIn.trim().length === 0 || params.tokenOut.trim().length === 0) {
      throw new DexAggregatorClientError({
        kind: "invalid_params",
        message: "token_in and token_out must both be non-empty",
      });
    }
    if (params.tokenIn.trim() === params.tokenOut.trim()) {
      throw new DexAggregatorClientError({
        kind: "invalid_params",
        message: "token_in and token_out must be different",
      });
    }
    if (params.amount.kind === "in" && params.amount.amountIn.trim() === "0") {
      throw new DexAggregatorClientError({
        kind: "invalid_params",
        message: "amount_in must be greater than 0",
      });
    }
    if (params.amount.kind === "out" && params.amount.amountOut.trim() === "0") {
      throw new DexAggregatorClientError({
        kind: "invalid_params",
        message: "amount_out must be greater than 0",
      });
    }
    const qs = this.buildQueryPairs(params);
    const url = `${this.baseUrl}/route?${qs.toString()}`;
    // Browser `fetch` enforces strict `this`-binding to the global
    // object. Detached calls fail with `Illegal invocation` on Chrome
    // (Android) and Safari; Node/Bun ignore it, so this slips past
    // typecheck. Reflect.apply preserves the receiver across runtimes.
    const res = await Reflect.apply(this.fetchImpl, globalThis, [
      url,
      { method: "GET" },
    ]);
    if (!res.ok) {
      const body = await safeText(res);
      const snippet = body.slice(0, 300);
      throw new DexAggregatorClientError({
        kind: "http",
        message: `router answered ${res.status} ${res.statusText}: ${snippet}`,
      });
    }
    let raw: unknown;
    try {
      raw = await res.json();
    } catch (cause) {
      throw new DexAggregatorClientError({
        kind: "parse",
        message: `response was not JSON: ${(cause as Error)?.message ?? cause}`,
      });
    }
    if (!Array.isArray(raw)) {
      throw new DexAggregatorClientError({
        kind: "parse",
        message: `expected a JSON array of routes, got ${typeof raw}`,
      });
    }
    const routes: Route[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") {
        throw new DexAggregatorClientError({
          kind: "parse",
          message: "each route must be an object",
        });
      }
      routes.push(coerceRoute(entry as Record<string, unknown>));
    }
    return routes;
  }
  // =================================================
  /** Fetch the single best route for a trade. Maps the router's empty
   *  array (`[]`) to a typed `RouteNotFound` error so callers can
   *  distinguish "unknown / unserved pair" from transport failures. */
  async getBestRoute(params: QuoteParams): Promise<Route> {
    const routes = await this.getRoutes(params);
    if (routes.length === 0) {
      throw new DexAggregatorClientError({
        kind: "route_not_found",
        tokenIn: params.tokenIn,
        tokenOut: params.tokenOut,
        amountDesc: describeAmount(params.amount),
        hint:
          "router returned []. Check both token ids (testnet tokens are unsupported — the router is mainnet only), try amount_in mode, a smaller amount, or more dexes.",
      });
    }
    return routes[0]!;
  }
}
// =================================================
async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
// =================================================
// copyright 2026 by sleet.near
