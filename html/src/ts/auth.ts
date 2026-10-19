import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// LOGIN / LOGOUT button. Mirrors sleet-hot-hello/html pattern so
// the UI matches the rest of the demos.
//
// We surface every error inline below the LOGIN button so the user
// can see what's wrong (popup blocked, no extension, etc.) rather
// than failing silently on a phone.
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
  el.className = kind;
}

async function updateAuthStatus(): Promise<void> {
  try {
    const result = await near_connect_client().getConnectedWallet();
    const firstAccount = result.accounts[0];
    if (firstAccount) {
      console.log("[demo] connected account:", firstAccount.accountId);
      accountId = firstAccount.accountId;
      isSignedIn = true;
      showStatus(`connected as ${firstAccount.accountId}`, "ok");
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
    showStatus(`no wallet session: ${(err as Error)?.message ?? err}`);
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
  showStatus("logging out...");
  try {
    const wallet = await near_connect_client().wallet();
    wallet.signOut();
    showStatus("logged out", "ok");
  } catch (error) {
    console.error("[demo] logout failed:", error);
    showStatus(`logout failed: ${(error as Error)?.message ?? String(error)}`, "err");
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
