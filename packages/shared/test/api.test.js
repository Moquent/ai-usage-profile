import {
  ApiError,
  PublisherError,
  bearerHeaders,
  bearerToken,
  createApiClient,
  createGitHubUserLookup,
  publishProviderSnapshot,
  verifyGitHubUser,
} from "../src/api.js";

describe("shared API helpers", () => {
  it("parses bearer tokens from authorization headers", () => {
    expect(bearerToken("Bearer secret-token")).toBe("secret-token");
    expect(bearerToken("Basic abc")).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
    expect(bearerHeaders("secret-token")).toEqual({ Authorization: "Bearer secret-token" });
  });

  it("validates GitHub users and caches lookups", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return Response.json({ id: 9, login: "Moquent" });
    };
    const lookup = createGitHubUserLookup({ fetch: fetchImpl, ttlMs: 60_000, now: () => 1_000 });
    expect(await lookup("gho_cached")).toMatchObject({ login: "Moquent" });
    expect(await lookup("gho_cached")).toMatchObject({ login: "Moquent" });
    expect(calls).toBe(1);
    expect(await verifyGitHubUser("short")).toBeNull();
  });

  it("maps GitHub API failures to null or descriptive errors", async () => {
    expect(await verifyGitHubUser("gho_bad", {
      fetch: async () => new Response("nope", { status: 401 }),
    })).toBeNull();
    await expect(verifyGitHubUser("gho_server", {
      fetch: async () => new Response("boom", { status: 500 }),
    })).rejects.toThrow(/GitHub user lookup failed/);
  });

  it("throws ApiError details from failed HTTP responses", async () => {
    const client = createApiClient({
      baseUrl: "https://usage.example.com",
      token: "publisher-token-that-is-long-enough",
      fetch: async () => Response.json({ message: "invalid token" }, { status: 401 }),
    });
    await expect(client.request("GET", "/v1/me/status")).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      retryable: false,
    });
    expect(PublisherError).toBe(ApiError);
  });

  it("requires a provider when publishing snapshots", async () => {
    await expect(publishProviderSnapshot({
      endpoint: "https://usage.example.com",
      token: "publisher-token-that-is-long-enough",
    })).rejects.toThrow(/provider/);
  });

  it("rejects short API client tokens and invalid GitHub user payloads", async () => {
    expect(() => createApiClient({
      baseUrl: "https://usage.example.com",
      token: "short",
    })).toThrow(/at least 8 characters/);

    await expect(verifyGitHubUser("gho_valid_token", {
      fetch: async () => Response.json({ id: "bad", login: "" }),
    })).rejects.toThrow(/invalid/);
  });

  it("rethrows non-auth GitHub fetch failures from verifyGitHubUser", async () => {
    await expect(verifyGitHubUser("gho_valid_token", {
      fetch: async () => new Response("bad gateway", { status: 502 }),
    })).rejects.toThrow(/GitHub user lookup failed/);
  });
});
