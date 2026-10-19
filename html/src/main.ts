// ==========================================
// main entry: imports auth + swap handlers.
// Bun's HTML bundler picks this up from <script src=...> in
// public/index.html and ships one bundled module to the browser.
//
// We force mainnet here (per project requirements) by wiping any
// stale "network_id" localStorage value the tool box would otherwise
// read on first call to `near_connect_client()`.
// ==========================================
try {
  localStorage.removeItem("network_id");
} catch {
  // localStorage may be blocked (private mode); ignore.
}
import "./ts/auth";
import "./ts/swap_form";
