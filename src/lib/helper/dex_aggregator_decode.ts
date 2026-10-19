// =================================================
// dex_aggregator_decode
// Convert base64 / gas / deposit values from the router's wire format
// into the shapes near-kit expects on `Action.functionCall`.
//
// near-kit accepts `gas: number | bigint | string` ("30 Tgas" or
// raw gas units as a string) and `attachedDeposit: Amount` (a string
// ending in " NEAR" or " yocto", or a bigint of raw yoctoNEAR).
// The router emits gas as a raw u64 and deposit as a yoctoNEAR
// decimal string, so we pre-process once here and call sites stay
// tidy.
// =================================================
import { DexAggregatorClientError } from "./dex_aggregator_client.ts";
// =================================================
/** Decode a base64 `args` payload from an execution instruction into
 *  raw bytes ready for near-kit's `TransactionBuilder.functionCall`.
 *
 *  `context` is included in errors to identify the failing field
 *  (receiver + method). */
export function decodeInstructionArgs(
  base64Args: string,
  context: string,
): Uint8Array {
  // We hand-roll a base64 decoder to keep this package dependency-
  // free for browsers that don't ship Buffer. Node 18+ has
  // atob/btoa for ASCII inputs but we need binary-safe decoding;
  // simplest portable path is to slice & re-bin from string indices.
  try {
    return base64ToBytes(base64Args);
  } catch (cause) {
    throw new DexAggregatorClientError({
      kind: "base64_decode",
      context,
      message: String((cause as Error)?.message ?? cause),
    });
  }
}
// =================================================
/** Convert a router `gas` value (raw u64, number-or-string on the
 *  wire) into a string accepted by `parseGas`. near-kit accepts raw
 *  gas numbers as a string via `parseGas`, e.g. `"5000000000000"`. */
export function gasFromRoute(gas: number | string): string {
  if (typeof gas === "number") {
    if (!Number.isFinite(gas)) {
      throw new DexAggregatorClientError({
        kind: "invalid_number",
        context: "gas",
        value: String(gas),
        message: "gas must be a finite number",
      });
    }
    return Math.trunc(gas).toString();
  }
  const trimmed = gas.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new DexAggregatorClientError({
      kind: "invalid_number",
      context: "gas",
      value: gas,
      message: "gas must be a non-negative integer",
    });
  }
  return trimmed;
}
// =================================================
/** Parse a router `deposit` (yoctoNEAR decimal string or number)
 *  into a `bigint` of yoctoNEAR. `near-kit`'s `parseAmount` accepts
 *  bigint for raw yocto. */
export function depositFromRoute(deposit: string | number): bigint {
  let raw: string;
  if (typeof deposit === "number") {
    if (!Number.isFinite(deposit)) {
      throw new DexAggregatorClientError({
        kind: "invalid_number",
        context: "deposit",
        value: String(deposit),
        message: "deposit must be a finite number",
      });
    }
    raw = BigInt(Math.trunc(deposit)).toString();
  } else {
    raw = deposit.trim();
  }
  if (!/^\d+$/.test(raw)) {
    throw new DexAggregatorClientError({
      kind: "invalid_number",
      context: "deposit (expected yoctoNEAR decimal string)",
      value: String(deposit),
      message: "deposit must be a non-negative integer",
    });
  }
  return BigInt(raw);
}
// =================================================
/** Decode a base64 string to bytes using `Uint8Array` from string.
 *  Compatible with Node 18+, Bun, Deno, and modern browsers. */
function base64ToBytes(input: string): Uint8Array {
  const cleaned = input.replace(/[^A-Za-z0-9+/=]/g, "");
  if (cleaned.length === 0) return new Uint8Array(0);
  const lookup = new Int8Array(256).fill(-1);
  for (let i = 0; i < 64; i++) {
    lookup["ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/".charCodeAt(i)] = i;
  }
  const padding = (cleaned.endsWith("==") ? 2 : cleaned.endsWith("=") ? 1 : 0);
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
