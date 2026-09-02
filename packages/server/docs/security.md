# Security model

## Assets and trust boundaries

| Asset | Location | Sent to hosted service? |
| --- | --- | --- |
| ChatGPT/Codex login | User laptop or dedicated runner | No |
| Conversation content | Provider systems | No |
| Normalized aggregate snapshot | Publisher and hosted database | Yes |
| GitHub user access token | Laptop `~/.ai-usage/credentials.json`; bearer header only | Validated against `api.github.com/user`, not stored |
| Publishing token | Runner secret store; hash in database | Bearer credential only (legacy admin profiles) |
| Admin key | Service operator secret store | Bearer credential only |
| SVG | Public endpoint and GitHub Camo | Yes |

GitHub device-flow tokens use an OAuth App with no extra scopes. The origin
trusts GitHub's `/user` response for the login and numeric user id. Card URLs
are `/u/{login}/card.svg`; a caller cannot publish as another username.

Legacy one-purpose publishing tokens contain 256 bits of randomness, are scoped
to one profile, and are stored only as SHA-256 digests. Comparisons are
constant-time. Rotation immediately revokes the previous token.

## Ingestion controls

- Zod validates and bounds every field and limits daily buckets to 400.
- Fastify limits request bodies to 256 KiB.
- The profile's configured provider must match the publisher payload.
- Provider name and source are replaced with the server's trusted catalog.
- Older `collectedAt` values cannot overwrite newer snapshots.
- Identical data is idempotent and refreshes freshness without incrementing the
  content revision.
- Transient retries are bounded; authentication failures are never retried.

## Delivery controls

- Rendering is pure SVG without scripts, `foreignObject`, or data URLs.
- All displayed strings are XML-escaped.
- Helmet security headers and MIME sniffing protection are enabled.
- ETags allow GitHub Camo to revalidate unchanged cards.
- Health endpoints expose no metrics, account plan, or credentials.
- Application errors return request IDs and do not expose internal exceptions.
- Protected administration and publishing routes have per-IP rate limits; public
  SVG delivery remains CDN-friendly.

## Operator checklist

- Keep the admin API behind an operator network or identity-aware proxy.
- Use a random admin key with at least 32 characters and rotate it operationally.
- Terminate TLS and enable `AI_USAGE_TRUST_PROXY` only behind a trusted proxy.
- Back up and encrypt the data volume.
- Monitor `401`, `409`, `429`, and `5xx` rates plus stale-card headers.
- Keep the private publisher repository and runner patched.
- Never place ChatGPT session files in Actions secrets, images, caches, or the
  hosted service.
