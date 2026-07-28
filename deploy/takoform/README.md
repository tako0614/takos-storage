# Takos Storage Takoform Capsule

This is the canonical managed resource definition for Takos Storage. The
repository root remains the direct Cloudflare path.

The Capsule declares one `ObjectBucket`, one `EdgeWorker`, and the `BUCKET`
connection with explicit read/write/list/delete intent. The Worker tag, URL,
and SHA-256 are pinned together.

Takosumi owns runtime secrets, Accounts/Interface context, public URL
allocation, OIDC, and Interface publication. Object export/purge before destroy
remains a reviewed service-side lifecycle action; a host must not delete a
non-empty bucket silently.
