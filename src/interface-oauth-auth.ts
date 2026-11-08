const MAX_USERINFO_BYTES = 64 * 1024;
const MAX_INTERFACE_BEARER_LENGTH = 8_192;
const MAX_EVIDENCE_ID_LENGTH = 512;
const INTERFACE_TOKEN_PREFIX = "taksrv_";
const INTERFACE_PERMISSION_PATTERN = /^[\x21\x23-\x5b\x5d-\x7e]{1,256}$/u;

export interface InterfaceOAuthOptions {
  issuerUrl?: string;
  expectedAudience: string;
  expectedWorkspaceId?: string;
  expectedCapsuleId?: string;
  /** Only the object HTTP surface opts into the separate app-data purpose. */
  allowAppShared?: boolean;
  fetchImpl?: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response>;
}

export interface InterfaceOAuthAuthorization {
  readonly subject: string;
  readonly workspaceId?: string;
  readonly capsuleId: string;
  readonly interfaceId: string;
  readonly interfaceBindingId: string;
  readonly interfaceResolvedRevision: number;
  readonly audience: string;
  readonly permission: string;
  readonly appSharedNamespace?: string;
}

function appSharedNamespace(
  evidence: Record<string, unknown>,
  expectedCapsuleId: string | undefined,
): string | null {
  const authority = evidence.app_data;
  if (!boundedId(expectedCapsuleId) || !isRecord(authority)) return null;
  const keys = [
    "contract",
    "namespace_id",
    "consumer_capsule_id",
    "provider_capsule_id",
    "ownership_epoch",
    "provider_ownership_epoch",
    "app_role",
    "interface_link_id",
    "interface_link_generation",
    "interface_binding_generation",
    "interface_generation",
  ];
  if (
    Object.keys(authority).length !== keys.length ||
    Object.keys(authority).some((key) => !keys.includes(key)) ||
    authority.contract !== "takosumi.interface-app-data/v1" ||
    typeof authority.namespace_id !== "string" ||
    !/^appd_[0-9a-f]{64}$/u.test(authority.namespace_id) ||
    !boundedId(authority.consumer_capsule_id) ||
    authority.provider_capsule_id !== expectedCapsuleId ||
    !boundedId(authority.interface_link_id) ||
    (authority.app_role !== "owner" && authority.app_role !== "member") ||
    [authority.ownership_epoch, authority.provider_ownership_epoch].some(
      (epoch) => !Number.isSafeInteger(epoch) || (epoch as number) < 0,
    ) ||
    [
      authority.interface_link_generation,
      authority.interface_binding_generation,
      authority.interface_generation,
    ].some(
      (generation) =>
        !Number.isSafeInteger(generation) || (generation as number) <= 0,
    )
  ) {
    return null;
  }
  return authority.namespace_id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_EVIDENCE_ID_LENGTH &&
    value === value.trim() &&
    !/\s/u.test(value)
  );
}

function validPermission(value: unknown): value is string {
  return typeof value === "string" && INTERFACE_PERMISSION_PATTERN.test(value);
}

function userInfoEndpoint(issuerUrl?: string): URL | null {
  if (!issuerUrl?.trim()) return null;
  try {
    const issuer = new URL(issuerUrl);
    if (
      issuer.protocol !== "https:" ||
      issuer.username !== "" ||
      issuer.password !== "" ||
      issuer.search !== "" ||
      issuer.hash !== ""
    ) {
      return null;
    }
    return new URL("/oauth/userinfo", issuer.origin);
  } catch {
    return null;
  }
}

function canonicalResourceUri(value: string): string | null {
  try {
    const resource = new URL(value);
    if (
      resource.protocol !== "https:" ||
      resource.username !== "" ||
      resource.password !== "" ||
      resource.search !== "" ||
      resource.hash !== ""
    ) {
      return null;
    }
    return resource.href;
  } catch {
    return null;
  }
}

function requestTargetsResource(
  request: Request,
  resourceUri: string,
): boolean {
  try {
    const requestUrl = new URL(request.url);
    const resourceUrl = new URL(resourceUri);
    const resourcePath = resourceUrl.pathname.replace(/\/$/u, "");
    return (
      requestUrl.origin === resourceUrl.origin &&
      (requestUrl.pathname === resourcePath ||
        requestUrl.pathname.startsWith(`${resourcePath}/`))
    );
  } catch {
    return false;
  }
}

