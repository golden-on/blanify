import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["iife"],
  globalName: "BlanifyWidget",
  minify: true,
  target: "es2018",
  outDir: "dist",
  clean: true,
});
