import { defineConfig } from "@rsbuild/core";
// ==========================================
// rsbuild config for the dex-aggregator tool box HTML demo.
// Mirror `sleet-hot-hello/html`:
//   * entry ./src/index.ts
//   * template ./public/index.html
//   * inline scripts + styles so the dev build is one file.
//
// The demo imports `../../../src/index.ts` directly so the working
// copy of the library always tracks your edits — no `bun link`
// step needed.
// ==========================================
export default defineConfig({
  html: {
    template: "./public/index.html",
    title: "intear dex-aggregator demo",
  },
  output: {
    inlineScripts: true,
    inlineStyles: true,
  },
  server: {
    port: 5180,
  },
});