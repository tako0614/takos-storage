/** Bounded streaming helpers shared by the object and user-drive surfaces. */

export const MAX_STORED_OBJECT_BYTES = 50 * 1024 * 1024;

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`request body exceeds ${MAX_STORED_OBJECT_BYTES} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export type BoundedRequestBody =
  | { readonly ok: true; readonly body: ReadableStream<Uint8Array> | string }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

/**
 * Reject a declared oversize before touching R2, then count every streamed
 * byte so chunked requests cannot bypass the same limit. A stream error aborts
 * R2.put rather than publishing a partial object.
 */
export function boundedRequestBody(
  request: Request,
  maximumBytes = MAX_STORED_OBJECT_BYTES,
): BoundedRequestBody {
  const rawLength = request.headers.get("content-length");
  if (rawLength !== null) {
    if (!/^[0-9]+$/u.test(rawLength)) {
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    const declared = Number(rawLength);
    if (!Number.isSafeInteger(declared)) {
      return { ok: false, status: 400, error: "invalid_content_length" };
    }
    if (declared > maximumBytes) {
      return { ok: false, status: 413, error: "object_too_large" };
    }
  }

  if (!request.body) return { ok: true, body: "" };
  let received = 0;
  const limiter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      received += chunk.byteLength;
      if (received > maximumBytes) {
        controller.error(new RequestBodyTooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
  return { ok: true, body: request.body.pipeThrough(limiter) };
}

export function conditionalWriteHeaders(request: Request): Headers | undefined {
  const headers = new Headers();
  let hasPrecondition = false;
  for (const name of ["if-match", "if-none-match"] as const) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
      hasPrecondition = true;
    }
  }
  return hasPrecondition ? headers : undefined;
}
