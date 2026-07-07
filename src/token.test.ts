import { describe, expect, test } from "bun:test";

import {
  mintStorageToken,
  type StorageTokenPayload,
  tokenAllows,
  verifyStorageToken,
} from "./token.ts";

const SECRET = "signing-key-for-tests-0123456789";

function payload(over: Partial<StorageTokenPayload> = {}): StorageTokenPayload {
  const now = 1_000_000;
  return {
    v: 1,
    ws: "ws1",
    sub: "inst-consumer",
    pfx: "ws1/",
    cap: ["r", "w", "d", "l"],
    aud: "takos.storage.workspace",
    iat: now,
    exp: now + 3600,
    ...over,
  };
}

describe("storage token mint/verify", () => {
  test("round-trips a valid token", async () => {
    const token = await mintStorageToken(SECRET, payload());
    expect(token.startsWith("takstor_")).toBe(true);
    const result = await verifyStorageToken(SECRET, token, 1_000_100);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.payload.sub).toBe("inst-consumer");
  });

  test("rejects a tampered signature", async () => {
    const token = await mintStorageToken(SECRET, payload());
    const tampered = `${token.slice(0, -2)}xy`;
    const result = await verifyStorageToken(SECRET, tampered, 1_000_100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  test("rejects a token signed with a different key", async () => {
    const token = await mintStorageToken(SECRET, payload());
    const result = await verifyStorageToken("some-other-key", token, 1_000_100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("signature");
  });

  test("rejects an expired token", async () => {
    const token = await mintStorageToken(SECRET, payload({ exp: 1_000_050 }));
    const result = await verifyStorageToken(SECRET, token, 1_000_100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  test("rejects a non-token string", async () => {
    const result = await verifyStorageToken(SECRET, "not-a-token", 1_000_100);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("format");
  });
});

describe("tokenAllows", () => {
  test("honors verb set", () => {
    const p = payload({ cap: ["r", "l"] });
    expect(tokenAllows(p, "r", "ws1/a.txt")).toBe(true);
    expect(tokenAllows(p, "w", "ws1/a.txt")).toBe(false);
  });

  test("confines to the prefix", () => {
    const p = payload({ pfx: "ws1/office/" });
    expect(tokenAllows(p, "r", "ws1/office/doc.md")).toBe(true);
    expect(tokenAllows(p, "r", "ws1/other/doc.md")).toBe(false);
  });

  test("empty prefix means whole bucket", () => {
    const p = payload({ pfx: "" });
    expect(tokenAllows(p, "r", "anything/at/all")).toBe(true);
  });
});
