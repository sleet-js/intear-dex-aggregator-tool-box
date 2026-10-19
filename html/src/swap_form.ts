import {
  DexAggregatorClient,
  DexAggregatorClientError,
  amountIn,
  executeRoute,
  formatDexAggregatorError,
  getRoutes,
  withReferrerId,
  withTraderAccountId,
  type Route,
} from "../../src/index.ts";
import {
  near_connect_client,
  near_kit_client,
} from "@near-kit-tool-box/web";
// ==========================================
// Swap form: quote via DexAggregatorClient, render every route
// with full details, then let the user execute a route with the
// connected wallet.
//
// Wallet/auth state is read via `near_connect_client().wallet()` and
// `near_kit_client()` — exactly the same pattern as the svelte
// setup-near-kit demo (`@near-kit-tool-box/web`).
// ==========================================
const client = new DexAggregatorClient();

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
  let params = amountIn(tokenIn, tokenOut, amountInRaw);
  if (referrer) params = withReferrerId(params, referrer);
  const acct = await getConnectedAccountId();
  if (acct) params = withTraderAccountId(params, acct);
  return params;
}
// =================================================
function renderRouteCard(route: Route, index: number): HTMLElement {
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
function renderRoutes(routes: Route[]): void {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (!out) return;
  out.replaceChildren();
  out.appendChild(el("h2", {
    text: `Found ${routes.length} route(s) (best first):`,
  }));
  routes.forEach((route, i) => {
    out.appendChild(renderRouteCard(route, i));
  });
}
// =================================================
function renderError(err: unknown): void {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (!out) return;
  const msg =
    err instanceof DexAggregatorClientError
      ? formatDexAggregatorError(err.error)
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
async function executeOne(route: Route, index: number): Promise<void> {
  const acct = await getConnectedAccountId();
  if (!acct) {
    alert("Please LOGIN first.");
    return;
  }
  const btn = document.getElementById(`EXEC_ROUTE_${index}`) as HTMLButtonElement | null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "SENDING...";
  }
  try {
    const outcomes = await executeRoute(near_kit_client(), route);
    const ok = outcomes.every((o) =>
      o.status && typeof o.status === "object" &&
      "SuccessValue" in o.status,
    );
    const out = document.getElementById("ROUTES_OUTPUT");
    if (out) {
      out.appendChild(el("div", {
        cls: ok ? "ok" : "error",
        text: `Route #${index} (${route.dex_id}) — ${outcomes.length} transaction(s) sent.`,
      }));
      outcomes.forEach((o, i) => {
        const hash = (o.transaction?.hash as string | undefined) ?? "?";
        out.appendChild(el("div", {
          html: `<a href="https://nearblocks.io/txns/${hash}" target="_blank" rel="noopener noreferrer">[tx ${i}] ${hash}</a>`,
        }));
      });
    }
  } catch (caught: unknown) {
    if (caught instanceof DexAggregatorClientError) {
      alert(formatDexAggregatorError(caught.error));
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
    const params = await readParams();
    const routes = await getRoutes(client, params);
    if (routes.length === 0) {
      if (out) {
        out.replaceChildren(el("div", {
          cls: "error",
          text: "No routes found. Router answered `[]` — no DEX serves this pair/amount. Check the token ids, try a smaller amount, or use mainnet tokens only.",
        }));
      }
      return;
    }
    renderRoutes(routes);
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
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSwapForm);
} else {
  initSwapForm();
}
