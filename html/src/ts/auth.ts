import { near_connect_client } from "@near-kit-tool-box/web";
// ==========================================
// LOGIN / LOGOUT button. Mirrors sleet-hot-hello/html pattern so
// the UI matches the rest of the demos.
// ==========================================
let isSignedIn = false;
let accountId: string | null = null;

async function updateAuthStatus() {
  try {
    const result = await near_connect_client().getConnectedWallet();
    const firstAccount = result.accounts[0];
    if (firstAccount) {
      console.log("[demo] connected account:", firstAccount.accountId);
      accountId = firstAccount.accountId;
      isSignedIn = true;
    } else {
      console.log("[demo] not connected");
      accountId = null;
      isSignedIn = false;
    }
  } catch (err) {
    // No wallet session yet — expected on first load.
    console.log("[demo] no wallet session:", err);
    accountId = null;
    isSignedIn = false;
  }
}

function renderAuthButton() {
  const btn = document.getElementById("NEAR_AUTH_BUTTON");
  if (!btn) {
    console.error('Button with id="NEAR_AUTH_BUTTON" not found in DOM.');
    return;
  }
  btn.textContent = isSignedIn
    ? `LOGOUT ${accountId ?? ""}`.trim()
    : "LOGIN";
}

async function handleLogin() {
  try {
    await near_connect_client().connect();
  } catch (error) {
    console.error("[demo] login failed:", error);
  } finally {
    await updateAuthStatus();
    renderAuthButton();
  }
}

async function handleLogout() {
  try {
    const wallet = await near_connect_client().wallet();
    wallet.signOut();
  } catch (error) {
    console.error("[demo] logout failed:", error);
  } finally {
    await updateAuthStatus();
    renderAuthButton();
  }
}

async function onAuthButtonClick() {
  if (isSignedIn) await handleLogout();
  else await handleLogin();
}

async function initNearAuthButton() {
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
