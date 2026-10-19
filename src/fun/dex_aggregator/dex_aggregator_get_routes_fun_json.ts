// =================================================
// dex_aggregator_get_routes_fun_json
// Re-exports of `DexAggregatorClient.getRoutes` / `getBestRoute` at
// the path the rs tool-box uses (`fun::dex_aggregator::...`), so TS
// callers don't have to import from `lib/helper` directly.
//
// Functions are intentionally thin pass-throughs — every typed field,
// error, and helper lives on the client class so the fun paths and
// the client stay 1:1.
// =================================================
import { DexAggregatorClient } from "../../lib/helper/dex_aggregator_client.ts";
import type { QuoteParams } from "../../lib/types/dex_aggregator_quote_params_type.ts";
import type { Route } from "../../lib/types/dex_aggregator_route_response_type.ts";
// =================================================
/** Fetch all quoted routes for a trade (best first) via raw router
 *  JSON, using a pre-configured `DexAggregatorClient`. Returns an
 *  empty array when no DEX can serve the pair. No signer required. */
export async function getRoutes(
  client: DexAggregatorClient,
  params: QuoteParams,
): Promise<Route[]> {
  return client.getRoutes(params);
}
// =================================================
/** Fetch the single best route for a trade. Maps the router's empty
 *  array (`[]`) to a typed `RouteNotFound` error via
 *  `client.getBestRoute`. */
export async function getBestRoute(
  client: DexAggregatorClient,
  params: QuoteParams,
): Promise<Route> {
  return client.getBestRoute(params);
}
// =================================================
// copyright 2026 by sleet.near
