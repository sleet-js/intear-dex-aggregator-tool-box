import {
  DEX_AGGREGATOR_CLIENT,
  DEX_AGGREGATOR_CLIENT_ERROR,
  AMOUNT_IN,
  EXECUTE_ROUTE_FULL_BATCHED,
  FORMAT_DEX_AGGREGATOR_ERROR,
  SUBSCRIBE_ROUTES,
  WITH_REFERRER_ID,
  WITH_TRADER_ACCOUNT_ID,
  type ROUTE,
  type ROUTE_SUBSCRIPTION,
} from "../../src/index.ts";
import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// Swap form: quote via DEX_AGGREGATOR_CLIENT, render every route
// with full details, then let the user execute a route with the
// connected wallet.
//
// Wallet/auth state is read via `near_connect_client().wallet()` —
// the same pattern as the svelte setup-near-kit demo
// (`@near-kit-tool-box/web`).
// ==========================================
const client = new DEX_AGGREGATOR_CLIENT();

function $(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`input #${id} not found`);
  return el.value.trim();
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    text?: string;
    html?: string;
    cls?: string;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = String(v);
    else if (k === "html") node.innerHTML = String(v);
    else if (k === "cls") node.className = String(v);
    else (node as unknown as Record<string, unknown>)[k] = v;
  }
  return node;
}

