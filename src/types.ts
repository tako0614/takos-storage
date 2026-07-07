/**
 * Minimal Cloudflare R2 + Worker environment types.
 *
 * Declared locally so the service typechecks and tests without pulling in
 * `@cloudflare/workers-types`. Only the surface this Worker uses is modeled.
 */

export interface R2HttpMetadata {
  contentType?: string;
}

export interface R2Object {
  key: string;
  size: number;
  uploaded: Date;
  httpEtag?: string;
  httpMetadata?: R2HttpMetadata;
  body: ReadableStream;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Objects {
  objects: R2Object[];
  truncated: boolean;
}

export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
}

export interface R2ListOptions {
  prefix?: string;
  limit?: number;
}

export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object>;
  delete(key: string): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface Env {
  /** R2 bucket backing this workspace object store. */
  BUCKET: R2Bucket;
  /** Shared HMAC signing key; Takosumi mints tokens with the same value. */
  STORAGE_TOKEN_SIGNING_KEY: string;
  /** Public URL of this service, when known. */
  APP_URL?: string;
}
