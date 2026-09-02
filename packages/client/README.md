# AI Usage Profile

Laptop client. Hosted origin. One snapshot format for every user.

```text
Your machine
  Codex / ChatGPT login  →  fetch account-wide usage
  GitHub device login    →  PUT the same snapshot JSON
                │
                ▼
https://aiusage.teje.sh
  stores the snapshot
  GET /u/{github-login}/card.svg  →  SVG rendered on request
                │
                ▼
GitHub Camo  →  profile README <img>
```

Your GitHub repo layout does not matter. Paste one image URL once. Display
variants are query parameters on that URL, not files in git.

Everyone sends the same payload: the normalized aggregate usage snapshot
(`schemaVersion`, `collectedAt`, and the stats history). Nobody uploads an SVG.
The origin renders the card when GitHub (or a browser) fetches it.

## Install

Requirements: Node.js 22.12+, Codex signed in on this computer, and a GitHub
OAuth App client ID.

```bash
export AI_USAGE_GITHUB_CLIENT_ID=your-oauth-app-client-id
npx ai-usage-profile setup
```

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

Paste the printed snippet into `username/username`. Camo revalidates with
`ETag` / `Cache-Control: no-cache`.

```html
<picture>
  <source media="(prefers-color-scheme: dark)"
          srcset="https://aiusage.teje.sh/u/your-login/card.svg?theme=dark">
  <source media="(prefers-color-scheme: light)"
          srcset="https://aiusage.teje.sh/u/your-login/card.svg?theme=light">
  <img width="100%"
       src="https://aiusage.teje.sh/u/your-login/card.svg?theme=dark"
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
| `profile` | Optional identity, statistics, and graph |
| `full` | Profile layout plus provider provenance |

Available statistics: `lifetime`, `peak`, `longest-chat`, `current-streak`,
`longest-streak`, `active-days`, `reported-days`. Missing metrics render as an
em dash.

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

## Development

```bash
pnpm install --frozen-lockfile
pnpm check
```

The public CLI is `setup` and `publish`. Origin, docker, and admin provisioning
live in this repo for the hosted service; they are not a supported user product.

MIT licensed.
