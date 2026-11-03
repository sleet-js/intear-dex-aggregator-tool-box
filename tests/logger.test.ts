// =================================================
// Unit tests for the diagnostic logger.
// =================================================

import { describe, expect, test } from "bun:test";
import {
  console_logger,
  null_logger,
  type logger,
} from "../src/lib/logger";

const capture_console = (): { lines: string[]; restore: () => void } => {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };
  const lines: string[] = [];
  const capture = (channel: keyof typeof original) => (line: unknown) => {
    lines.push(`[${channel}] ${String(line)}`);
  };
  console.log = capture("log") as typeof original.log;
  console.warn = capture("warn") as typeof original.warn;
  console.error = capture("error") as typeof original.error;
  return {
    lines,
    restore: () => {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
};

describe("console_logger", () => {
  test("level none emits nothing", () => {
    const capture = capture_console();
    try {
      const logger = new console_logger("none");
      logger.info("event", { value: 1 });
      logger.warn("event", { value: 1 });
      logger.debug("event", { value: 1 });
      logger.error("event", { value: 1 });
      expect(capture.lines).toEqual([]);
    } finally {
      capture.restore();
    }
  });

  test("level info emits one structured line", () => {
    const capture = capture_console();
    try {
      const logger = new console_logger("info");
      logger.info("route update", { id: 1, route_count: 2 });
      expect(capture.lines).toHaveLength(1);
      expect(capture.lines[0]).toContain("[dex_aggregator:info]");
      expect(capture.lines[0]).toContain("route update");
      expect(capture.lines[0]).toContain("id=1");
      expect(capture.lines[0]).toContain("route_count=2");
    } finally {
      capture.restore();
    }
  });

  test("level warn includes warnings and errors but not debug", () => {
    const capture = capture_console();
    try {
      const logger = new console_logger("warn");
      logger.info("info", {});
      logger.warn("warn", {});
      logger.debug("debug", {});
      logger.error("error", {});
      expect(capture.lines).toHaveLength(3);
      expect(capture.lines.some((line) => line.includes("[dex_aggregator:debug]"))).toBe(false);
    } finally {
      capture.restore();
    }
  });

  test("level debug emits everything", () => {
    const capture = capture_console();
    try {
      const logger = new console_logger("debug");
      logger.info("info", {});
      logger.warn("warn", {});
      logger.debug("debug", {});
      logger.error("error", {});
      expect(capture.lines).toHaveLength(4);
    } finally {
      capture.restore();
    }
  });
});

describe("null_logger", () => {
  test("never throws and never emits", () => {
    const logger: logger = new null_logger();
    expect(() => logger.info("event", {})).not.toThrow();
    expect(() => logger.warn("event", {})).not.toThrow();
    expect(() => logger.debug("event", {})).not.toThrow();
    expect(() => logger.error("event", {})).not.toThrow();
  });
});
// =================================================
// copyright 2026 by sleet.near
// =================================================
