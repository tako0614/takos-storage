/**
 * Home-screen install files: the web app manifest and its PNG icons.
 *
 * Browsers fetch these without credentials, so worker.ts serves them before
 * any auth or Drive route. The PNG bytes come from public/ through
 * web-app-icons.generated.ts.
 */

import manifest from "../public/manifest.webmanifest" with { type: "text" };
import { WEB_APP_ICONS } from "./web-app-icons.generated.ts";

export const WEB_APP_MANIFEST_PATH = "/manifest.webmanifest";

const decodedIcons = new Map<string, ArrayBuffer>();

function iconBytes(path: string): ArrayBuffer | null {
  const base64 = WEB_APP_ICONS[path];
  if (base64 === undefined) return null;
  let bytes = decodedIcons.get(path);
  if (!bytes) {
    bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
    decodedIcons.set(path, bytes);
  }
  return bytes;
}

export function webAppAssetResponse(
  request: Request,
  pathname: string,
): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  if (pathname === WEB_APP_MANIFEST_PATH) {
    return new Response(request.method === "HEAD" ? null : manifest, {
      headers: {
        "content-type": "application/manifest+json; charset=utf-8",
        "cache-control": "no-cache",
      },
    });
  }
  const bytes = iconBytes(pathname);
  if (!bytes) return null;
  return new Response(request.method === "HEAD" ? null : bytes, {
    headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400",
    },
  });
}
