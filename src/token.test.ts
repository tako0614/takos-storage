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
    aud: "storage.object",
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

  test("rejects a token with an empty prefix (whole-bucket guard)", async () => {
    const token = await mintStorageToken(SECRET, payload({ pfx: "" }));
    const result = await verifyStorageToken(SECRET, token, 1_000_100);
    expect(result.ok).toBe(false);
  });

  // Frozen cross-repo vector: this exact token was minted by the Takosumi issuer
  // (takosumi/core/shared/storage_access_tokens.ts). It must verify here, byte
  // for byte — if either implementation's wire format drifts, this fails.
  test("verifies a golden token minted by the Takosumi issuer", async () => {
    const GOLDEN =
      "takstor_eyJ2IjoxLCJ3cyI6InNwYWNlX2dvMWRnbzFkZ28xZGdvMWQiLCJzdWIiOiJpbnN0X2dvMWRnbzFkZ28xZGdvMWQiLCJwZngiOiJzcGFjZV9nbzFkZ28xZGdvMWRnbzFkL2luc3RfZ28xZGdvMWRnbzFkZ28xZC8iLCJjYXAiOlsiciIsInciLCJsIl0sImF1ZCI6InN0b3JhZ2Uub2JqZWN0IiwiaWF0IjoxMDAwMDAwMDAwLCJleHAiOjEwMDAwMDA5MDB9.UBtrbJQQ2AoiB1uSTzqc-fE_8b0F9rDXEdJ5JkQkpMQ";
    const result = await verifyStorageToken(
      "golden-key-fixed-0123456789abcdef",
      GOLDEN,
      1_000_000_500,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.aud).toBe("storage.object");
      expect(result.payload.pfx).toBe(
        "space_go1dgo1dgo1dgo1d/inst_go1dgo1dgo1dgo1d/",
      );
      expect(result.payload.cap).toEqual(["r", "w", "l"]);
    }
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

  test("empty prefix denies everything (whole-bucket guard)", () => {
    const p = payload({ pfx: "" });
    expect(tokenAllows(p, "r", "anything/at/all")).toBe(false);
  });
});
