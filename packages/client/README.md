# AI Usage Profile

Laptop client. Hosted origin. One snapshot format for every user.

```text
Your machine
  Codex / ChatGPT login  →  fetch account-wide usage
  GitHub device login    →  PUT snapshot JSON + Bearer token
                │
                ▼
https://aiusage.teje.sh
  validates token with GitHub, stores snapshot (PostgreSQL)
  pre-renders dark/light SVGs to object storage on publish
                │
                ▼
GET /u/{github-login}/card.svg  →  CDN / edge serves cached SVG
                │
                ▼
GitHub Camo  →  profile README <img>
```

Your GitHub repo layout does not matter. Paste one image URL once. Display
variants are query parameters on that URL, not files in git.

Everyone sends the same payload: the normalized aggregate usage snapshot
(`schemaVersion`, `collectedAt`, and the stats history). Nobody uploads an SVG.
The origin renders cards on publish; `theme=dark` and `theme=light` are served
from object storage. Custom `layout` / `stats` query params are rendered by the
API on demand.

## Install

Requirements: Node.js 22.13+, Codex signed in on this computer.

```bash
npx ai-usage-profile setup
```

Device login uses a built-in public OAuth client id. Set `AI_USAGE_GITHUB_CLIENT_ID` to override.

From a git clone, run `node packages/client/bin/ai-usage-profile.js setup` after `pnpm install`.

That command:

1. Confirms Codex is signed in (`codex login` if needed).
2. Completes GitHub OAuth device flow with empty scopes, or reuses
   `AI_USAGE_GITHUB_TOKEN` / `GITHUB_TOKEN`.
3. Stores the GitHub token in `~/.ai-usage/credentials.json` (`0600`).
4. Fetches usage locally and `PUT`s the snapshot to the origin as
   `Authorization: Bearer <github_token>`.
5. Installs a user-level schedule (LaunchAgent, systemd / crontab, or Task
   Scheduler) that re-publishes every two hours while the computer is awake.

The origin calls `GET https://api.github.com/user` and binds the card to that
login. It does not store the GitHub token.

```bash
npx ai-usage-profile setup --remove
```

## Embed

`setup` prints a GitHub-safe snippet (encoded `&amp;` and `%2C`). Paste that into `username/username`. Camo revalidates with `ETag` / `Cache-Control: no-cache`.

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="https://aiusage.teje.sh/u/your-login/card.svg?theme=dark&amp;layout=profile&amp;identity=show&amp;stats=lifetime%2Cpeak%2Clongest-chat%2Ccurrent-streak%2Clongest-streak%2Cactive-days">
  <source media="(prefers-color-scheme: light)"
          srcset="https://aiusage.teje.sh/u/your-login/card.svg?theme=light&amp;layout=profile&amp;identity=show&amp;stats=lifetime%2Cpeak%2Clongest-chat%2Ccurrent-streak%2Clongest-streak%2Cactive-days">
  <img width="100%"
       src="https://aiusage.teje.sh/u/your-login/card.svg?theme=dark&amp;layout=profile&amp;identity=show&amp;stats=lifetime%2Cpeak%2Clongest-chat%2Ccurrent-streak%2Clongest-streak%2Cactive-days"
       alt="Account-wide AI usage">
</picture>
```

Display-only query parameters:

```text
?theme=dark&layout=stats&stats=lifetime,peak,current-streak&identity=hide
```

| Layout | Includes |
| --- | --- |
| `graph` | Contribution-style daily token grid |
| `stats` | One to six selected statistics |
| `profile` | Identity, statistics, and activity graph (default from `setup`) |

Available statistics: `lifetime`, `peak`, `longest-chat`, `current-streak`,
`longest-streak`, `active-days`, `reported-days`. Missing metrics render as an
em dash. Use `&amp;` and `%2C` in README HTML so GitHub does not truncate query params.

## Refresh

`setup` already schedules `publish`. To push immediately:

```bash
npx ai-usage-profile publish
```

`publish` reads `~/.ai-usage/credentials.json` (or `AI_USAGE_GITHUB_TOKEN`) and
sends the same snapshot body every time. Transient `408` / `429` / `5xx`
failures retry; auth and validation errors fail immediately.

## Providers

| Provider | Status | Account-wide source |
| --- | --- | --- |
| Codex | Available | Official OpenAI Codex App Server `account/usage/read` |
| Claude Code | Planned | Adapter pending a validated account-wide source |

Codex collection uses ChatGPT-backed App Server login, not an OpenAI API key.

## GitHub auth

`setup` needs a GitHub OAuth App **Client ID** (public) for device login, or an
existing `GITHUB_TOKEN` / `AI_USAGE_GITHUB_TOKEN`. Register an OAuth App with
callback URL `https://github.com/login/oauth/callback`, **device flow enabled**,
empty scopes, and **expiring tokens disabled**.

On each `publish`, your laptop sends `Authorization: Bearer <github_token>`.
The origin calls `GET https://api.github.com/user` to verify identity and bind
the card to that login. It does **not** store the token.

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
```

The public CLI is `setup` and `publish`.

MIT licensed.
