// =================================================
// subscribe_routes
// Live quotes over the aggregator's WebSocket, `wss://router.intear.tech/route/subscribe`.
//
// Wire source of truth (matches upstream):
//   https://docs.intear.tech/dex-aggregator/guides/live-quotes
//
// A quote is based on the pool state at the moment it was found, and
// pools change every block. This is the documented answer to that:
// the server pushes a new set of quotes every time a pool change moves
// the result, instead of the client polling `/route`.
//
// Protocol, verified against the live server:
//
//   client → { "id": <u64>, "query": "<urlencoded /route query>" }
//   server → { "id": <u64>, "routes": [ Quote, ... ] }
//   server → { "id": <u64>, "error": "<message>" }
//
// Three behaviours worth knowing, all confirmed live:
//
//   - An invalid *query* answers `{ id, error }` and the socket stays
//     open, so one bad request does not need a reconnect.
//   - An invalid *message* (not JSON, or no non-negative integer `id`)
//     ends the connection without a close frame.
//   - Sending `{ "id": n }` with no `query` cancels request `n`: the
//     server stops updating it.
//
// Updates for a superseded request can still arrive, so every update
// carries its `id` and callers must ignore ids that are not the latest
// they sent. `SUBSCRIBE_ROUTES` does that for you: each call owns its
// own socket and id, so there is nothing to filter.
//
// Updates are only sent when they change, and routing is throttled by
// the server (it waits ~10x the routing time, at most 3s, and only
// re-routes after a pool has actually changed).
// =================================================
import { DEX_AGGREGATOR_CLIENT_ERROR } from "../lib/client";
import type { DEX_AGGREGATOR_CLIENT } from "../lib/client";
import { COERCE_ROUTE, type ROUTE } from "../lib/route_response_type";
import { fees_to_query, type QUOTE_PARAMS } from "../lib/quote_params_type";
// =================================================
/** Minimal socket contract, so this module stays runtime-agnostic and
 *  injectable. The global `WebSocket` (Node 22+, Bun, Deno, every
 *  browser) satisfies it; so does any test double. */
export interface SUBSCRIPTION_SOCKET {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
}
/** Factory for one socket. Mirrors the client's injectable `{ fetch }`
 *  so a caller can supply their own implementation, and so Node 18
 *  (no global `WebSocket` before 22) can pass one in. */
export type SOCKET_FACTORY = (url: string) => SUBSCRIPTION_SOCKET;
/** One server message, already discriminated. */
export type ROUTE_UPDATE =
  | { kind: "routes"; id: number; routes: ROUTE[] }
  | { kind: "error"; id: number; message: string };
// =================================================
const OPEN = 1;
// =================================================
/** The socket constructor to use when the caller does not inject one.
 *  Reads the global `WebSocket`, which Node 22+, Bun, Deno and every
 *  browser provide. On older Node, pass `socket_factory` to
 *  `SUBSCRIBE_ROUTES`. */
export function default_socket_factory(url: string): SUBSCRIPTION_SOCKET {
  const Ctor = (globalThis as { WebSocket?: new (u: string) => SUBSCRIPTION_SOCKET })
    .WebSocket;
  if (!Ctor) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message:
        "no global WebSocket available (Node < 22) — pass { socket_factory } to SUBSCRIBE_ROUTES, e.g. built on the `ws` package",
    });
  }
  return new Ctor(url);
}
// =================================================
/** Convert a client `QUERY_PARAMS` into the query string the socket
 *  takes. Identical to what `GET /route` receives, except:
 *
 *  - `key` is ignored in a message's `query`; it must go in the
 *    WebSocket URL instead, which is why `subscribe_url` reads it off
 *    the client.
 *  - `max_wait_ms` does not apply — the server pushes updates as pool
 *    state changes rather than blocking on a quote.
 *
 *  The same validation as `GET_ROUTES` runs first, so a caller finds
 *  out about an empty or self-referential token pair before opening a
 *  socket rather than as a server `error`. */
