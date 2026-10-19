// ==========================================
// Bun-native HTML demo server.
//
// No rsbuild. No bundler. Bun.serve with HTML imports — Bun
// transpiles TypeScript on the fly, serves the HTML at /, and the
// browser fetches the bundled `index.ts` from the same origin.
//
// Run: bun run server.ts
// open http://localhost:5180/
// ==========================================
import index from "./public/index.html";

const server = Bun.serve({
  port: Number(process.env["PORT"] ?? 5180),
  hostname: process.env["HOST"] ?? "0.0.0.0",
  development: true,
  routes: {
    "/": index,
  },
});

console.log(`server running at ${server.url}`);
