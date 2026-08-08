import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "tsup";
import { afterAll, describe, expect, it } from "vitest";

const outDir = mkdtempSync(join(tmpdir(), "widget-sdk-build-test-"));

describe("widget-sdk standalone bundle", () => {
  afterAll(() => {
    rmSync(outDir, { recursive: true, force: true });
  });

  it("builds cleanly to a single self-contained widget.js file", async () => {
    await build({
      entry: { widget: "src/index.ts" },
      format: ["iife"],
      globalName: "BlanifyWidget",
      minify: true,
      target: "es2018",
      outDir,
      outExtension: () => ({ js: ".js" }),
      clean: true,
      silent: true,
    });

    const outputPath = join(outDir, "widget.js");
    expect(existsSync(outputPath)).toBe(true);

    const contents = readFileSync(outputPath, "utf-8");
    expect(contents.length).toBeGreaterThan(200);
    expect(contents).toContain("vacation-booking-widget");
  }, 30000);
});
