import { expect, test } from "bun:test";

import {
  boundedRequestBody,
  MAX_STORED_OBJECT_BYTES,
  RequestBodyTooLargeError,
} from "./http-body.ts";

function upload(body: ReadableStream<Uint8Array>, length?: string): Request {
  return new Request("https://storage.example.test/api/drive/file/fixture", {
    method: "PUT",
    body,
    ...(length === undefined ? {} : { headers: { "content-length": length } }),
  });
}

function chunks(...values: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const value of values) controller.enqueue(new Uint8Array(value));
      controller.close();
    },
  });
}

test("chunked uploads reach storage as a known-length body with the exact bytes", async () => {
  const result = await boundedRequestBody(upload(chunks([1, 2], [3, 4])), 4);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  // Native R2 refuses a transformed stream without a known length. The
  // headerless path must finish the bounded read before calling storage.
  expect(result.body).toBeInstanceOf(ArrayBuffer);
  expect(
    Array.from(new Uint8Array(await new Response(result.body).arrayBuffer())),
  ).toEqual([1, 2, 3, 4]);
});

test("chunked overflow is refused before a storage body can be returned", async () => {
  const result = await boundedRequestBody(upload(chunks([1, 2], [3, 4])), 3);
  expect(result).toEqual({ ok: false, status: 413, error: "object_too_large" });
});

test("a rejected chunked body releases the request reader for normal recovery", async () => {
  let cancelled = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2]));
      controller.enqueue(new Uint8Array([3, 4]));
    },
    cancel() {
      cancelled += 1;
    },
  });
  const request = upload(stream);
  expect(await boundedRequestBody(request, 3)).toEqual({
    ok: false,
    status: 413,
    error: "object_too_large",
  });
  expect(request.body?.locked).toBe(false);
  expect(cancelled).toBe(1);
});

test("invalid or oversized declared lengths do not read the upload", async () => {
  expect(MAX_STORED_OBJECT_BYTES).toBe(50 * 1024 * 1024);
  for (const [length, status] of [
    ["-1", 400],
    ["1.5", 400],
    ["5", 413],
  ] as const) {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull() {
          reads += 1;
        },
      },
      { highWaterMark: 0 },
    );
    const result = await boundedRequestBody(upload(stream, length), 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(status);
    expect(reads).toBe(0);
  }
});

test("declared uploads retain the byte counter instead of trusting the header", async () => {
  const result = await boundedRequestBody(upload(chunks([1, 2]), "1"), 1);
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  try {
    await expect(
      new Response(result.body).arrayBuffer(),
    ).rejects.toBeInstanceOf(RequestBodyTooLargeError);
  } finally {
    if ("dispose" in result) await result.dispose();
  }
});

test("an early storage refusal can release the pending input pipeline", async () => {
  let cancelled!: () => void;
  const cancellation = new Promise<void>((resolve) => {
    cancelled = resolve;
  });
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array([1]));
    },
    cancel() {
      cancelled();
    },
  });
  const result = await boundedRequestBody(upload(stream, "1"));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect("dispose" in result).toBe(true);
  if (!("dispose" in result)) return;
  await result.dispose();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      cancellation,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("input was not cancelled")),
          1000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
});

test("input failures stay failures instead of becoming partial chunked objects", async () => {
  const failure = new Error("synthetic input interrupted");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.error(failure);
    },
  });
  await expect(boundedRequestBody(upload(stream))).rejects.toBe(failure);
});