export function build_subscribe_query(params: QUOTE_PARAMS): string {
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
  const q = new URLSearchParams();
  q.set("token_in", params.token_in);
  q.set("token_out", params.token_out);
  if (params.amount.kind === "in") {
    q.set("amount_in", params.amount.amount_in);
  } else {
    q.set("amount_out", params.amount.amount_out);
  }
  if (params.slippage.kind === "fixed") {
    q.set("slippage_type", "Fixed");
    q.set("slippage", String(params.slippage.slippage));
  } else {
    q.set("slippage_type", "Auto");
    q.set("max_slippage", String(params.slippage.max_slippage));
    q.set("min_slippage", String(params.slippage.min_slippage));
  }
  if (params.dexes && params.dexes.trim().length > 0) {
    q.set("dexes", params.dexes);
  }
  if (params.trader_account_id && params.trader_account_id.trim().length > 0) {
    q.set("trader_account_id", params.trader_account_id);
  }
  const fees = fees_to_query(params.fees);
  if (fees !== undefined) q.set("fees", fees);
  if (params.signing_public_key && params.signing_public_key.trim().length > 0) {
    q.set("signing_public_key", params.signing_public_key);
  }
  if (params.referrer_id && params.referrer_id.trim().length > 0) {
    q.set("referrer_id", params.referrer_id);
  }
  return q.toString();
}
// =================================================
/** Options for `SUBSCRIBE_ROUTES`. */
export interface SUBSCRIBE_OPTIONS {
  /** Socket constructor. Defaults to the global `WebSocket`, which
   *  needs Node 22+. Pass one on older Node. */
  socket_factory?: SOCKET_FACTORY;
  /** Non-negative request id. Defaults to 1. Each call owns its own
   *  socket, so the id only has to be unique within that socket. */
  id?: number;
  /** Called for every server message. Throwing from it closes the
   *  subscription. */
  on_update?: (update: ROUTE_UPDATE) => void;
  /** Called when the socket errors or closes unexpectedly. */
  on_error?: (error: Error) => void;
  /** Called once the socket has closed, whatever the reason. */
  on_close?: (info: { code?: number; reason?: string }) => void;
}
// =================================================
/** A live subscription. Call `close()` when done.
 *
 *  `closed` is a promise that settles when the socket closes, so an
 *  `await SUBSCRIBE_ROUTES(...)` returns immediately and the
 *  subscription runs in the background until closed. */
export interface ROUTE_SUBSCRIPTION {
  /** The WebSocket URL in use, including `?key=` when the client has
   *  an API key configured. */
  readonly url: string;
  /** The request id this subscription listens for. Updates carrying
   *  any other id are ignored. */
  readonly id: number;
  /** Resolves when the socket closes. */
  closed: Promise<void>;
  /** Close the socket and settle `closed`. */
  close(): void;
  /** True once the socket has closed. */
  readonly is_closed: boolean;
}
// =================================================
/** Subscribe to live quotes for a swap.
 *
 *  The server sends one update as soon as it has routes, then another
 *  every time a pool change moves the result. Each update is a fresh
 *  best-first array — the same shape `GET_ROUTES` returns — so a swap
 *  form can render `update.routes[0]` and re-render on every push
 *  without polling.
 *
 *  Routing is deterministic and free, so this needs no credentials and
 *  no signer.
 *
 *  @example
 *  ```ts
 *  const sub = await SUBSCRIBE_ROUTES(
 *    client,
 *    AMOUNT_IN("near", "usdt.tether-token.near", "10000000000000000000000"),
 *    { on_update: (u) => { if (u.kind === "routes") render(u.routes[0]?.estimated_amount); } },
 *  );
 *  // ... later
 *  sub.close();
 *  await sub.closed;
 *  ```
 *
 *  @param client Supplies the base url, referrer and api key.
 *  @param params The swap to watch, in the same shape `GET_ROUTES`
 *    takes.
 *  @param options Socket factory, callbacks, request id.
 *  @returns The subscription, already open.
 */
