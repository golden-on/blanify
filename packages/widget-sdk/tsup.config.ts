import { defineConfig } from "tsup";

export default defineConfig({
  entry: { widget: "src/index.ts" },
  format: ["iife"],
  globalName: "BlanifyWidget",
  minify: true,
  target: "es2018",
  outDir: "dist",
  outExtension: () => ({ js: ".js" }),
  clean: true,
});
