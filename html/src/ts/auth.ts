import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// LOGIN / LOGOUT button.
//
// Pattern (matching sleet-hot-hello + your setup-near-kit svelte demo):
// the tool box exposes `near_connect_client()` returning the underlying
// NearConnector. We:
//   1. Listen for `wallet:signIn` / `wallet:signOut` events on the
//      connector — those fire ONLY when the popup actually completes
//      a sign-in, avoiding the race where `connect()` resolves but
//      the wallet handle's `getAccounts()` returns `[]`.
//   2. Update the LOGIN/LOGOUT button + status line from those events.
//   3. Click → `near_connect_client().connect()` (opens the popup).
//
// We do NOT call `near_connect_client().wallet()` ourselves — that
// method reads storage and throws "No accounts found" if the popup
// hasn't fully completed yet.
//
// Mainnet only (per project requirements): the tool box's
// `near_connect_client()` reads localStorage.NETWORK_STORAGE_KEY to
// pick mainnet vs testnet, defaulting to "mainnet" on first visit.
// A stale "testnet" value from a previous session would silently
// route login to the testnet connector — wipe it once at load.
// ==========================================
try {
  localStorage.removeItem("network_id"); // force mainnet for this demo
} catch {
  // localStorage may be blocked (private mode); ignore.
}
type Account = { accountId: string };

let isSignedIn = false;
let accountId: string | null = null;

function statusLineEl(): HTMLElement | null {
  return document.getElementById("NEAR_AUTH_STATUS");
}

function showStatus(text: string, kind: "" | "ok" | "err" = ""): void {
  const el = statusLineEl();
  if (!el) return;
  el.textContent = text;
  el.className = `small ${kind}`.trim();
}

function setSignedIn(accountIdValue: string | null): void {
  isSignedIn = !!accountIdValue;
  accountId = accountIdValue;
  renderAuthButton();
  if (accountIdValue) {
    showStatus(`connected as ${accountIdValue}`, "ok");
  } else {
    showStatus("not connected — click LOGIN");
  }
}

function renderAuthButton(): void {
  const btn = document.getElementById("NEAR_AUTH_BUTTON");
  if (!btn) {
    console.error('Button with id="NEAR_AUTH_BUTTON" not found in DOM.');
    return;
  }
  btn.textContent = isSignedIn
    ? `LOGOUT ${accountId ?? ""}`.trim()
    : "LOGIN";
}

async function handleLogin(): Promise<void> {
  showStatus("connecting... (allow popups if prompted)");
  try {
    // connect() opens the wallet-select popup and returns once the
    // wallet completes sign-in. After it resolves we get the wallet
    // back, but the authoritative account data is what the connector
    // pushed via the wallet:signIn event below — that handler
    // runs whether or not connect()'s return value is used here.
    await near_connect_client().connect();
  } catch (error) {
    console.error("[demo] login failed:", error);
    showStatus(
      `login failed: ${(error as Error)?.message ?? String(error)}`,
      "err",
    );
  }
}

async function handleLogout(): Promise<void> {
  try {
    const wallet = await near_connect_client().wallet();
    if (wallet && typeof wallet.signOut === "function") {
      await wallet.signOut();
    }
    // wallet:signOut will fire — handler below updates the UI.
    setSignedIn(null);
    showStatus("logged out", "ok");
  } catch (error) {
    console.error("[demo] logout failed:", error);
    showStatus(
      `logout failed: ${(error as Error)?.message ?? String(error)}`,
      "err",
    );
  }
}

async function onAuthButtonClick(): Promise<void> {
  if (isSignedIn) await handleLogout();
  else await handleLogin();
}

function attachWalletEventListeners(): void {
  // Pick up the connector the tool box is currently using (mainnet or
  // testnet based on localStorage.NETWORK_STORAGE_KEY).
  const connector = near_connect_client();

  // wallet:signIn -> we have accounts. The payload has
  // `{ wallet, accounts, success, source }` per NearConnector source.
  // We ignore `success === false` and look at the accounts array.
  if (typeof connector.on === "function") {
    connector.on("wallet:signIn", (event: unknown) => {
      const e = (event ?? {}) as { accounts?: Account[] };
      const ids = (e.accounts ?? []).map((a) => a.accountId).filter(Boolean);
      if (ids.length > 0 && ids[0]) {
        setSignedIn(ids[0]);
      } else {
        setSignedIn(null);
        showStatus("sign-in returned no accounts", "err");
      }
    });
    connector.on("wallet:signOut", () => {
      setSignedIn(null);
    });
  } else {
    console.warn("[demo] connector has no .on() — events unsupported");
  }
}

function initNearAuthButton(): void {
  attachWalletEventListeners();
  renderAuthButton();
  showStatus("not connected — click LOGIN");
  const btn = document.getElementById("NEAR_AUTH_BUTTON");
  if (!btn) return;
  btn.removeEventListener("click", onAuthButtonClick);
  btn.addEventListener("click", onAuthButtonClick);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initNearAuthButton);
} else {
  initNearAuthButton();
}
