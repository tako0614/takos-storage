const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu;

export function workersDevSubdomain(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("Cloudflare workers.dev subdomain is required");
  }
  const subdomain = value.trim().toLowerCase();
  if (!DNS_LABEL.test(subdomain)) {
    throw new Error(
      "Cloudflare workers.dev subdomain must be one valid DNS label",
    );
  }
  return subdomain;
}
