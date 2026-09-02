# AI Usage Profile Monorepo

pnpm workspace with three packages:

- `packages/shared` (`@ai-usage/shared`) — schemas, catalogs, HTTP helpers
- `packages/client` (`ai-usage-profile`) — laptop CLI (`setup`, `publish`)
- `packages/server` (`@ai-usage/server`) — hosted origin API

```bash
corepack pnpm install
pnpm check
```

See `packages/client/README.md` for end-user setup instructions.
