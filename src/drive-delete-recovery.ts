import type { R2Bucket, R2Object } from "./types.ts";
import { isValidDrivePath } from "./drive-path.ts";
import {
  DRIVE_PREFIX,
  deleteDriveObject,
  exactContentEtag,
  isDriveDeletionTombstone,
} from "./drive-operations.ts";

export class PendingDeletionError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "PendingDeletionError";
  }
}

/**
 * Public revision guard, not authority. Never disclose the marker's current
 * ETag or nonce: supported writers must not reuse it during physical cleanup.
 * Legacy empty/unknown markers require separate operator review.
 */
export async function pendingDeletionRevision(
  path: string,
  object: R2Object,
): Promise<string | null> {
  if (
    !isValidDrivePath(path) ||
    !isDriveDeletionTombstone(object) ||
    object.size !== 36 ||
    !exactContentEtag(object.httpEtag)
  )
    return null;
  const bytes = new TextEncoder().encode(
    JSON.stringify(["takos-storage.pending-delete.v1", path, object.httpEtag]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function checkedMarkerEtag(
  bucket: R2Bucket,
  path: string,
  expectedRevision: string,
): Promise<string> {
  const object = await bucket.get(DRIVE_PREFIX + path);
  if (!object) throw new PendingDeletionError("not_found", 404);
  let etag: string;
  try {
    if (!isDriveDeletionTombstone(object))
      throw new PendingDeletionError("not_pending_deletion", 409);
    const current = await pendingDeletionRevision(path, object);
    if (!current)
      throw new PendingDeletionError("cleanup_requires_operator_review", 409);
    if (current !== expectedRevision)
      throw new PendingDeletionError("revision_conflict", 412);
    // Current producers use fresh UUIDv4 marker content. An old empty marker
    // has a predictable content ETag and cannot safely use this online path.
    const bytes = new Uint8Array(await object.arrayBuffer());
    const nonce = new TextDecoder().decode(bytes);
    if (
      bytes.byteLength !== 36 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        nonce,
      )
    ) {
      throw new PendingDeletionError("cleanup_requires_operator_review", 409);
    }
    etag = object.httpEtag!;
  } finally {
    await object.body.cancel().catch(() => undefined);
  }
  return etag;
}

/** Read-only inspection; the internal ETag is deliberately not returned. */
export async function inspectPendingDeletion(
  bucket: R2Bucket,
  path: string,
  expectedRevision: string,
): Promise<void> {
  await checkedMarkerEtag(bucket, path, expectedRevision);
}

/** Caller owns the existing Drive authorization and validated relative path. */
export async function finishPendingDeletion(
  bucket: R2Bucket,
  path: string,
  expectedRevision: string,
): Promise<void> {
  const etag = await checkedMarkerEtag(bucket, path, expectedRevision);
  // Replaces the observed marker by another fresh nonce under CAS. A stale
  // cleanup cannot raw-delete a different revision or an ordinary replacement.
  await deleteDriveObject(bucket, path, etag);
}
