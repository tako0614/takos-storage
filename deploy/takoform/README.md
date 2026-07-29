# Takos Storage Takoform Capsule

This is the canonical managed resource definition for Takos Storage. The
repository root remains the direct Cloudflare path.

The Capsule declares one `ObjectBucket`, one JavaScript `HttpService`, and the `BUCKET`
connection with explicit read/write/list/delete intent. The Worker tag, URL,
and SHA-256 are pinned together.

The graph owns the complete opaque launcher, object API, and MCP Interface
documents through generic `takoform_interface` resources. Takoform does not
interpret those protocol shapes. The host resolves the public service origin,
and consumers discover and call the resulting application endpoint directly.

Takosumi owns runtime secrets, Accounts/Interface context, public URL
allocation, OIDC, binding credentials, and authorization. Object export/purge
before destroy remains a reviewed service-side lifecycle action; a host must
not delete a non-empty bucket silently.
