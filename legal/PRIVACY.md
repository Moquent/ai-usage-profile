# Privacy Policy

**Last updated:** September 3, 2026  
**Operator:** Moquent ([GitHub](https://github.com/Moquent))  
**Service:** AI Usage Profile hosted origin (e.g. `aiusage.teje.sh`) and related open-source software

## Summary

We host **public usage statistics** you choose to publish. We do **not** want your prompts, code, or GitHub passwords.

## What we collect

When you use the hosted origin:

- **Usage snapshots** you publish: aggregate metrics (token totals, streaks, daily buckets) and optional plan label from Codex.
- **Profile binding:** GitHub username/slug linked to your published card.
- **Operational logs:** IP address, request metadata, errors, and rate-limit counters (typical web server logs).

## What we do not store

- GitHub access tokens (used only to verify your identity during publish; not retained).
- OpenAI / Codex prompts, conversations, or source code.
- Payment information (the hosted service is free).

## How we use data

- Render and serve your public profile card (SVG).
- Operate, secure, and debug the service.
- Enforce rate limits and prevent abuse.

We do **not** sell your data.

## Public information

Cards at `/u/{login}/card.svg` are **public** by design (e.g. embedded in your GitHub profile). Anyone with the URL can view them.

## Retention

Snapshots are kept while your profile exists. You may stop publishing; contact us to request deletion of hosted profile data.

## Third parties

- **GitHub** — identity verification during publish ([GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)).
- **OpenAI / Codex** — usage is read on **your device** via the Codex app server; we never receive your OpenAI login.
- **Infrastructure providers** (e.g. hosting, DNS, CDN) process traffic as part of operating the service.

## Security

We use industry-standard practices (TLS, access controls, hashed publish tokens). No system is perfectly secure.

## Children

The service is not directed at children under 13. We do not knowingly collect their data.

## Self-hosted

If you run your own origin, you are responsible for privacy practices on that instance.

## Changes

We may update this policy. Continued use after changes means you accept the updated policy.

## Contact

Open an issue at [github.com/Moquent/ai-usage-profile](https://github.com/Moquent/ai-usage-profile/issues) or contact the repository owner.
