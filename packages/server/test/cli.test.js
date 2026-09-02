import { createHostedService } from "../src/service/hosted-service.js";
import { ADMIN_KEY, BASE_URL, captureStdout } from "../../test-support/helpers.js";

describe("server CLI behavior", () => {
  it("creates a profile through the hidden admin command", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, publicBaseUrl: BASE_URL, logger: false });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const stdout = captureStdout();
    const previous = {
      AI_USAGE_ENDPOINT: process.env.AI_USAGE_ENDPOINT,
      AI_USAGE_ADMIN_KEY: process.env.AI_USAGE_ADMIN_KEY,
    };
    process.env.AI_USAGE_ENDPOINT = endpoint;
    process.env.AI_USAGE_ADMIN_KEY = ADMIN_KEY;
    try {
      const { createProgram } = await import("../src/cli.js");
      await createProgram().parseAsync([
        "profile",
        "create",
        "--slug",
        "moquent",
        "--username",
        "Moquent",
        "--layout",
        "stats",
        "--stats",
        "lifetime,peak",
        "--identity",
        "hide",
      ], { from: "user" });
      const created = JSON.parse(stdout.output());
      expect(created.slug).toBe("moquent");
      expect(created.card.username).toBe("Moquent");
      expect(created.card.layout).toBe("stats");
      expect(created.publishToken).toMatch(/^aup_v1_/);
    } finally {
      stdout.restore();
      process.env.AI_USAGE_ENDPOINT = previous.AI_USAGE_ENDPOINT;
      process.env.AI_USAGE_ADMIN_KEY = previous.AI_USAGE_ADMIN_KEY;
      await app.close();
    }
  });

  it("rotates a publishing token through the hidden admin command", async () => {
    const app = await createHostedService({ adminKey: ADMIN_KEY, publicBaseUrl: BASE_URL, logger: false });
    const created = await app.inject({
      method: "POST",
      url: "/v1/profiles",
      headers: { authorization: `Bearer ${ADMIN_KEY}` },
      payload: { slug: "rotate-me", providerId: "codex", card: { username: "RotateMe" } },
    });
    const profile = created.json();
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    const endpoint = `http://127.0.0.1:${address.port}`;
    const stdout = captureStdout();
    const previous = {
      AI_USAGE_ENDPOINT: process.env.AI_USAGE_ENDPOINT,
      AI_USAGE_ADMIN_KEY: process.env.AI_USAGE_ADMIN_KEY,
    };
    process.env.AI_USAGE_ENDPOINT = endpoint;
    process.env.AI_USAGE_ADMIN_KEY = ADMIN_KEY;
    try {
      const { createProgram } = await import("../src/cli.js");
      await createProgram().parseAsync([
        "profile",
        "rotate-token",
        "--id",
        profile.id,
      ], { from: "user" });
      const rotated = JSON.parse(stdout.output());
      expect(rotated.publishToken).toMatch(/^aup_v1_/);
      expect(rotated.publishToken).not.toBe(profile.publishToken);
    } finally {
      stdout.restore();
      process.env.AI_USAGE_ENDPOINT = previous.AI_USAGE_ENDPOINT;
      process.env.AI_USAGE_ADMIN_KEY = previous.AI_USAGE_ADMIN_KEY;
      await app.close();
    }
  });

  it("fails when required environment variables are missing", async () => {
    const previous = process.env.AI_USAGE_ADMIN_KEY;
    delete process.env.AI_USAGE_ADMIN_KEY;
    try {
      const { createProgram } = await import("../src/cli.js");
      await expect(createProgram().parseAsync([
        "profile",
        "create",
        "--slug",
        "moquent",
        "--endpoint",
        "https://usage.example.com",
      ], { from: "user" })).rejects.toThrow(/AI_USAGE_ADMIN_KEY/);
    } finally {
      process.env.AI_USAGE_ADMIN_KEY = previous;
    }
  });
});
