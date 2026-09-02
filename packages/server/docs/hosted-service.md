# Hosted service

Operator notes for the origin. This is not a user setup guide. The public product
is the laptop client (`setup` / `publish`) against `https://aiusage.teje.sh`.

The hosted service stores normalized aggregate snapshots and renders public SVG
cards. It never runs a provider adapter and never needs ChatGPT credentials.

## Configuration

| Environment variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `AI_USAGE_ADMIN_KEY` | Yes | — | Profile provisioning and token rotation; minimum 32 characters |
| `AI_USAGE_PUBLIC_BASE_URL` | Production | Request origin | Canonical HTTPS origin in API responses |
| `AI_USAGE_DATABASE_PATH` | No | `data/ai-usage-profile.sqlite` | Persistent SQLite file |
| `AI_USAGE_HOST` | No | `127.0.0.1` | Listen address |
| `PORT` | No | `3000` | Listen port |
| `AI_USAGE_TRUST_PROXY` | No | `false` | Trust reverse-proxy forwarding headers |
| `AI_USAGE_STALE_HOURS` | No | `24` | Age after which a card is marked stale |
| `AI_USAGE_LOG_LEVEL` | No | `info` | Structured Fastify/Pino log level |

Run with `pnpm service` or the included container.

## Persistence

The migration runner is idempotent and executes before the server accepts
traffic. SQLite is configured with:

- WAL journaling for concurrent reads during a publish
- foreign keys and cascading snapshot deletion
- a five-second busy timeout
- transactional snapshot revisions and token updates

Mount `/data` on durable storage. Take filesystem or volume snapshots and test
restores. Run exactly one writer replica; SQLite is not a multi-writer network
database. The repository is injected into the application boundary so a future
PostgreSQL implementation does not change routes or business logic.

## Reverse proxy

Terminate TLS before the service and expose:

- `/u/*/card.svg` publicly
- `/healthz` and `/readyz` to infrastructure monitoring
- `/v1/me/snapshot` to GitHub-authenticated publishers
- `/v1/profiles/*/snapshot` to legacy one-purpose publishers
- admin endpoints only to an operator-controlled network when possible

Set a request-body limit at or below 256 KiB and preserve `ETag`,
`Last-Modified`, `Cache-Control`, and `X-AI-Usage-Snapshot` response headers.
The application already enforces that body limit and global/per-route rate
limits.

## GitHub identity

Laptop publishers send `Authorization: Bearer <github_token>`. The service
calls `GET https://api.github.com/user` with that token and binds the card to
the returned login. Username is GitHub's, not a claimed slug.

```http
PUT /v1/me/snapshot
Authorization: Bearer gho_...
Content-Type: application/json
```

`GET /v1/me/status` uses the same header. Invalid or expired tokens return 401.
The service does not store GitHub tokens; it only caches successful `/user`
lookups briefly.

The public card URL is `/u/{lowercase-login}/card.svg`. GitHub OAuth App device
flow on the CLI uses empty scopes so the token can read public profile identity
and nothing else.

## Provisioning

`ai-usage-profile profile create` authenticates with the service-wide admin key
and returns a one-purpose publishing token. Rotate a compromised token with:

```bash
ai-usage-profile profile rotate-token --id PROFILE_UUID
```

Rotation revokes the old token immediately. Only SHA-256 digests of high-entropy
publishing tokens are stored.
