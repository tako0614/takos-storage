/**
 * Builds the prebuilt Worker bundle uploaded by main.tf (`dist/worker.js`).
 * Kept dependency-free: a single Bun.build call, ESM output, no minify so the
 * artifact is auditable.
 */

export {};

const result = await Bun.build({
  entrypoints: ["src/worker.ts"],
  outdir: "dist",
  target: "browser",
  format: "esm",
  naming: "worker.js",
  minify: false,
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("takos-storage worker build failed");
}

console.log("built dist/worker.js");
