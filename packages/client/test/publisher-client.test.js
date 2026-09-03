import { createHostedService } from "@ai-usage-profile/server";
import { PublisherClient } from "@ai-usage-profile/shared";
import { ADMIN_KEY, loadUsageSnapshot } from "../../test-support/helpers.js";

describe("publisher client", () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await loadUsageSnapshot();
  });

  it("completes a real HTTP round trip to the hosted service", async () => {
    const app = await createHostedService({
      adminKey: ADMIN_KEY,
      logger: false,
      lookupGitHubUser: async (token) => {
        if (token === "gho_moquent_token") return { id: 1, login: "Moquent", slug: "moquent" };
        return null;
      },
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    try {
      const address = app.server.address();
      const endpoint = `http://127.0.0.1:${address.port}`;
      const result = await new PublisherClient({
        endpoint,
        token: "gho_moquent_token",
        retries: 0,
      }).publish(snapshot, { collectedAt: new Date("2026-08-30T12:00:00.000Z") });
      expect(result.status).toBe("updated");
      expect(result.revision).toBe(1);
      const card = await fetch(result.cardUrl);
      expect(card.status).toBe(200);
      expect(await card.text()).toMatch(/Codex token activity/);
    } finally {
      await app.close();
    }
  });

  it("publishes to /v1/me/snapshot", async () => {
    let requested;
    const client = new PublisherClient({
      endpoint: "https://aiusage.teje.sh",
      token: "gho_moquent_token",
      retries: 0,
      fetch: async (url, init) => {
        requested = { url: String(url), authorization: init.headers.get("Authorization") };
        return Response.json({
          status: "updated",
          revision: 1,
          receivedAt: "2026-08-30T12:00:00.000Z",
          cardUrl: "https://aiusage.teje.sh/u/moquent/card.svg",
        });
      },
    });
    const result = await client.publish(snapshot, { collectedAt: new Date("2026-08-30T12:00:00.000Z") });
    expect(requested.url).toBe("https://aiusage.teje.sh/v1/me/snapshot");
    expect(requested.authorization).toBe("Bearer gho_moquent_token");
    expect(result.cardUrl).toBe("https://aiusage.teje.sh/u/moquent/card.svg");
  });

  it("retries transient failures and does not retry authentication failures", async () => {
    let attempts = 0;
    const successful = new PublisherClient({
      endpoint: "https://usage.example.com",
      token: "publisher-token-that-is-long-enough-for-validation",
      retries: 2,
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) return new Response("unavailable", { status: 503 });
        return Response.json({
          status: "updated",
          revision: 1,
          receivedAt: "2026-08-30T12:00:00.000Z",
          cardUrl: "https://usage.example.com/u/moquent/card.svg",
        });
      },
    });
    expect((await successful.publish(snapshot)).revision).toBe(1);
    expect(attempts).toBe(2);

    attempts = 0;
    const rejected = new PublisherClient({
      endpoint: "https://usage.example.com",
      token: "publisher-token-that-is-long-enough-for-validation",
      retries: 2,
      fetch: async () => {
        attempts += 1;
        return Response.json({ message: "invalid token" }, { status: 401 });
      },
    });
    await expect(rejected.publish(snapshot)).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
    });
    expect(attempts).toBe(1);
  });

  it("rejects short tokens at construction time", () => {
    expect(() => new PublisherClient({ endpoint: "https://usage.example.com", token: "short" }))
      .toThrow();
  });
});