export function hasValidInterfaceOAuthConfiguration(input: {
  issuerUrl?: string;
  audience?: string;
  workspaceId?: string;
  capsuleId?: string;
}): boolean {
  return (
    userInfoEndpoint(input.issuerUrl) !== null &&
    canonicalResourceUri(input.audience ?? "") !== null &&
    (input.workspaceId === undefined || boundedId(input.workspaceId)) &&
    (input.capsuleId === undefined
      ? boundedId(input.workspaceId)
      : boundedId(input.capsuleId))
  );
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_USERINFO_BYTES) return null;

  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_USERINFO_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  }
}

export async function authorizeInterfaceOAuthBearer(
  request: Request,
  token: string,
  expectedPermission: string,
  options: InterfaceOAuthOptions,
): Promise<InterfaceOAuthAuthorization | null> {
  const endpoint = userInfoEndpoint(options.issuerUrl);
  const expectedAudience = canonicalResourceUri(options.expectedAudience);
  const expectedWorkspaceId = options.expectedWorkspaceId?.trim();
  const expectedCapsuleId = options.expectedCapsuleId?.trim();
  if (
    !endpoint ||
    !expectedAudience ||
    (options.expectedWorkspaceId !== undefined &&
      !boundedId(expectedWorkspaceId)) ||
    (options.expectedCapsuleId === undefined
      ? !boundedId(expectedWorkspaceId)
      : !boundedId(expectedCapsuleId)) ||
    !validPermission(expectedPermission) ||
    !requestTargetsResource(request, expectedAudience) ||
    !token.startsWith(INTERFACE_TOKEN_PREFIX) ||
    token.length <= INTERFACE_TOKEN_PREFIX.length ||
    token.length > MAX_INTERFACE_BEARER_LENGTH ||
    token !== token.trim() ||
    /\s/u.test(token)
  ) {
    return null;
  }

  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
      },
      redirect: "manual",
    });
    if (response.status !== 200) return null;

    const claims = await readBoundedJson(response);
    if (!isRecord(claims) || !isRecord(claims.takosumi)) return null;
    const evidence = claims.takosumi;
    const namespace =
      claims.token_use === "interface_app_data" && options.allowAppShared
        ? appSharedNamespace(evidence, expectedCapsuleId)
        : null;
    if (
      (claims.token_use !== "interface_oauth" && namespace === null) ||
      (claims.token_use === "interface_oauth" &&
        evidence.app_data !== undefined) ||
      !boundedId(claims.sub) ||
      claims.aud !== expectedAudience ||
      claims.scope !== expectedPermission ||
      (evidence.workspace_id !== undefined &&
        !boundedId(evidence.workspace_id)) ||
      !boundedId(evidence.capsule_id) ||
      (expectedWorkspaceId !== undefined &&
        evidence.workspace_id !== undefined &&
        evidence.workspace_id !== expectedWorkspaceId) ||
      (expectedCapsuleId !== undefined
        ? evidence.capsule_id !== expectedCapsuleId
        : evidence.workspace_id !== expectedWorkspaceId) ||
      !boundedId(evidence.interface_id) ||
      !boundedId(evidence.interface_binding_id) ||
      !Number.isSafeInteger(evidence.interface_resolved_revision) ||
      (evidence.interface_resolved_revision as number) <= 0
    ) {
      return null;
    }

    return {
      subject: claims.sub,
      ...(boundedId(evidence.workspace_id)
        ? { workspaceId: evidence.workspace_id }
        : {}),
      capsuleId: evidence.capsule_id,
      interfaceId: evidence.interface_id,
      interfaceBindingId: evidence.interface_binding_id,
      interfaceResolvedRevision: evidence.interface_resolved_revision as number,
      audience: expectedAudience,
      permission: expectedPermission,
      ...(namespace === null ? {} : { appSharedNamespace: namespace }),
    };
  } catch {
    return null;
  }
}

export async function verifyInterfaceOAuthBearer(
  request: Request,
  token: string,
  expectedPermission: string,
  options: InterfaceOAuthOptions,
): Promise<boolean> {
  return (
    (await authorizeInterfaceOAuthBearer(
      request,
      token,
      expectedPermission,
      options,
    )) !== null
  );
}
