import { createHostedService } from "@ai-usage-profile/server";
import { verifyGitHubUser } from "@ai-usage-profile/shared";
import { ADMIN_KEY, loadUsageSnapshot } from "../../test-support/helpers.js";

describe("GitHub publishing", () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await loadUsageSnapshot();
  });

  it("maps GET /user onto login and slug", async () => {
    const user = await verifyGitHubUser("gho_token", {
      fetch: async (_url, init) => {
        expect(init.headers.get("Authorization")).toBe("Bearer gho_token");
        return Response.json({ id: 7, login: "Moquent" });
      },
    });
    expect(user).toEqual({ id: 7, login: "Moquent", slug: "moquent" });
    expect(await verifyGitHubUser("gho_bad", {
      fetch: async () => new Response("nope", { status: 401 }),
    })).toBeNull();
  });

  it("publishes a card bound to the GitHub username", async () => {
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      publicBaseUrl: "https://aiusage.teje.sh",
      logger: false,
      lookupGitHubUser: async (token) => {
        if (token === "gho_moquent") return { id: 1, login: "Moquent", slug: "moquent" };
        return null;
      },
    });
    try {
      const denied = await app.inject({
        method: "PUT",
        url: "/v1/me/snapshot",
        headers: { authorization: "Bearer gho_other" },
        payload: { schemaVersion: 1, collectedAt: "2026-08-30T12:00:00.000Z", snapshot },
      });
      expect(denied.statusCode).toBe(401);

      const published = await app.inject({
        method: "PUT",
        url: "/v1/me/snapshot",
        headers: { authorization: "Bearer gho_moquent" },
        payload: { schemaVersion: 1, collectedAt: "2026-08-30T12:00:00.000Z", snapshot },
      });
      expect(published.statusCode).toBe(200);
      expect(published.json().cardUrl).toBe("https://aiusage.teje.sh/u/moquent/card.svg");

      const status = await app.inject({
        method: "GET",
        url: "/v1/me/status",
        headers: { authorization: "Bearer gho_moquent" },
      });
      expect(status.json().username).toBe("Moquent");
      expect(status.json().published).toBe(true);

      const card = await app.inject({ method: "GET", url: "/u/Moquent/card.svg?theme=dark" });
      expect(card.statusCode).toBe(200);
      expect(card.headers["content-type"]).toMatch(/^image\/svg\+xml/);
    } finally {
      await app.close();
    }
  });
});
