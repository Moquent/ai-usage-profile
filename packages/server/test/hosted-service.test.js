import { createHostedService, loadServiceConfig } from "../src/service/hosted-service.js";
import { ADMIN_KEY, BASE_URL, loadUsageSnapshot } from "../../test-support/helpers.js";

async function createProfile(app, overrides = {}) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/profiles",
    headers: { authorization: `Bearer ${ADMIN_KEY}` },
    payload: {
      slug: "moquent",
      providerId: "codex",
      card: {
        username: "Moquent",
        layout: "graph",
        stats: ["lifetime", "peak", "current-streak"],
        identity: false,
      },
      ...overrides,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json();
}

describe("hosted service", () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await loadUsageSnapshot();
  });

  it("provisions, authenticates, publishes, and revalidates a card", async () => {
    let current = new Date("2026-08-30T12:00:00.000Z");
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      publicBaseUrl: BASE_URL,
      logger: false,
      now: () => current,
    });
    try {
      const unauthorized = await app.inject({ method: "POST", url: "/v1/profiles", payload: {} });
      expect(unauthorized.statusCode).toBe(401);

      const profile = await createProfile(app);
      expect(profile.publishToken).toMatch(/^aup_v1_/);
      expect(profile.cardUrl).toBe(`${BASE_URL}/u/moquent/card.svg`);

      const unpublished = await app.inject({ method: "GET", url: "/u/moquent/card.svg" });
      expect(unpublished.statusCode).toBe(503);

      const spoofedSnapshot = {
        ...snapshot,
        provider: { id: "codex", name: "Spoofed", source: "Untrusted" },
      };
      const published = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: {
          schemaVersion: 1,
          collectedAt: "2026-08-30T11:59:00.000Z",
          snapshot: spoofedSnapshot,
        },
      });
      expect(published.statusCode).toBe(200);
      expect(published.json()).toMatchObject({ status: "updated", revision: 1 });

      const card = await app.inject({
        method: "GET",
        url: "/u/moquent/card.svg?theme=dark&layout=profile",
      });
      expect(card.statusCode).toBe(200);
      expect(card.headers["content-type"]).toMatch(/^image\/svg\+xml/);
      expect(card.headers["x-ai-usage-snapshot"]).toBe("fresh");
      expect(card.body).toMatch(/Lifetime tokens|Codex activity/);
      expect(card.body).not.toMatch(/Spoofed|Untrusted|OpenAI Codex App Server/);
      const etag = card.headers.etag;

      const cached = await app.inject({
        method: "GET",
        url: "/u/moquent/card.svg?theme=dark&layout=profile",
        headers: { "if-none-match": etag },
      });
      expect(cached.statusCode).toBe(304);

      current = new Date("2026-08-31T13:00:00.000Z");
      const stale = await app.inject({ method: "GET", url: "/u/moquent/card.svg" });
      expect(stale.headers["x-ai-usage-snapshot"]).toBe("stale");

      const status = await app.inject({
        method: "GET",
        url: `/v1/profiles/${profile.id}/status`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
      });
      expect(status.json()).toMatchObject({ revision: 1, published: true });
    } finally {
      await app.close();
    }
  });

  it("rejects replay, duplicate slugs, invalid tokens, and oversized data", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, publicBaseUrl: BASE_URL, logger: false });
    try {
      const profile = await createProfile(app);
      const duplicate = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { slug: "moquent" },
      });
      expect(duplicate.statusCode).toBe(409);

      const unsupportedProvider = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { slug: "unsupported", providerId: "unknown-provider" },
      });
      expect(unsupportedProvider.statusCode).toBe(400);

      const invalidToken = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: "Bearer incorrect-token-that-is-long-enough" },
        payload: { schemaVersion: 1, collectedAt: new Date().toISOString(), snapshot },
      });
      expect(invalidToken.statusCode).toBe(401);

      const publish = (collectedAt) => app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: { schemaVersion: 1, collectedAt, snapshot },
      });
      expect((await publish("2026-08-30T12:00:00.000Z")).statusCode).toBe(200);
      const replay = await publish("2026-08-30T11:59:00.000Z");
      expect(replay.statusCode).toBe(409);
      expect(replay.json().error).toBe("out_of_order_snapshot");

      const invalidQuery = await app.inject({
        method: "GET",
        url: "/u/moquent/card.svg?theme=neon",
      });
      expect(invalidQuery.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("rotates a publishing token immediately revoking the previous token", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, publicBaseUrl: BASE_URL, logger: false });
    try {
      const profile = await createProfile(app);
      const rotated = await app.inject({
        method: "POST",
        url: `/v1/profiles/${profile.id}/token`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(rotated.statusCode).toBe(200);
      const newToken = rotated.json().publishToken;
      expect(newToken).not.toBe(profile.publishToken);

      const oldStatus = await app.inject({
        method: "GET",
        url: `/v1/profiles/${profile.id}/status`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
      });
      expect(oldStatus.statusCode).toBe(401);
      const newStatus = await app.inject({
        method: "GET",
        url: `/v1/profiles/${profile.id}/status`,
        headers: { authorization: `Bearer ${newToken}` },
      });
      expect(newStatus.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("exposes health and readiness endpoints", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, logger: false });
    try {
      const health = await app.inject({ method: "GET", url: "/healthz" });
      expect(health.json()).toEqual({ status: "ok" });
      const ready = await app.inject({ method: "GET", url: "/readyz" });
      expect(ready.statusCode).toBe(200);
      expect(ready.json().status).toBe("ready");
    } finally {
      await app.close();
    }
  });

  it("supports admin profile lifecycle operations", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, publicBaseUrl: BASE_URL, logger: false });
    try {
      const profile = await createProfile(app);
      const fetched = await app.inject({
        method: "GET",
        url: `/v1/profiles/${profile.id}`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(fetched.json().slug).toBe("moquent");

      const patched = await app.inject({
        method: "PATCH",
        url: `/v1/profiles/${profile.id}`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { card: { layout: "stats", stats: ["lifetime"] } },
      });
      expect(patched.json().card.layout).toBe("stats");

      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/profiles/${profile.id}`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(deleted.statusCode).toBe(204);
      const missing = await app.inject({
        method: "GET",
        url: `/v1/profiles/${profile.id}`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("returns 404 for unknown profile slugs and cards", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, logger: false });
    try {
      const missingProfile = await app.inject({ method: "GET", url: "/u/unknown/card.svg" });
      expect(missingProfile.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("serves legal pages", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, logger: false });
    try {
      const home = await app.inject({ method: "GET", url: "/" });
      const privacy = await app.inject({ method: "GET", url: "/privacy" });
      const terms = await app.inject({ method: "GET", url: "/terms" });
      expect(home.statusCode).toBe(200);
      expect(home.headers["content-type"]).toMatch(/text\/html/);
      expect(home.body).toMatch(/AI Usage Profile|npx ai-usage-profile setup/);
      expect(privacy.statusCode).toBe(200);
      expect(privacy.headers["content-type"]).toMatch(/text\/html/);
      expect(privacy.body).toMatch(/Privacy Policy|do not store/i);
      expect(terms.statusCode).toBe(200);
      expect(terms.body).toMatch(/Terms of Service|Limitation of liability/i);
    } finally {
      await app.close();
    }
  });

  it("returns 503 when GitHub validation is unavailable", async () => {
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      logger: false,
      lookupGitHubUser: async () => {
        throw new Error("github down");
      },
    });
    try {
      const response = await app.inject({
        method: "PUT",
        url: "/v1/me/snapshot",
        headers: { authorization: "Bearer gho_token" },
        payload: { schemaVersion: 1, collectedAt: "2026-08-30T12:00:00.000Z", snapshot },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json().error).toBe("github_unavailable");
    } finally {
      await app.close();
    }
  });

  it("rejects missing GitHub bearer tokens and unpublished me-status lookups", async () => {
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      logger: false,
      lookupGitHubUser: async () => ({ id: 99, login: "FreshUser", slug: "freshuser" }),
    });
    try {
      const missingToken = await app.inject({ method: "PUT", url: "/v1/me/snapshot", payload: {} });
      expect(missingToken.statusCode).toBe(401);

      const status = await app.inject({
        method: "GET",
        url: "/v1/me/status",
        headers: { authorization: "Bearer gho_fresh_user" },
      });
      expect(status.json()).toMatchObject({
        username: "FreshUser",
        published: false,
        cardUrl: expect.stringContaining("/u/freshuser/card.svg"),
      });
    } finally {
      await app.close();
    }
  });

  it("rejects future timestamps and unchanged duplicate snapshots", async () => {
    let current = new Date("2026-08-30T12:00:00.000Z");
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      publicBaseUrl: BASE_URL,
      logger: false,
      now: () => current,
    });
    try {
      const profile = await createProfile(app);
      const future = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: {
          schemaVersion: 1,
          collectedAt: "2035-01-01T00:00:00.000Z",
          snapshot,
        },
      });
      expect(future.statusCode).toBe(409);
      expect(future.json().error).toBe("invalid_timestamp");

      const first = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: { schemaVersion: 1, collectedAt: "2026-08-30T12:00:00.000Z", snapshot },
      });
      const second = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: { schemaVersion: 1, collectedAt: "2026-08-30T12:05:00.000Z", snapshot },
      });
      expect(first.json().status).toBe("updated");
      expect(second.json().status).toBe("unchanged");
    } finally {
      await app.close();
    }
  });

  it("returns validation errors and admin not-found responses", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, logger: false });
    try {
      const invalidBody = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: { slug: "bad slug with spaces" },
      });
      expect(invalidBody.statusCode).toBe(400);

      const missingProfile = await app.inject({
        method: "GET",
        url: "/v1/profiles/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(missingProfile.statusCode).toBe(404);

      const missingRotate = await app.inject({
        method: "POST",
        url: "/v1/profiles/00000000-0000-0000-0000-000000000000/token",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(missingRotate.statusCode).toBe(404);

      const missingDelete = await app.inject({
        method: "DELETE",
        url: "/v1/profiles/00000000-0000-0000-0000-000000000000",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(missingDelete.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it("requires a valid admin key at startup", async () => {
    await expect(createHostedService({ adminKey: "short" })).rejects.toThrow(/admin key/);
  });
});

describe("service configuration", () => {
  it("loads environment defaults and coerces boolean proxy settings", () => {
    const config = loadServiceConfig({
      AI_USAGE_ADMIN_KEY: ADMIN_KEY,
      AI_USAGE_DATABASE_PATH: "data/test.sqlite",
      AI_USAGE_PUBLIC_BASE_URL: "https://usage.example.com",
      AI_USAGE_HOST: "0.0.0.0",
      PORT: "4000",
      AI_USAGE_LOG_LEVEL: "warn",
      AI_USAGE_TRUST_PROXY: "true",
      AI_USAGE_STALE_HOURS: "12",
    });
    expect(config).toMatchObject({
      adminKey: ADMIN_KEY,
      publicBaseUrl: "https://usage.example.com",
      host: "0.0.0.0",
      port: 4000,
      logLevel: "warn",
      trustProxy: true,
      staleAfterMs: 12 * 60 * 60 * 1_000,
    });
    expect(config.databasePath.endsWith("data/test.sqlite")).toBe(true);
  });
});
