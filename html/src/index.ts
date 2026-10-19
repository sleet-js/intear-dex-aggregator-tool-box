// ==========================================
// entry: polyfills + handler wiring.
//
// Polyfill crypto.randomUUID for older mobile WebViews so the
// `@hot-labs/near-connect` popup code doesn't fall back or throw.
// ==========================================
if (typeof crypto !== "undefined" && typeof crypto.randomUUID !== "function") {
  // Math.random-based v4 UUID — fine for client-side popup IDs.
  // Cast through unknown because the standard lib types randomUUID
  // as returning a template-literal type we don't need to match.
  (crypto as { randomUUID?: () => string }).randomUUID = (): string =>
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
}

import "./auth";
import "./swap_form";
