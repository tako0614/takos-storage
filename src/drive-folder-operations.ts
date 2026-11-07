import type { R2Bucket, R2Object } from "./types.ts";
import { isValidDrivePath } from "./drive-path.ts";
import {
  DRIVE_PREFIX,
  DriveOperationError,
  deleteDriveObject,
  exactContentEtag,
  isDriveDeletionTombstone,
  moveDriveObject,
} from "./drive-operations.ts";
import { MAX_STORED_OBJECT_BYTES } from "./http-body.ts";

export const MAX_FOLDER_OBJECTS = 128;
export const MAX_FOLDER_TOTAL_BYTES = 128 * 1024 * 1024;
export const MAX_FOLDER_REQUEST_BYTES = 256 * 1024;

type Entry = { path: string; etag: string };
export type FolderOperation = {
  operation: "rename" | "delete";
  source_path: string;
  destination_path?: string;
  entries: Entry[];
};
export class FolderOperationError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
    this.name = "FolderOperationError";
  }
}
function folderPath(path: unknown): path is string {
  return (
    typeof path === "string" && path.endsWith("/") && isValidDrivePath(path)
  );
}

export function parseFolderOperation(value: unknown): FolderOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FolderOperationError("invalid_folder_operation", 400);
  }
  const input = value as Record<string, unknown>;
  if (
    (input.operation !== "rename" && input.operation !== "delete") ||
    !folderPath(input.source_path) ||
    !Array.isArray(input.entries) ||
    input.entries.length === 0
  ) {
    throw new FolderOperationError("invalid_folder_operation", 400);
  }
  if (input.entries.length > MAX_FOLDER_OBJECTS) {
    throw new FolderOperationError("folder_too_large", 413);
  }
  if (
    input.operation === "rename" &&
    (!folderPath(input.destination_path) ||
      input.source_path.startsWith(input.destination_path) ||
      input.destination_path.startsWith(input.source_path))
  ) {
    throw new FolderOperationError("invalid_folder_destination", 400);
  }
  if (input.operation === "delete" && input.destination_path !== undefined) {
    throw new FolderOperationError("invalid_folder_destination", 400);
  }
  const paths = new Set<string>();
  const entries = input.entries.map((entry: unknown) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new FolderOperationError("invalid_folder_snapshot", 400);
    }
    const { path, etag } = entry as Record<string, unknown>;
    if (
      typeof path !== "string" ||
      !path.startsWith(input.source_path as string) ||
      !isValidDrivePath(path) ||
      !exactContentEtag(etag) ||
      paths.has(path)
    ) {
      throw new FolderOperationError("invalid_folder_snapshot", 400);
    }
    if (input.operation === "rename") {
      const destination = input.destination_path as string;
      if (
        !isValidDrivePath(
          destination + path.slice((input.source_path as string).length),
        )
      ) {
        throw new FolderOperationError("invalid_folder_destination", 400);
      }
    }
    paths.add(path);
    return { path, etag: etag as string };
  });
  return {
    operation: input.operation,
    source_path: input.source_path,
    ...(input.operation === "rename"
      ? { destination_path: input.destination_path as string }
      : {}),
    entries,
  };
}

async function folderMembers(
  bucket: R2Bucket,
  prefix: string,
): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  // Bound calls even when a provider returns empty pages with fresh cursors.
  for (let page = 0; page <= MAX_FOLDER_OBJECTS; page++) {
    const listing = await bucket.list({
      prefix: DRIVE_PREFIX + prefix,
      limit: MAX_FOLDER_OBJECTS + 1,
      include: ["customMetadata"],
      ...(cursor ? { cursor } : {}),
    });
    for (const object of listing.objects) {
      if (!object.key.startsWith(DRIVE_PREFIX + prefix)) {
        throw new FolderOperationError("invalid_folder_listing", 409);
      }
      objects.push(object);
      if (objects.length > MAX_FOLDER_OBJECTS) {
        throw new FolderOperationError("folder_too_large", 413);
      }
    }
    if (!listing.truncated) return objects;
    if (
      !listing.cursor ||
      listing.cursor.length > 4096 ||
      cursors.has(listing.cursor)
    ) {
      throw new FolderOperationError("incomplete_folder_listing", 409);
    }
    cursors.add(listing.cursor);
    cursor = listing.cursor;
  }
  throw new FolderOperationError("incomplete_folder_listing", 409);
}

