import type { R2Bucket, R2Object } from "./types.ts";

export const DRIVE_PREFIX = "drive/";
const DELETION_MARKER = "takos-storage-deleting";

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
      | "too_large",
    message: string,
  ) {
    super(message);
    this.name = "DriveOperationError";
  }
}

function driveKey(path: string): string {
  return `${DRIVE_PREFIX}${path}`;
}

export async function getDriveObject(
  bucket: R2Bucket,
  path: string,
): Promise<R2Object> {
  const object = await bucket.get(driveKey(path));
  if (!object || isDriveDeletionTombstone(object)) {
    throw new DriveOperationError("not_found", `file not found: ${path}`);
  }
  return object;
}

/**
 * Commit a logical delete with an ETag-guarded tombstone before removing the
 * physical key. All supported drive writers use CAS, so a concurrent update
 * can neither be mistaken for this revision nor be deleted afterwards.
 */
export async function deleteDriveObject(
  bucket: R2Bucket,
  path: string,
  expectedEtag: string,
): Promise<void> {
  const key = driveKey(path);
  const tombstone = await bucket.put(key, "", {
    httpMetadata: { contentType: "application/octet-stream" },
    customMetadata: { [DELETION_MARKER]: "1" },
    onlyIf: { etagMatches: expectedEtag },
  });
  if (!tombstone) {
    throw new DriveOperationError(
      "revision_conflict",
      `file changed before deletion: ${path}`,
    );
  }
  await bucket.delete(key);
}

/**
 * R2 has no atomic rename. Copy the source stream create-only, then remove the
 * exact source revision via a CAS tombstone. On a source race, roll the copied
 * destination back with its own ETag; no newer file is ever overwritten.
 */
export async function moveDriveObject(
  bucket: R2Bucket,
  sourcePath: string,
  destinationPath: string,
  expectedSourceEtag: string,
  maximumBytes: number,
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
  const copied = await bucket.put(driveKey(destinationPath), source.body, {
    httpMetadata: { contentType },
    onlyIf: { etagDoesNotMatch: "*" },
  });
  if (!copied) {
    throw new DriveOperationError(
      "destination_exists",
      `destination already exists: ${destinationPath}`,
    );
  }
  if (!copied.httpEtag) {
    throw new DriveOperationError(
      "missing_etag",
      `copied destination has no ETag: ${destinationPath}`,
    );
  }
  try {
    await deleteDriveObject(bucket, sourcePath, source.httpEtag);
  } catch (error) {
    if (
      error instanceof DriveOperationError &&
      error.code === "revision_conflict"
    ) {
      // The source is known to remain intact, so roll back only the exact copy.
      // If rollback races, both copies remain and no unrelated revision moves.
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
