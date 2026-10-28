/** Bounded streaming helpers shared by the object and user-drive surfaces. */

export const MAX_STORED_OBJECT_BYTES = 50 * 1024 * 1024;

const CONTENT_TYPE_PATTERN =
  /^[!#$%&'*+.^_`|~0-9A-Za-z-]+\/[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:[ \t]*;[\x20-\x7e]*)?$/u;

/**
 * The stored media type is uploader-controlled and travels back out on read,
 * so anything that is not a well-formed media type degrades to the inert
 * default instead of reaching a response header.
 */
export function storedContentType(value: string | null | undefined): string {
  const candidate = (value ?? "").trim();
  if (candidate.length === 0 || candidate.length > 255) {
    return "application/octet-stream";
  }
  return CONTENT_TYPE_PATTERN.test(candidate)
    ? candidate
    : "application/octet-stream";
}

export class RequestBodyTooLargeError extends Error {
  constructor() {
    super(`request body exceeds ${MAX_STORED_OBJECT_BYTES} bytes`);
    this.name = "RequestBodyTooLargeError";
  }
}

export type BoundedRequestBody =
  | {
      readonly ok: true;
      readonly body: ReadableStream<Uint8Array> | ArrayBuffer | string;
      readonly dispose: () => Promise<void>;
    }
  | { readonly ok: false; readonly status: 400 | 413; readonly error: string };

/**
 * Reject a declared oversize before touching R2, then count every streamed
 * byte so chunked requests cannot bypass the same limit. A stream error aborts
 * R2.put rather than publishing a partial object. Native R2 requires a known
 * body length: declared uploads keep streaming through FixedLengthStream;
 * headerless uploads are collected behind the same byte limit before storage
 * is called. Callers dispose the pipeline even when R2 refuses a precondition
 * without consuming it.
 */
export async function boundedRequestBody(
  request: Request,
  maximumBytes = MAX_STORED_OBJECT_BYTES,
): Promise<BoundedRequestBody> {
  const rawLength = request.headers.get("content-length");
  let declaredLength: number | undefined;
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
    declaredLength = declared;
  }

  if (!request.body) return { ok: true, body: "", dispose: async () => {} };
  if (declaredLength === undefined) {
    return readBoundedBuffer(request.body, maximumBytes);
  }
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
  const limited = request.body.pipeThrough(limiter);
  const FixedLength = (
    globalThis as {
      FixedLengthStream?: new (
        length: number,
      ) => ReadableWritablePair<Uint8Array, Uint8Array>;
    }
  ).FixedLengthStream;
  const body = FixedLength
    ? limited.pipeThrough(new FixedLength(declaredLength))
    : limited;
  return {
    ok: true,
    body,
    async dispose() {
      if (body.locked) return;
      try {
        await body.cancel();
      } catch {
        // Cancellation repeats an already-reported stream read error. Never
        // replace the caller's storage failure or conditional-write response.
      }
    },
  };
}

async function readBoundedBuffer(
  body: ReadableStream<Uint8Array>,
  maximumBytes: number,
): Promise<BoundedRequestBody> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      received += chunk.value.byteLength;
      if (received > maximumBytes) {
        // Release the actual request reader before returning a size refusal;
        // the runtime must still be able to finish/drain this HTTP request.
        await reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, error: "object_too_large" };
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, body: bytes.buffer, dispose: async () => {} };
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
