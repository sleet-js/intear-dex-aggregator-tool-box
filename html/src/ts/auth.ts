import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// LOGIN / LOGOUT button.
//
// Follows the canonical pattern from the sleet-svelte
// "setup-near-kit" demo (button_auth.svelte): the tool box exposes
// `near_connect_client()` which returns the underlying NearConnector;
// we then call `.wallet().getAccounts()` to read existing accounts
// and `.connect()` to start a new wallet session.
//
// We DO NOT import @hot-labs/near-connect here — the tool box
// already wires it. Adding it directly just creates version drift
// and a second NearConnector instance.
// ==========================================
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

async function getAccounts(): Promise<string[]> {
  const wallet = await near_connect_client().wallet();
  const accounts = await wallet.getAccounts();
  return (accounts ?? []).map((a) => a.accountId);
}

async function updateAuthStatus(): Promise<void> {
  try {
    const ids = await getAccounts();
    if (ids.length > 0 && ids[0]) {
      console.log("[demo] connected account:", ids[0]);
      accountId = ids[0];
      isSignedIn = true;
      showStatus(`connected as ${ids[0]}`, "ok");
    } else {
      console.log("[demo] not connected");
      accountId = null;
      isSignedIn = false;
      showStatus("not connected — click LOGIN");
    }
  } catch (err) {
    console.log("[demo] no wallet session:", err);
    accountId = null;
    isSignedIn = false;
    showStatus(
      `no wallet session: ${(err as Error)?.message ?? String(err)}`,
      "err",
    );
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
  showStatus("connecting...");
  try {
    await near_connect_client().connect();
    showStatus("connected", "ok");
  } catch (error) {
    console.error("[demo] login failed:", error);
    showStatus(
      `login failed: ${(error as Error)?.message ?? String(error)} ` +
        `(check that popups are allowed for this site on mobile)`,
      "err",
    );
  } finally {
    await updateAuthStatus();
    renderAuthButton();
  }
}

async function handleLogout(): Promise<void> {
  try {
    const wallet = await near_connect_client().wallet();
    wallet.signOut();
    showStatus("logged out", "ok");
  } catch (error) {
    console.error("[demo] logout failed:", error);
    showStatus(
      `logout failed: ${(error as Error)?.message ?? String(error)}`,
      "err",
    );
  } finally {
    await updateAuthStatus();
    renderAuthButton();
  }
}

async function onAuthButtonClick(): Promise<void> {
  if (isSignedIn) await handleLogout();
  else await handleLogin();
}

async function initNearAuthButton(): Promise<void> {
  await updateAuthStatus();
  renderAuthButton();
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
