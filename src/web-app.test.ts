import { describe, expect, test } from "bun:test";

import {
  APPLE_TOUCH_ICON_PATH,
  publicFile,
  webAppIconPaths,
} from "../scripts/generate-web-app-icons.ts";
import { storageConsoleHtml } from "./console.ts";
import type { Env, R2Bucket } from "./types.ts";
import { WEB_APP_ICONS } from "./web-app-icons.generated.ts";
import { createStorageWorker } from "./worker.ts";

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

async function manifest(): Promise<
  { icons: ManifestIcon[] } & Record<string, unknown>
> {
  return (await Bun.file(publicFile("/manifest.webmanifest")).json()) as {
    icons: ManifestIcon[];
  } & Record<string, unknown>;
}

async function fileBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(publicFile(path)).arrayBuffer());
}

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  // PNG signature, then the IHDR chunk: width/height are big-endian u32 at 16/20.
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(new TextDecoder().decode(bytes.subarray(12, 16))).toBe("IHDR");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

// An unused bucket and no browser session: the state a browser is in when it
// fetches the manifest and icons, which it does without credentials.
const anonymousEnv = {
  BUCKET: {} as R2Bucket,
  APP_URL: "https://storage.example",
  OIDC_ISSUER_URL: "https://accounts.example",
} as Env;

function get(path: string): Promise<Response> {
  return createStorageWorker().fetch(
    new Request(`https://storage.example${path}`),
    anonymousEnv,
  );
}

describe("web app manifest", () => {
  test("declares a standalone same-origin app", async () => {
    expect(await manifest()).toMatchObject({
      id: "/",
      name: "Takos Storage",
      short_name: "Storage",
      lang: "en",
      start_url: "/",
      scope: "/",
      display: "standalone",
      theme_color: "#f6f8fc",
      background_color: "#f6f8fc",
    });
    expect(String((await manifest()).description).length).toBeGreaterThan(0);
  });

  test("every declared icon exists at its declared pixel size", async () => {
    const icons = (await manifest()).icons;
    expect(icons.map((icon) => `${icon.sizes}:${icon.purpose}`).sort()).toEqual(
      ["192x192:any", "512x512:any", "512x512:maskable"],
    );
    for (const icon of icons) {
      expect(icon.type).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(pngSize(await fileBytes(icon.src))).toEqual({ width, height });
    }
    expect(pngSize(await fileBytes(APPLE_TOUCH_ICON_PATH))).toEqual({
      width: 180,
      height: 180,
    });
  });

  test("the generated module embeds the current PNG bytes", async () => {
    // Out of date? Run `bun run scripts/generate-web-app-icons.ts`.
    expect(Object.keys(WEB_APP_ICONS).sort()).toEqual(await webAppIconPaths());
    for (const [path, base64] of Object.entries(WEB_APP_ICONS)) {
      expect(base64).toBe(
        Buffer.from(await fileBytes(path)).toString("base64"),
      );
    }
  });

  test("the console links the manifest, a 180px apple-touch-icon and theme-color", () => {
    const html = storageConsoleHtml();
    expect(html).toContain(
      '<link rel="manifest" href="/manifest.webmanifest">',
    );
    expect(html).toContain(
      '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">',
    );
    expect(html).toContain('<meta name="theme-color" content="#f6f8fc"');
  });

  test("the Worker serves the manifest and icons without credentials", async () => {
    const manifestResponse = await get("/manifest.webmanifest");
    expect(manifestResponse.status).toBe(200);
    expect(manifestResponse.headers.get("content-type")).toStartWith(
      "application/manifest+json",
    );
    expect(await manifestResponse.json()).toEqual(await manifest());

    for (const path of await webAppIconPaths()) {
      const icon = await get(path);
      expect(icon.status).toBe(200);
      expect(icon.headers.get("content-type")).toBe("image/png");
      expect([...new Uint8Array(await icon.arrayBuffer())]).toEqual([
        ...(await fileBytes(path)),
      ]);
    }
  });
});
