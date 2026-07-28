/**
 * Builds the prebuilt Worker bundle uploaded by main.tf (`dist/worker.js`).
 * Kept dependency-free: a single Bun.build call, ESM output, no minify so the
 * artifact is auditable.
 */

async function buildWorkerBundle(
  output: { outdir: string } | { write: false },
): Promise<void> {
  const result = await Bun.build({
    entrypoints: ["src/worker.ts"],
    target: "browser",
    format: "esm",
    naming: "worker.js",
    minify: false,
    ...output,
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error("takos-storage worker build failed");
  }
}

export async function buildWorker(outdir = "dist"): Promise<void> {
  await buildWorkerBundle({ outdir });
}

export async function checkWorkerBuild(): Promise<void> {
  await buildWorkerBundle({ write: false });
}

if (import.meta.main) {
  if (Bun.argv.includes("--check")) {
    await checkWorkerBuild();
    console.log("Worker bundle builds successfully");
  } else {
    await buildWorker();
    console.log("built dist/worker.js");
  }
}
