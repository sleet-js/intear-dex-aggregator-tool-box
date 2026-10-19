// =================================================
// get_routes
// Free-function re-exports of `DEX_AGGREGATOR_CLIENT.GET_ROUTES` /
// `GET_BEST_ROUTE`, so callers can keep a flat `import { GET_ROUTES }`
// style without reaching into the `lib/` internals.
//
// Functions are intentionally thin pass-throughs — every typed field,
// error, and helper lives on the client class so the fun paths and
// the client stay 1:1.
// =================================================
import { DEX_AGGREGATOR_CLIENT } from "../lib/client";
import type { QUOTE_PARAMS } from "../lib/quote_params_type";
import type { ROUTE } from "../lib/route_response_type";
// =================================================
/** Fetch all quoted routes for a trade (best first) via raw router
 *  JSON, using a pre-configured `DEX_AGGREGATOR_CLIENT`. Returns an
 *  empty array when no DEX can serve the pair. No signer required. */
export async function GET_ROUTES(
  client: DEX_AGGREGATOR_CLIENT,
  params: QUOTE_PARAMS,
): Promise<ROUTE[]> {
  return client.GET_ROUTES(params);
}
// =================================================
/** Fetch the single best route for a trade. Maps the router's empty
 *  array (`[]`) to a typed `RouteNotFound` error via
 *  `client.GET_BEST_ROUTE`. */
export async function GET_BEST_ROUTE(
  client: DEX_AGGREGATOR_CLIENT,
  params: QUOTE_PARAMS,
): Promise<ROUTE> {
  return client.GET_BEST_ROUTE(params);
}
// =================================================
// copyright 2026 by sleet.near