// =================================================
// Diagnostic logging.
//
// Two pieces:
//   1. `log_level` — a verbosity threshold. Default `none` (silent).
//      `info` adds one line per HTTP request and subscription lifecycle
//      event; `warn` also surfaces request and socket failures; `debug`
//      adds per-update traces and response previews.
//   2. `logger` — a pluggable sink. Defaults to `console_logger`, which
//      routes to `console.{log, warn, error}`. Consumers can swap it for
//      pino, winston, datadog, etc., by passing a `logger` to
//      `DEX_AGGREGATOR_CLIENT`.
//
// Every entry is one line and every field is rendered as `key=value`, so
// a quick grep finds the operation that owns a diagnostic.
// =================================================

export const DEX_AGGREGATOR_LOG_LEVELS = ["none", "info", "warn", "debug"] as const;
export type log_level = (typeof DEX_AGGREGATOR_LOG_LEVELS)[number];

const level_rank: Record<log_level, number> = {
  none: 0,
  info: 1,
  warn: 2,
  debug: 3,
};

/** The subset of a logger the toolbox uses. Keeping this separate lets
 *  callers share one logger implementation across both packages. */
export interface diagnostic_logger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
  debug(event: string, fields: Record<string, unknown>): void;
  error(event: string, fields: Record<string, unknown>): void;
}

/** A diagnostic sink. Implement this to redirect logs elsewhere. */
export type logger = diagnostic_logger;

/** Default console-backed sink. Silent when the level is `none`. */
export class console_logger implements diagnostic_logger {
  readonly #level: log_level;
  constructor(level: log_level) {
    this.#level = level;
  }

  #emit(needed: log_level, channel: string, event: string, fields: Record<string, unknown>): void {
    if (level_rank[this.#level] < level_rank[needed]) return;
    const flat = Object.entries(fields)
      .map(([key, value]) => `${key}=${format_log_value(value)}`)
      .join(" ");
    const line = `[dex_aggregator:${channel}] ${event}${flat.length > 0 ? ` ${flat}` : ""}`;
    if (channel === "error") console.error(line);
    else if (channel === "warn") console.warn(line);
    else console.log(line);
  }

  info(event: string, fields: Record<string, unknown>): void {
    this.#emit("info", "info", event, fields);
  }

  warn(event: string, fields: Record<string, unknown>): void {
    this.#emit("warn", "warn", event, fields);
  }

  debug(event: string, fields: Record<string, unknown>): void {
    this.#emit("debug", "debug", event, fields);
  }

  error(event: string, fields: Record<string, unknown>): void {
    // Errors are emitted at `info` threshold so `level: "none"` remains
    // completely silent. A custom logger can always ignore this filter.
    this.#emit("info", "error", event, fields);
  }
}

/** A sink that never emits. */
export class null_logger implements diagnostic_logger {
  info(_event: string, _fields: Record<string, unknown>): void {}
  warn(_event: string, _fields: Record<string, unknown>): void {}
  debug(_event: string, _fields: Record<string, unknown>): void {}
  error(_event: string, _fields: Record<string, unknown>): void {}
}

// Render a value for one-line log output. BigInt and cyclic objects must
// not make diagnostics throw.
const format_log_value = (value: unknown): string => {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "bigint") return `${value.toString()}n`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};
// =================================================
// copyright 2026 by sleet.near
// =================================================
