// ==========================================
// Smallest possible Bun.serve that hosts the HTML demo, binds
// 0.0.0.0 so a phone on the LAN can reach it, and lets Bun's HTML
// import bundler handle the TS-on-the-fly compilation.
//
// Run: bun run server.ts
// Visit: http://<lan-ip>:5180/ on the phone.
// ==========================================
import index from "./index.html";

Bun.serve({
  port: Number(process.env["PORT"] ?? 5180),
  hostname: "0.0.0.0",
  development: true,
  routes: { "/": index },
});
