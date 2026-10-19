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
/** Decode the router's base64 `args` payload into raw bytes.
 *
 *  Uses the platform's native `atob()` for the base64 step — it is
 *  available in Node 16+, Bun, Deno, and every modern browser, and
 *  correctly handles `=` padding (an earlier hand-rolled decoder in
 *  this file was wrong for padded inputs because the `=` char was
 *  not in its 64-char lookup, so the final byte became `0xff`
 *  instead of the real value). `context` is included in errors. */
export function decodeInstructionArgs(
  base64Args: string,
  context: string,
): Uint8Array {
  try {
    const text = atob(base64Args);
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
    return bytes;
  } catch (cause) {
    throw new DexAggregatorClientError({
      kind: "base64_decode",
      context,
      message: String((cause as Error)?.message ?? cause),
    });
  }
}
// =================================================
/** Decode the router's base64 `args` and return a JSON object ready to
 *  hand to near-kit's `TransactionBuilder.functionCall(contractId,
 *  methodName, args, options)`.
 *
 *  Most router args are valid JSON (the canonical contract-call
 *  payload), so we decode base64 → UTF-8 → JSON.parse. If the
 *  payload is not valid JSON we fall back to a string containing the
 *  base64 (some legacy raw-binary args still work as base64-encoded
 *  string arguments), and finally to the raw `Uint8Array` for
 *  true binary.
 *
 *  Returning a parsed object (not a `Uint8Array`) avoids a wallet-
 *  side serialization trap where JSON.stringify(Uint8Array) yields
 *  `{ "0": 123, "1": 34, ... }` — exactly what would have been
 *  sent to the contract as opaque "byte-indexed" object.
 *
 *  `context` is included in errors to identify the failing field
 *  (receiver + method). */
export function decodeInstructionArgsAsJson(
  base64Args: string,
  context: string,
): Record<string, unknown> | string | Uint8Array {
  const bytes = decodeInstructionArgs(base64Args, context);
  let text: string | null = null;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      console.debug(
        `[dex-aggregator.decode] ${context}: bytes(${bytes.length}) -> text(${text.length}) -> object`,
      );
      return parsed as Record<string, unknown>;
    }
    // string-shaped JSON (e.g. a quoted string) — pass straight through
    console.debug(
      `[dex-aggregator.decode] ${context}: bytes(${bytes.length}) -> text(${text.length}) -> text (not a JSON object)`,
    );
    return text;
  } catch (err) {
    console.debug(
      `[dex-aggregator.decode] ${context}: bytes(${bytes.length}) did NOT decode — ` +
        (text === null ? "not valid utf-8" : `not valid json (${(err as Error)?.message})`) +
        ` — returning raw bytes`,
      err,
    );
    return bytes;
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
// copyright 2026 by sleet.near
