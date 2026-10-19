#!/usr/bin/env bun
// =================================================
// build
// Stage `./dist` for npm publishing.
//
// We ship source files (verbatim) rather than transpiled JS: bun,
// Node 22+, Deno, and most modern bundlers resolve `.ts` imports
// natively. Shipping `.ts` lets consumers get exact types and
// source maps without a tsc step on our end.
//
// `bin/` and `html/` live at the repo root and are NOT included
// here — the bin is for maintainers, the html workspace is for
// the browser demo. `package.json#files` includes `dist/**` and
// excludes `*.test.ts` so neither leaks into the published tarball.
// =================================================
import { cp, rm, mkdir } from "node:fs/promises";

const SRC_DIR = "src";
const OUT_DIR = "dist";

await rm(OUT_DIR, { recursive: true, force: true });
await mkdir(OUT_DIR, { recursive: true });
await cp(SRC_DIR, OUT_DIR, { recursive: true });

const proc = Bun.spawn(["find", OUT_DIR, "-type", "f"], { stdout: "pipe" });
const text = await new Response(proc.stdout).text();
const files = text.trim().split("\n").sort();
console.log(`staged ${files.length} file(s) into ${OUT_DIR}/`);
for (const f of files) console.log(`  ${f}`);