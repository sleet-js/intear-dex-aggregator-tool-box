// ==========================================
// swap_form
// Read the form, fetch routes via `DexAggregatorClient`, render
// every route with full details, and let the user execute a route
// (one wallet popup per NearTransaction instruction; the wallet
// itself batches what it can).
//
// Quotes are read-only — no signer needed. Execution reuses the
// `near_kit_client()` from `@near-kit-tool-box/web` (so the same
// `Near` instance drives signing in browser and front-end).
// ==========================================
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
} from "../../../src/index.ts";
import {
  near_connect_client,
  near_kit_client,
} from "@near-kit-tool-box/web";
// ==========================================
const client = new DexAggregatorClient();

function inputValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`input #${id} not found`);
  return el.value.trim();
}

function readParams() {
  const tokenIn = inputValue("TOKEN_IN");
  const amountInRaw = inputValue("AMOUNT_IN");
  const tokenOut = inputValue("TOKEN_OUT");
  const referrer = inputValue("REFERRER_ID");
  if (!tokenIn || !tokenOut || !amountInRaw) {
    throw new Error("token_in, amount_in and token_out must all be non-empty");
  }
  if (!/^\d+$/.test(amountInRaw)) {
    throw new Error(`amount_in must be a non-negative integer (raw units), got "${amountInRaw}"`);
  }
  let params = amountIn(tokenIn, tokenOut, amountInRaw);
  if (referrer) params = withReferrerId(params, referrer);
  // Storage-deposit legs need a trader account. Use the connected
  // wallet account when we have one so the router plans storage.
  return near_connect_client().getConnectedWallet()
    .then((res) => {
      const acct = res.accounts[0]?.accountId;
      if (acct) params = withTraderAccountId(params, acct);
      return params;
    })
    .catch(() => params);
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & {
    text?: string;
    html?: string;
  } = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") node.textContent = String(v);
    else if (k === "html") node.innerHTML = String(v);
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

function renderRouteCard(route: Route, index: number): HTMLElement {
  const card = el("div", { className: "route-card" });
  card.appendChild(el("h3", { text: `#${index} — ${route.dex_id}` }));
  card.appendChild(el("div", {
    className: "small",
    text: `has_slippage: ${route.has_slippage}  •  out: ${route.token_output}`,
  }));

  const det = el("details");
  const summary = el("summary", { text: "route JSON" });
  det.appendChild(summary);
  const pre = el("pre", { text: JSON.stringify(route, null, 2) });
  det.appendChild(pre);
  card.appendChild(det);

  const instr = el("div");
  instr.appendChild(el("strong", { text: "Execution instructions" }));
  instr.appendChild(el("br"));
  if (route.execution_instructions.length === 0) {
    instr.appendChild(el("em", { text: "(none)" }));
  } else {
    for (let i = 0; i < route.execution_instructions.length; i++) {
      const tx = route.execution_instructions[i]!.NearTransaction;
      instr.appendChild(el("div", {
        text: `[tx ${i}] receiver=${tx.receiver_id}  actions=${tx.actions.length}  continue_if_failed=${tx.is_fee_transaction === true || tx.continue_if_failed === true}`,
      }));
      for (let j = 0; j < tx.actions.length; j++) {
        const fc = tx.actions[j]!.FunctionCall;
        instr.appendChild(el("div", {
          text: `   action ${j}: ${fc.method_name}(...)  gas=${fc.gas}  deposit=${fc.deposit}`,
        }));
      }
    }
  }
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
  const heading = el("h2", { text: `Found ${routes.length} route(s) (best first):` });
  out.appendChild(heading);
  for (let i = 0; i < routes.length; i++) {
    out.appendChild(renderRouteCard(routes[i]!, i));
  }
}
// =================================================
function renderError(err: unknown): void {
  const out = document.getElementById("ROUTES_OUTPUT");
  if (!out) return;
  out.replaceChildren();
  const msg =
    err instanceof DexAggregatorClientError
      ? formatDexAggregatorError(err.error)
      : err instanceof Error
        ? err.message
        : String(err);
  out.appendChild(el("div", { className: "error", text: `Error: ${escape(msg)}` }));
  out.appendChild(el("h2", { text: "Raw request details" }));
  out.appendChild(el("pre", { text: "(see console)" }));
}

async function executeOne(route: Route, index: number): Promise<void> {
  try {
    const connected = await near_connect_client().getConnectedWallet();
    if (!connected.accounts[0]) {
      alert("Please login first (LOGIN button).");
      return;
    }
    const btn = document.getElementById(`EXEC_ROUTE_${index}`) as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "SENDING...";
    }
    const outcomes = await executeRoute(near_kit_client(), route);
    const status = outcomes.every((o) =>
      o.status && typeof o.status === "object" && "SuccessValue" in o.status
    )
      ? "ok"
      : "error";
    const out = document.getElementById("ROUTES_OUTPUT");
    if (out) {
      const detail = el("div", {
        className: status === "ok" ? "ok" : "error",
        text: `Route #${index} (${route.dex_id}) — sent ${outcomes.length} transaction(s).`,
      });
      out.appendChild(detail);
      for (let i = 0; i < outcomes.length; i++) {
        const o = outcomes[i]!;
        const hash = ((o.transaction?.hash as string | undefined) ?? "?");
        const link = el("a", {
          href: `https://nearblocks.io/txns/${hash}`,
          target: "_blank",
          rel: "noopener noreferrer",
          text: `[tx ${i}] ${hash}`,
        });
        out.appendChild(el("div", { html: link.outerHTML }));
      }
    }
    if (btn) {
      btn.disabled = false;
      btn.textContent = `EXECUTE ROUTE #${index} VIA ${route.dex_id.toUpperCase()}`;
    }
  } catch (caught: unknown) {
    const err = caught as unknown;
    if (err instanceof DexAggregatorClientError) {
      alert(formatDexAggregatorError(err.error));
    } else if (err instanceof Error) {
      alert(err.message);
    } else {
      alert(String(err));
    }
    const btn = document.getElementById(`EXEC_ROUTE_${index}`) as HTMLButtonElement | null;
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
          className: "error",
          text: "No routes found. The router answered `[]` (no DEX serves this pair/amount). Check the token ids, try a smaller amount, or use mainnet tokens only.",
        }));
      }
      return;
    }
    renderRoutes(routes);
  } catch (caught: unknown) {
    const err = caught as unknown;
    console.error(err);
    renderError(err);
  }
}

function initSwapForm() {
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
