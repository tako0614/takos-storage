import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

import type { Env } from "../src/types.ts";
import { buildWorker } from "./build-worker.ts";

test("the built Worker artifact keeps the drive fail-closed", async () => {
  const outdir = await mkdtemp(`${tmpdir()}/takos-storage-artifact-`);
  try {
    await buildWorker(outdir);
    const built = (await import(
      `${pathToFileURL(`${outdir}/worker.js`).href}?test=${crypto.randomUUID()}`
    )) as {
      default: {
        fetch(request: Request, env: Env): Promise<Response>;
      };
    };
    const response = await built.default.fetch(
      new Request("https://storage.example/api/drive/list"),
      {
        // Authentication fails before the bucket is touched.
        BUCKET: {} as Env["BUCKET"],
      },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "app_auth_not_configured",
      missing: [
        "APP_URL",
        "OIDC_ISSUER_URL",
        "OIDC_CLIENT_ID",
        "APP_SESSION_SECRET",
      ],
    });
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
});
