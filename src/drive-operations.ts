import type { R2Bucket, R2Object, R2ObjectBody } from "./types.ts";

export const DRIVE_PREFIX = "drive/";
const DELETION_MARKER = "takos-storage-deleting";

export function exactContentEtag(value: unknown): string | null {
  return typeof value === "string" &&
    value.length <= 256 &&
    /^"[\x21\x23-\x7e]+"$/u.test(value)
    ? value
    : null;
}

export function isDriveDeletionTombstone(
  object: Pick<R2Object, "customMetadata">,
): boolean {
  return object.customMetadata?.[DELETION_MARKER] === "1";
}

export class DriveOperationError extends Error {
  constructor(
    readonly code:
      | "not_found"
      | "destination_exists"
      | "revision_conflict"
      | "missing_etag"
      | "move_incomplete"
      | "too_large",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DriveOperationError";
  }
}

function driveKey(path: string): string {
  return `${DRIVE_PREFIX}${path}`;
}

function requireDriveObject<T extends R2Object>(
  object: T | null,
  path: string,
): T {
  if (!object || isDriveDeletionTombstone(object)) {
    throw new DriveOperationError("not_found", `file not found: ${path}`);
  }
  return object;
}

export async function headDriveObject(
  bucket: R2Bucket,
  path: string,
): Promise<R2Object> {
  return requireDriveObject(await bucket.head(driveKey(path)), path);
}

export async function getDriveObject(
  bucket: R2Bucket,
  path: string,
): Promise<R2ObjectBody> {
  return requireDriveObject(await bucket.get(driveKey(path)), path);
}

/**
 * Commit a logical delete with an ETag-guarded tombstone before removing the
 * physical key. Supported conditional writers cannot reuse the old content
 * ETag after the fresh marker has committed.
 */
export async function deleteDriveObject(
  bucket: R2Bucket,
  path: string,
  expectedEtag: string,
): Promise<void> {
  return deleteStoredObject(bucket, driveKey(path), expectedEtag);
}

/** The caller owns authorization and physical-key namespace validation. */
export async function deleteStoredObject(
  bucket: R2Bucket,
  key: string,
  expectedEtag: string,
): Promise<void> {
  // R2 validators identify content, not metadata. An empty marker retains an
  // empty file's ETag and admits a stale writer before physical removal.
  // Fresh marker content makes the logical delete change that validator too.
  const tombstone = await bucket.put(key, crypto.randomUUID(), {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { [DELETION_MARKER]: "1" },
    onlyIf: new Headers({ "if-match": expectedEtag }),
  });
  if (!tombstone) {
    throw new DriveOperationError(
      "revision_conflict",
      "object content changed before deletion",
    );
  }
  await bucket.delete(key);
}

/**
 * R2 has no atomic rename. Copy create-only by default, or replace a caller's
 * observed destination content ETag, then remove the source by CAS tombstone.
 * Create-only copies retain the existing best-effort conditional rollback.
 * A replacement copy is retained on later failure and must be reconciled;
 * content ETags cannot prove a safe restoration across metadata-only/ABA writes.
 * Folder snapshots explicitly retain every copied destination on failure;
 * existing single-file callers keep their default compensation policy.
 */
export async function moveDriveObject(
  bucket: R2Bucket,
  sourcePath: string,
  destinationPath: string,
  expectedSourceEtag: string,
  maximumBytes: number,
  replacement?: { expectedDestinationEtag: string },
  options: { retainCopyOnFailure?: boolean } = {},
): Promise<{ size: number; contentType: string }> {
  const source = await getDriveObject(bucket, sourcePath);
  if (source.size > maximumBytes) {
    throw new DriveOperationError(
      "too_large",
      `file exceeds the ${maximumBytes}-byte move limit`,
    );
  }
  if (!source.httpEtag) {
    throw new DriveOperationError(
      "missing_etag",
      `source has no ETag: ${sourcePath}`,
    );
  }
  if (source.httpEtag !== expectedSourceEtag) {
    throw new DriveOperationError(
      "revision_conflict",
      `source changed before move: ${sourcePath}`,
    );
  }
  const contentType =
    source.httpMetadata?.contentType ?? "application/octet-stream";
  if (replacement) {
    const destination = await getDriveObject(bucket, destinationPath);
    try {
      if (destination.httpEtag !== replacement.expectedDestinationEtag) {
        throw new DriveOperationError(
          "revision_conflict",
          `destination changed before move: ${destinationPath}`,
        );
      }
    } finally {
      await destination.body.cancel();
    }
  }
  const copied = await bucket.put(driveKey(destinationPath), source.body, {
    httpMetadata: { ...source.httpMetadata, contentType },
    customMetadata: source.customMetadata,
    onlyIf: replacement
      ? new Headers({ "if-match": replacement.expectedDestinationEtag })
      : { etagDoesNotMatch: "*" },
  });
  if (!copied) {
    throw new DriveOperationError(
      replacement ? "revision_conflict" : "destination_exists",
      `destination already exists or changed: ${destinationPath}`,
    );
  }
  if (!copied.httpEtag) {
    throw new DriveOperationError(
      replacement ? "move_incomplete" : "missing_etag",
      `destination copy has no ETag; inspect both paths before retrying: ${destinationPath}`,
    );
  }
  try {
    await deleteDriveObject(bucket, sourcePath, source.httpEtag);
  } catch (error) {
    if (replacement || options.retainCopyOnFailure) {
      throw new DriveOperationError(
        "move_incomplete",
        "destination was copied but source removal failed; inspect both paths before retrying",
        { cause: error },
      );
    }
    if (
      error instanceof DriveOperationError &&
      error.code === "revision_conflict"
    ) {
      // The source remains intact. Compensate only this content ETag; this
      // does not distinguish same-byte metadata changes or an ABA sequence.
      await deleteDriveObject(bucket, destinationPath, copied.httpEtag).catch(
        () => undefined,
      );
    }
    // Any other error may mean the source tombstone committed but its physical
    // removal failed. Retain the destination as the only guaranteed data copy.
    throw error;
  }
  return { size: source.size, contentType };
}
