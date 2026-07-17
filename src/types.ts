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
  /** Opaque continuation cursor returned when `truncated` is true. */
  cursor?: string;
}

export interface R2PutOptions {
  httpMetadata?: R2HttpMetadata;
  onlyIf?:
    | {
        etagMatches?: string;
        etagDoesNotMatch?: string;
      }
    | Headers;
}

export interface R2ListOptions {
  prefix?: string;
  limit?: number;
  cursor?: string;
}

export interface R2Bucket {
  get(key: string): Promise<R2Object | null>;
  put(
    key: string,
    value: ArrayBuffer | ReadableStream | string,
    options?: R2PutOptions,
  ): Promise<R2Object | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}

export interface Env {
  /** R2 bucket backing this workspace object store. */
  BUCKET: R2Bucket;
  /** Optional direct/self-host bearer for the published MCP server. */
  PUBLISHED_MCP_AUTH_TOKEN?: string;
  /** Public URL of this service, when known. */
  APP_URL?: string;

  // ---- Workspace drive (user-facing) auth ----
  /** "1"/"true" gates the drive UI + /api/drive behind an OIDC session. */
  APP_AUTH_REQUIRED?: string;
  /** Takosumi Accounts OIDC issuer, e.g. https://accounts.example. */
  OIDC_ISSUER_URL?: string;
  /** OIDC client id (public client; PKCE). */
  OIDC_CLIENT_ID?: string;
  /** Optional OIDC client secret for confidential clients. */
  OIDC_CLIENT_SECRET?: string;
  /** HMAC secret sealing the session + OAuth state cookies. */
  APP_SESSION_SECRET?: string;
  /** Owning Workspace id for user membership and Interface OAuth evidence. */
  APP_WORKSPACE_ID?: string;
  /** Owning Capsule id required for Interface OAuth evidence. */
  APP_CAPSULE_ID?: string;
  /** Exact object Interface id and current resolved revision. */
  APP_OBJECT_INTERFACE_ID?: string;
  APP_OBJECT_INTERFACE_RESOLVED_REVISION?: string;
  /** Exact MCP Interface id and current resolved revision. */
  APP_MCP_INTERFACE_ID?: string;
  APP_MCP_INTERFACE_RESOLVED_REVISION?: string;
}
