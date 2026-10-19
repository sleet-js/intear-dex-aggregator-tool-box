// =================================================
// dex_aggregator_format
// Minimal route table + per-route preview printers. Used by the
// interactive `dex_aggregator_swap_bin` so app code can pull the
// same printers via the library.
// =================================================
import {
  bestAmount,
  amountMode,
  isDirectlyExecutable,
  type FunctionCallAction,
  type NearTransactionInstruction,
  type Route,
} from "../types/dex_aggregator_route_response_type.ts";
// =================================================
/** Shorten a token id for tables (`usdt.tether-token.near` stays,
 *  `nep141:<64-hex>` becomes `nep141:17208628…36133a1`). */
export function shortToken(token: string): string {
  if (token.length <= 24) return token;
  return `${token.slice(0, 12)}…${token.slice(-7)}`;
}
// =================================================
/** One minimal row describing a route for the picker table. */
export function routeRow(index: number, route: Route): string {
  const est = bestAmount(route.estimated_amount) ?? "?";
  const worst = bestAmount(route.worst_case_amount) ?? "?";
  const mode = amountMode(route.estimated_amount);
  const txCount = route.execution_instructions.length;
  const actionCount = route.execution_instructions.reduce(
    (n, i) =>
      n + ("NearTransaction" in i ? i.NearTransaction.actions.length : 0),
    0,
  );
  const exec = isDirectlyExecutable(route) ? "tx" : "intents!";
  const pad = (s: string | number, w: number, side: "l" | "r" = "l"): string => {
    const str = String(s);
    return side === "r" ? str.padStart(w) : str.padEnd(w);
  };
  return [
    pad(index, 2, "r"),
    pad(route.dex_id, 9),
    `${mode}:${est}`,
    `${mode}:${worst}`,
    `${txCount} tx / ${actionCount} act`,
    exec,
    shortToken(route.token_output),
  ].join(" | ");
}
// =================================================
/** Print a minimal route table (best route first, as returned).
 *
 *  One pipe-and-space row per route; widths auto-fit to the data so
 *  every value shows up in full. */
export function printRoutesTable(routes: Route[]): void {
  if (routes.length === 0) {
    console.log("(no routes)");
    return;
  }
  const rows = routes.map((route, i) => routeRow(i, route));
  const widths = [
    " # ".length,
    "dex".length,
    "estimated".length,
    "worst-case".length,
    "plan".length,
    "exec".length,
    "out".length,
  ];
  for (const row of rows) {
    const cells = row.split(" | ");
    for (let i = 0; i < cells.length && i < widths.length; i++) {
      widths[i] = Math.max(widths[i]!, cells[i]!.length);
    }
  }
  const headers = [" # ", "dex", "estimated", "worst-case", "plan", "exec", "out"];
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ");
  console.log(`| ${fmt(headers)} |`);
  console.log(
    `|-${widths.map((w) => "-".repeat(w)).join("-|-")}-|`,
  );
  for (const row of rows) console.log(`| ${fmt(row.split(" | "))} |`);
}
// =================================================
/** Print a decoded preview of every instruction in a route (dry-run
 *  view: receiver, method, gas, deposit, args). */
export function printRoutePreview(route: Route): void {
  console.log(`dex: ${route.dex_id} | out: ${route.token_output}`);
  const instructions = route.execution_instructions;
  for (let i = 0; i < instructions.length; i++) {
    const instruction = instructions[i]!;
    if ("NearTransaction" in instruction) {
      const tx = instruction.NearTransaction;
      console.log(`  [tx ${i}] -> ${tx.receiver_id}`);
      previewTxActions(tx);
    } else {
      console.log(
        `  [intents ${i}] manual NEP-413 signing needed (route variants other than NearTransaction are not in the wire format today; future-compat only)`,
      );
    }
  }
}

function previewTxActions(tx: NearTransactionInstruction): void {
  for (let j = 0; j < tx.actions.length; j++) {
    const action = tx.actions[j]!;
    if ("FunctionCall" in action) {
      const fc: FunctionCallAction = action.FunctionCall;
      console.log(
        `    - ${fc.method_name} (gas ${fc.gas}, deposit ${fc.deposit}): ${previewArgs(fc.args)}`,
      );
    }
  }
}

function previewArgs(base64Args: string): string {
  try {
    const bytes = base64DecodeForPreview(base64Args);
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const trimmed = text.trim();
    if (trimmed.length === 0) return `{} (${bytes.length} bytes)`;
    if (trimmed.length > 300) return `${trimmed.slice(0, 300)}…`;
    return trimmed;
  } catch (err) {
    return `<undecodable args: ${(err as Error).message}>`;
  }
}

function base64DecodeForPreview(input: string): Uint8Array {
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (cleaned.length === 0) return new Uint8Array(0);
  const lookup = new Int8Array(256).fill(-1);
  for (let i = 0; i < 64; i++) {
    lookup["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(i)] = i;
  }
  const padding = cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0;
  const outLen = (cleaned.length / 4) * 3 - padding;
  const bytes = new Uint8Array(outLen);
  let p = 0;
  for (let i = 0; i < cleaned.length; i += 4) {
    const c0 = lookup[cleaned.charCodeAt(i)] ?? 0;
    const c1 = lookup[cleaned.charCodeAt(i + 1)] ?? 0;
    const c2 = lookup[cleaned.charCodeAt(i + 2)] ?? 0;
    const c3 = lookup[cleaned.charCodeAt(i + 3)] ?? 0;
    const v = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (p < outLen) bytes[p++] = (v >> 16) & 0xff;
    if (p < outLen) bytes[p++] = (v >> 8) & 0xff;
    if (p < outLen) bytes[p++] = v & 0xff;
  }
  return bytes;
}
// =================================================
// copyright 2026 by sleet.near
