import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// LOGIN / LOGOUT button — matches the sleet-svelte setup-near-kit
// demo (button_auth.svelte) line for line:
//   1. on page load: `near_connect_client().wallet().getAccounts()`
//   2. click LOGIN:   `near_connect_client().connect()`
//   3. click LOGOUT:  `near_connect_client().wallet().signOut()`
//
// That is the entire pattern. The tool box already wires the
// underlying NearConnector from @hot-labs/near-connect; we just
// use it.
//
// The connected accountId is mirrored to `window.__accountId` so
// swap_form.ts can read it without importing this module (the
// bundler would let us import, but mirroring keeps the tool-box
// pattern simple — every consumer reads wallet().getAccounts() or
// reads the mirror).
// ==========================================
declare global {
  interface Window {
    __accountId?: string;
  }
}

let isSignedIn: boolean = false;

function setAccountId(value: string | null): void {
  if (value) window.__accountId = value;
  else delete window.__accountId;
}

async function updateAuthStatus(): Promise<void> {
  try {
    const wallet = await near_connect_client().wallet();
    const accounts = await wallet.getAccounts();
    if (accounts && accounts.length > 0) {
      console.log("Connected account:", accounts[0].accountId);
      setAccountId(accounts[0].accountId);
      isSignedIn = true;
    } else {
      console.log("Not connected");
      setAccountId(null);
      isSignedIn = false;
    }
  } catch (error) {
    console.log("No active wallet session:", error);
    setAccountId(null);
    isSignedIn = false;
  }
  renderAuthButton();
}

function renderAuthButton(): void {
  const btn = document.getElementById("NEAR_AUTH_BUTTON");
  if (!btn) return;
  btn.textContent = isSignedIn
    ? `LOGOUT ${window.__accountId ?? ""}`.trim()
    : "LOGIN";
}

async function handleLogin(): Promise<void> {
  try {
    await near_connect_client().connect();
    await updateAuthStatus();
  } catch (error) {
    console.error("Login failed:", error);
    alert(`Login failed: ${(error as Error)?.message ?? String(error)}`);
  }
}

async function handleLogout(): Promise<void> {
  try {
    const wallet = await near_connect_client().wallet();
    wallet.signOut();
    setAccountId(null);
    isSignedIn = false;
    renderAuthButton();
  } catch (error) {
    console.error("Logout failed:", error);
  }
}

async function onAuthButtonClick(): Promise<void> {
  if (isSignedIn) await handleLogout();
  else await handleLogin();
}

function initAuthButton(): void {
  const btn = document.getElementById("NEAR_AUTH_BUTTON");
  if (!btn) return;
  btn.removeEventListener("click", onAuthButtonClick);
  btn.addEventListener("click", onAuthButtonClick);
  void updateAuthStatus();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthButton);
} else {
  initAuthButton();
}