/**
 * Operate on the caller-reviewed content snapshot, not an unguarded prefix.
 * This is a bounded sequence of per-object CAS operations, not an atomic
 * directory transaction. An incomplete/unknown result requires readback.
 */
export async function performFolderOperation(
  bucket: R2Bucket,
  input: FolderOperation,
) {
  const observed = await folderMembers(bucket, input.source_path);
  const expected = new Map(
    input.entries.map((entry) => [DRIVE_PREFIX + entry.path, entry.etag]),
  );
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const object of observed) {
    if (
      seen.has(object.key) ||
      isDriveDeletionTombstone(object) ||
      !object.httpEtag ||
      expected.get(object.key) !== object.httpEtag
    ) {
      throw new FolderOperationError("folder_snapshot_changed", 412);
    }
    seen.add(object.key);
    totalBytes += object.size;
    if (
      input.operation === "rename" &&
      (!Number.isSafeInteger(object.size) ||
        object.size < 0 ||
        object.size > MAX_STORED_OBJECT_BYTES ||
        totalBytes > MAX_FOLDER_TOTAL_BYTES)
    ) {
      throw new FolderOperationError("folder_too_large", 413);
    }
  }
  if (seen.size !== expected.size) {
    throw new FolderOperationError("folder_snapshot_changed", 412);
  }
  if (input.operation === "rename") {
    const destination = input.destination_path!;
    const listing = await bucket.list({
      prefix: DRIVE_PREFIX + destination,
      limit: 1,
    });
    if (listing.objects.length || listing.truncated) {
      throw new FolderOperationError("folder_destination_exists", 409);
    }
    const file = await bucket.get(DRIVE_PREFIX + destination.slice(0, -1));
    if (file) {
      await file.body.cancel();
      throw new FolderOperationError("folder_destination_exists", 409);
    }
  }

  const ordered = [...input.entries].sort(
    (a, b) =>
      Number(a.path.endsWith("/")) - Number(b.path.endsWith("/")) ||
      b.path.length - a.path.length ||
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  );
  const completed: string[] = [];
  const incomplete = (remaining: string[], failed_path?: string) => ({
    ok: false as const,
    error: "folder_operation_incomplete",
    operation: input.operation,
    source_path: input.source_path,
    ...(input.destination_path
      ? { destination_path: input.destination_path }
      : {}),
    completed,
    remaining,
    ...(failed_path ? { failed_path } : {}),
    reconciliation_required: true,
  });
  for (let index = 0; index < ordered.length; index++) {
    const entry = ordered[index]!;
    try {
      if (input.operation === "delete") {
        await deleteDriveObject(bucket, entry.path, entry.etag);
      } else {
        await moveDriveObject(
          bucket,
          entry.path,
          input.destination_path! + entry.path.slice(input.source_path.length),
          entry.etag,
          MAX_STORED_OBJECT_BYTES,
          undefined,
          { retainCopyOnFailure: true },
        );
      }
      completed.push(entry.path);
    } catch (cause) {
      // The failed path may already have a copied destination or tombstone.
      // Keep every copy: a content ETag cannot establish safe compensation
      // across another writer's same-byte metadata change or ABA.
      return {
        ...incomplete(
          ordered.slice(index).map((item) => item.path),
          entry.path,
        ),
        failure:
          cause instanceof DriveOperationError ? cause.code : "storage_error",
      };
    }
  }
  try {
    const remaining = await folderMembers(bucket, input.source_path);
    if (remaining.length)
      return incomplete(
        remaining.map((object) => object.key.slice(DRIVE_PREFIX.length)),
      );
  } catch {
    return { ...incomplete([]), outcome_uncertain: true };
  }
  return {
    ok: true as const,
    operation: input.operation,
    source_path: input.source_path,
    ...(input.destination_path
      ? { destination_path: input.destination_path }
      : {}),
    completed,
    remaining: [],
  };
}