export async function SUBSCRIBE_ROUTES(
  client: DEX_AGGREGATOR_CLIENT,
  params: QUOTE_PARAMS,
  options: SUBSCRIBE_OPTIONS = {},
): Promise<ROUTE_SUBSCRIPTION> {
  const query = build_subscribe_query(params);
  const id = options.id ?? 1;
  if (!Number.isInteger(id) || id < 0) {
    throw new DEX_AGGREGATOR_CLIENT_ERROR({
      kind: "invalid_params",
      message: `subscribe id must be a non-negative integer, got ${id}`,
    });
  }
  // The api key belongs in the URL, not the query message.
  const base = `${client.BASE_URL_VALUE().replace(/^http/, "ws")}/route/subscribe`;
  const url = client.API_KEY_VALUE()
    ? `${base}?key=${encodeURIComponent(client.API_KEY_VALUE()!)}`
    : base;
  const make = options.socket_factory ?? default_socket_factory;
  const socket = make(url);
  let closed = false;
  let settle_closed: () => void = () => {};
  const closed_promise = new Promise<void>((resolve) => {
    settle_closed = resolve;
  });
  const finish = (code?: number, reason?: string) => {
    if (closed) return;
    closed = true;
    options.on_close?.({ code, reason });
    settle_closed();
  };
  const fail = (cause: unknown) => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    options.on_error?.(error);
    finish();
  };
  socket.onopen = () => {
    socket.send(JSON.stringify({ id, query }));
  };
  socket.onmessage = (event) => {
    const raw = typeof event.data === "string" ? event.data : String(event.data);
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch (cause) {
      // The server closes the socket on invalid JSON, so this is
      // terminal rather than something to retry.
      fail(
        new DEX_AGGREGATOR_CLIENT_ERROR({
          kind: "parse",
          message: `route/subscribe sent a non-JSON message: ${raw.slice(0, 200)}`,
        }),
      );
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      fail(
        new DEX_AGGREGATOR_CLIENT_ERROR({
          kind: "parse",
          message: `route/subscribe sent a non-object message: ${raw.slice(0, 200)}`,
        }),
      );
      return;
    }
    const record = message as Record<string, unknown>;
    const got_id = record["id"];
    // Ignore anything that is not our request: the server can still
    // be draining an update for a request we superseded.
    if (typeof got_id === "number" && got_id !== id) return;
    if (typeof record["error"] === "string") {
      // A bad query is reported in-band and the socket stays open.
      options.on_update?.({ kind: "error", id, message: record["error"] });
      return;
    }
    const routes_raw = record["routes"];
    if (!Array.isArray(routes_raw)) {
      fail(
        new DEX_AGGREGATOR_CLIENT_ERROR({
          kind: "parse",
          message: `route/subscribe message had no routes array: ${raw.slice(0, 200)}`,
        }),
      );
      return;
    }
    let routes: ROUTE[];
    try {
      routes = routes_raw.map((entry) => {
        if (!entry || typeof entry !== "object") {
          throw new Error("each route must be an object");
        }
        return COERCE_ROUTE(entry as Record<string, unknown>);
      });
    } catch (cause) {
      fail(
        new DEX_AGGREGATOR_CLIENT_ERROR({
          kind: "parse",
          message: `route/subscribe routes were malformed: ${(cause as Error)?.message ?? cause}`,
        }),
      );
      return;
    }
    options.on_update?.({ kind: "routes", id, routes });
  };
  socket.onerror = (event) => {
    const detail = (event as { message?: string })?.message;
    fail(
      new DEX_AGGREGATOR_CLIENT_ERROR({
        kind: "http",
        message: `route/subscribe socket error${detail ? `: ${detail}` : ""}`,
      }),
    );
  };
  socket.onclose = (event) => {
    finish(event?.code, event?.reason);
  };
  const subscription: ROUTE_SUBSCRIPTION = {
    url,
    id,
    closed: closed_promise,
    get is_closed() {
      return closed;
    },
    close() {
      if (closed) return;
      // Politely cancel this request first: the server stops updating
      // a request it has been told is finished.
      if (socket.readyState === OPEN) {
        try {
          socket.send(JSON.stringify({ id }));
        } catch {
          // already tearing down
        }
      }
      socket.close();
      finish();
    },
  };
  return subscription;
}
// =================================================
// copyright 2026 by sleet.near