function escape(s: unknown): string {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function getConnectedAccountId(): Promise<string | null> {
  try {
    const wallet = await near_connect_client().wallet();
    const accounts = await wallet.getAccounts();
    return accounts?.[0]?.accountId ?? null;
  } catch {
    return null;
  }
}

async function readParams() {
  const tokenIn = $("TOKEN_IN");
  const amountInRaw = $("AMOUNT_IN");
  const tokenOut = $("TOKEN_OUT");
  const referrer = $("REFERRER_ID");
  if (!tokenIn || !tokenOut || !amountInRaw) {
    throw new Error("token_in, amount_in and token_out must all be non-empty");
  }
  if (!/^\d+$/.test(amountInRaw)) {
    throw new Error(
      `amount_in must be a non-negative integer (raw units), got "${amountInRaw}"`,
    );
  }
  let params = AMOUNT_IN(tokenIn, tokenOut, amountInRaw);
  if (referrer) params = WITH_REFERRER_ID(params, referrer);
  const acct = await getConnectedAccountId();
  if (acct) params = WITH_TRADER_ACCOUNT_ID(params, acct);
  return params;
}
// =================================================
// Live quotes.
//
// A quote is only good for a few seconds — pools change every block —
// so the form holds a `SUBSCRIBE_ROUTES` subscription open instead of
// polling. Every push re-renders the route list, and the user always
// executes a quote that is seconds old rather than one from whenever
// they last clicked "get routes".
//
// One subscription at a time: changing the form closes the previous
// socket, so there is never more than one asking for quotes.
// =================================================
let subscription: ROUTE_SUBSCRIPTION | null = null;
let live_params_key = "";

async function stopLive(): Promise<void> {
  const current = subscription;
  subscription = null;
  live_params_key = "";
  if (current) {
    current.close();
    try {
      await current.closed;
    } catch {
      // already closed
    }
  }
}

/** A stable key for "these params are already subscribed". */
async function paramsKey(): Promise<string> {
  const tokenIn = $("TOKEN_IN");
  const amountIn = $("AMOUNT_IN");
  const tokenOut = $("TOKEN_OUT");
  const referrer = $("REFERRER_ID");
  const acct = await getConnectedAccountId();
  return [tokenIn, amountIn, tokenOut, referrer, acct].join("|");
}

async function startLive(): Promise<void> {
  const out = document.getElementById("ROUTES_OUTPUT");
  const key = await paramsKey();
  // Already watching these exact params — leave the socket alone.
  if (subscription && key === live_params_key) return;
  await stopLive();
  if (out) out.replaceChildren(el("p", { text: "subscribing to live quotes..." }));

  const params = await readParams();
  live_params_key = key;
  subscription = await SUBSCRIBE_ROUTES(client, params, {
    on_update: (update) => {
      if (update.kind === "error") {
        renderError(
          new DEX_AGGREGATOR_CLIENT_ERROR({
            kind: "http",
            message: `router rejected the subscription: ${update.message}`,
          }),
        );
        return;
      }
      renderRoutes(update.routes, true);
    },
    on_error: (error) => renderError(error),
  });
}

// =================================================
function renderRouteCard(route: ROUTE, index: number): HTMLElement {
  const card = el("div", { cls: "route-card" });
  card.appendChild(el("h3", { text: `#${index} — ${route.dex_id}` }));
  card.appendChild(el("div", {
    cls: "small",
    text: `out: ${route.token_output}`,
  }));

  const det = el("details");
  det.appendChild(el("summary", { text: "route JSON" }));
  det.appendChild(el("pre", { text: JSON.stringify(route, null, 2) }));
  card.appendChild(det);

  const instr = el("div");
  instr.appendChild(el("strong", { text: "Execution instructions:" }));
  instr.appendChild(el("br"));
  route.execution_instructions.forEach((instrOrTx, i) => {
    const tx = instrOrTx.NearTransaction;
    const fee =
      tx.is_fee_transaction === true || tx.continue_if_failed === true
        ? "  [fee tx]"
        : "";
    instr.appendChild(el("div", {
      text: `[tx ${i}] receiver=${tx.receiver_id}  actions=${tx.actions.length}${fee}`,
    }));
    tx.actions.forEach((act, j) => {
      const fc = act.FunctionCall;
      instr.appendChild(el("div", {
        text: `   action ${j}: ${fc.method_name}(...) gas=${fc.gas} deposit=${fc.deposit}`,
      }));
    });
  });
  card.appendChild(instr);

  const execBtn = el("button", {
    id: `EXEC_ROUTE_${index}`,
    text: `EXECUTE ROUTE #${index} VIA ${route.dex_id.toUpperCase()}`,
  });
  card.appendChild(execBtn);

  execBtn.addEventListener("click", () => executeOne(route, index));
  return card;
}
// =================================================
function renderRoutes(routes: ROUTE[], live = false): void {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (!out) return;
  out.replaceChildren();
  if (routes.length === 0) {
    out.appendChild(el("h2", { text: "No routes." }));
    out.appendChild(el("div", {
      cls: "error",
      text:
        "Router answered `[]` — no DEX serves this pair/amount. Check the token ids, " +
        "try a smaller amount, or use mainnet tokens only.",
    }));
    return;
  }
  out.appendChild(el("h2", {
    text: live
      ? `${routes.length} live route(s), best first:`
      : `Found ${routes.length} route(s) (best first):`,
  }));
  if (live) {
    out.appendChild(el("div", {
      cls: "small",
      text: "live — the list updates itself as pools move. executing uses the quote shown.",
    }));
  }
  routes.forEach((route, i) => {
    out.appendChild(renderRouteCard(route, i));
  });
}
// =================================================
function renderError(err: unknown): void {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (!out) return;
  const msg =
    err instanceof DEX_AGGREGATOR_CLIENT_ERROR
      ? FORMAT_DEX_AGGREGATOR_ERROR(err.error)
      : err instanceof Error
        ? err.message
        : String(err);
  out.replaceChildren();
  out.appendChild(el("div", { cls: "error", text: `Error: ${escape(msg)}` }));
  out.appendChild(el("h3", { text: "Raw error (also in DevTools console)" }));
  out.appendChild(el("pre", { text: msg }));
  if (err instanceof Error && err.stack) {
    out.appendChild(el("h4", { text: "Stack" }));
    out.appendChild(el("pre", { text: err.stack }));
  }
}
// =================================================
async function executeOne(route: ROUTE, index: number): Promise<void> {
  // Read the connected account from the mirror kept in auth.ts
  // (window.__accountId). Click handlers aren't async-survivable for
  // "reconnect and try again", so we trust the auth.ts state here.
  const signer_id = window.__accountId;
  if (!signer_id) {
    alert("Please LOGIN first.");
    return;
  }
  const btn = document.getElementById(`EXEC_ROUTE_${index}`) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "SENDING...";
  }
  try {
    // Browser path: one popup for the swap's transactions, then a
    // second only if the outcome says the swap went through.
    //
    // `EXECUTE_ROUTE_FULL_BATCHED` runs the documented three phases:
    // send the swap legs, ask `GET /route/outcome`, and only then send
    // the `is_fee_transaction` legs. That last part matters — the
    // transaction carrying an `ft_transfer_call` swap succeeds even
    // when the DEX refunds it, so checking the transaction status
    // alone reports a failed swap as a successful one and pays
    // referral fees for it.
    const wallet = await near_connect_client().wallet();
    const result = await EXECUTE_ROUTE_FULL_BATCHED(wallet, route, {
      client,
      signer_id,
      token_in: $("TOKEN_IN"),
      token_out: $("TOKEN_OUT"),
      on_failure: "recover",
      fee_amount: route.fee_amount ?? "0",
      verbose: true,
    });

    const out = document.getElementById("ROUTES_OUTPUT");
    if (!out) return;
    if (result.swap_succeeded) {
      out.appendChild(el("div", {
        cls: "ok",
        text:
          `Route #${index} (${route.dex_id}) succeeded — received ` +
          `${result.final_outcome.amount_out} of ${$("TOKEN_OUT")}.`,
      }));
    } else {
      out.appendChild(el("div", {
        cls: "error",
        text:
          `Route #${index} (${route.dex_id}) did not go through: ` +
          `${result.outcome.error ?? "the DEX refunded the input"}`,
      }));
      out.appendChild(el("div", {
        cls: "small",
        text:
          `spent ${result.outcome.amount_in}, received ${result.outcome.amount_out}. ` +
          (result.recovery_outcomes.length > 0
            ? `${result.recovery_outcomes.length} recovery transaction(s) sent to return your tokens.`
            : ""),
      }));
    }
    const all = [
      ...result.swap_outcomes,
      ...result.fee_outcomes,
      ...result.recovery_outcomes,
    ];
    all.forEach((o, i) => {
      const hash = (o.transaction?.hash as string | undefined) ?? "?";
      out.appendChild(el("div", {
        html: `<a href="https://nearblocks.io/txns/${hash}" target="_blank" rel="noopener noreferrer">[tx ${i}] ${hash}</a>`,
      }));
    });
  } catch (caught: unknown) {
    if (caught instanceof DEX_AGGREGATOR_CLIENT_ERROR) {
      alert(FORMAT_DEX_AGGREGATOR_ERROR(caught.error));
    } else if (caught instanceof Error) {
      alert(caught.message);
    } else {
      alert(String(caught));
    }
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = `EXECUTE ROUTE #${index} VIA ${route.dex_id.toUpperCase()}`;
    }
  }
}
// =================================================
async function onGetRoutes(): Promise<void> {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (out) out.replaceChildren(el("p", { text: "loading..." }));
  try {
    await startLive();
  } catch (err) {
    console.error(err);
    renderError(err);
  }
}

function initSwapForm(): void {
  const btn = document.getElementById("GET_ROUTES_BUTTON");
  if (!btn) return;
  btn.removeEventListener("click", onGetRoutes);
  btn.addEventListener("click", onGetRoutes);

  // Close the socket when the page goes away, so a background tab does
  // not hold a subscription open.
  window.addEventListener("beforeunload", () => {
    void stopLive();
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSwapForm);
} else {
  initSwapForm();
}
