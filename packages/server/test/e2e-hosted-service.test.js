import { createHostedService } from "../src/service/hosted-service.js";
import { ADMIN_KEY, BASE_URL, loadUsageSnapshot } from "../../test-support/helpers.js";

/**
 * End-to-end smoke: public pages, admin publish path, GitHub publish path,
 * security guards, and profile deletion with object-store cleanup.
 */
describe("hosted service e2e", () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await loadUsageSnapshot();
  });

  it("runs the full public and publisher lifecycle", async () => {
    let current = new Date("2026-08-30T12:00:00.000Z");
    const deletedSlugs = [];
    const uploadedThemes = [];

    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      publicBaseUrl: BASE_URL,
      logger: false,
      now: () => current,
      lookupGitHubUser: async (token) => {
        if (token === "gho_e2e_user") return { id: 42, login: "E2eUser", slug: "e2euser" };
        return null;
      },
      cardStore: {
        async putCard(slug, filename, _svg, _meta) {
          uploadedThemes.push(`${slug}/${filename}`);
        },
        async deleteCards(slug) {
          deletedSlugs.push(slug);
        },
      },
    });

    try {
      const home = await app.inject({ method: "GET", url: "/" });
      const privacy = await app.inject({ method: "GET", url: "/privacy" });
      const terms = await app.inject({ method: "GET", url: "/terms" });
      expect(home.statusCode).toBe(200);
      expect(privacy.statusCode).toBe(200);
      expect(terms.statusCode).toBe(200);
      expect(home.body).toMatch(/npx ai-usage-profile setup/);
      expect(privacy.body).toMatch(/<strong>/);
      const health = await app.inject({ method: "GET", url: "/healthz" });
      expect(health.json()).toEqual({ status: "ok" });

      const created = await app.inject({
        method: "POST",
        url: "/v1/profiles",
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
        payload: {
          slug: "admin-user",
          providerId: "codex",
          card: {
            username: "AdminUser",
            layout: "profile",
            stats: ["lifetime", "peak", "current-streak"],
            identity: true,
          },
        },
      });
      expect(created.statusCode).toBe(201);
      const profile = created.json();

      const published = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${profile.id}/snapshot`,
        headers: { authorization: `Bearer ${profile.publishToken}` },
        payload: {
          schemaVersion: 1,
          collectedAt: "2026-08-30T11:59:00.000Z",
          snapshot,
        },
      });
      expect(published.statusCode).toBe(200);
      expect(uploadedThemes).toEqual(expect.arrayContaining([
        "admin-user/dark.svg",
        "admin-user/light.svg",
        "admin-user/card.svg",
      ]));

      const card = await app.inject({
        method: "GET",
        url: "/u/admin-user/card.svg?theme=dark&layout=profile",
      });
      expect(card.statusCode).toBe(200);
      expect(card.headers.etag).toBeDefined();
      const cached = await app.inject({
        method: "GET",
        url: "/u/admin-user/card.svg?theme=dark&layout=profile",
        headers: { "if-none-match": card.headers.etag },
      });
      expect(cached.statusCode).toBe(304);

      const githubPublished = await app.inject({
        method: "PUT",
        url: "/v1/me/snapshot",
        headers: { authorization: "Bearer gho_e2e_user" },
        payload: {
          schemaVersion: 1,
          collectedAt: "2026-08-30T12:00:00.000Z",
          snapshot,
        },
      });
      expect(githubPublished.statusCode).toBe(200);

      const githubStatus = await app.inject({
        method: "GET",
        url: "/v1/me/status",
        headers: { authorization: "Bearer gho_e2e_user" },
      });
      const githubProfileId = githubStatus.json().profileId;

      const boundDenied = await app.inject({
        method: "PUT",
        url: `/v1/profiles/${githubProfileId}/snapshot`,
        headers: { authorization: "Bearer github-bound" },
        payload: {
          schemaVersion: 1,
          collectedAt: "2026-08-30T12:01:00.000Z",
          snapshot,
        },
      });
      expect(boundDenied.statusCode).toBe(401);

      const deleted = await app.inject({
        method: "DELETE",
        url: `/v1/profiles/${profile.id}`,
        headers: { authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(deleted.statusCode).toBe(204);
      expect(deletedSlugs).toContain("admin-user");
      expect(await app.profileRepository.getProfileById(profile.id)).toBeNull();
      const missingCard = await app.inject({ method: "GET", url: "/u/admin-user/card.svg" });
      expect(missingCard.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
