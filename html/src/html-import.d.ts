// Bun's HTML-import feature lets a .ts file do `import x from "./x.html"`
// and get a pre-bundled HTML response. TypeScript doesn't know about it
// without a small ambient declaration.
declare module "*.html" {
  const html: { readonly url: string; readonly html: string };
  export default html;
}
