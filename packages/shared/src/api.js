import { FetchError, ofetch } from "ofetch";
import { createHash } from "node:crypto";
import { z } from "zod";
import { parseUsageSnapshot, publishResponseSchema } from "./schema.js";

export function bearerToken(authorization) {
  if (typeof authorization !== "string") return null;
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match?.[1] ?? null;
}

export function bearerHeaders(token, extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

export class ApiError extends Error {
  constructor(message, { status, retryable = false, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.retryable = retryable;
  }
}

export { ApiError as PublisherError };

const RETRYABLE = [408, 429, 500, 502, 503, 504];

export const publisherClientOptionsSchema = z.object({
  endpoint: z.url(),
  token: z.string().min(8),
  timeoutMs: z.number().int().positive().max(120_000).default(30_000),
  retries: z.number().int().min(0).max(5).default(3),
});

export const adminClientOptionsSchema = z.object({
  endpoint: z.url(),
  adminKey: z.string().min(32),
});

function throwApiError(error) {
  const message = typeof error.data?.message === "string" ? error.data.message : error.statusText;
  throw new ApiError(message, {
    status: error.status,
    retryable: RETRYABLE.includes(error.status),
  });
}

export function createApiClient({
  baseUrl,
  token,
  timeoutMs = 30_000,
  retries = 0,
  userAgent = "ai-usage-profile/1",
  fetch: fetchImpl,
}) {
  if (typeof token !== "string" || token.length < 8) {
    throw new TypeError("token must be at least 8 characters");
  }

  const client = ofetch.create(
    {
      baseURL: baseUrl,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "User-Agent": userAgent,
      },
      timeout: timeoutMs,
      retry: retries,
      retryStatusCodes: RETRYABLE,
    },
    fetchImpl ? { fetch: fetchImpl } : {},
  );

  return {
    async request(method, pathname, { body, schema } = {}) {
      try {
        const payload = await client(pathname, { method, body });
        return schema ? schema.parse(payload) : payload;
      } catch (error) {
        if (error instanceof FetchError) throwApiError(error);
        throw error;
      }
    },
  };
}

export class PublisherClient {
  constructor(options) {
    const config = publisherClientOptionsSchema.parse(options);
    this.api = createApiClient({
      baseUrl: config.endpoint,
      token: config.token,
      timeoutMs: config.timeoutMs,
      retries: config.retries,
      userAgent: "ai-usage-profile-publisher/1",
      fetch: options.fetch,
    });
  }

  async publish(snapshot, { collectedAt = new Date() } = {}) {
    return this.api.request("PUT", "/v1/me/snapshot", {
      body: {
        schemaVersion: 1,
        collectedAt: collectedAt.toISOString(),
        snapshot: parseUsageSnapshot(snapshot),
      },
      schema: publishResponseSchema,
    });
  }
}

export async function publishProviderSnapshot({ provider, collectedAt, ...clientOptions }) {
  if (!provider || typeof provider.fetch !== "function") {
    throw new TypeError("publishProviderSnapshot requires a provider with fetch()");
  }
  return new PublisherClient(clientOptions).publish(await provider.fetch(), { collectedAt });
}

export async function verifyGitHubUser(token, { fetch: fetchImpl, timeoutMs = 10_000 } = {}) {
  if (typeof token !== "string" || token.length < 8) return null;
  const client = ofetch.create(
    {
      baseURL: "https://api.github.com",
      timeout: timeoutMs,
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "ai-usage-profile",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
    fetchImpl ? { fetch: fetchImpl } : {},
  );
  try {
    const user = await client("/user", { headers: bearerHeaders(token) });
    if (!Number.isInteger(user.id) || typeof user.login !== "string" || user.login.length === 0) {
      throw new Error("GitHub user response was invalid");
    }
    return { id: user.id, login: user.login, slug: user.login.toLowerCase() };
  } catch (error) {
    if (error instanceof FetchError && [401, 403].includes(error.status)) return null;
    if (error instanceof FetchError) throw new Error(`GitHub user lookup failed (${error.status})`, { cause: error });
    throw error;
  }
}

export function createGitHubUserLookup({
  fetch: fetchImpl,
  now = Date.now,
  ttlMs = 30_000,
  maxEntries = 256,
} = {}) {
  const cache = new Map();
  return async function lookupGitHubUser(token) {
    const cacheKey = createHash("sha256").update(token, "utf8").digest("base64url");
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > now()) return cached.user;
    if (cached) cache.delete(cacheKey);
    const user = await verifyGitHubUser(token, { fetch: fetchImpl });
    if (user) {
      if (cache.size >= maxEntries) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }
      cache.set(cacheKey, { user, expiresAt: now() + ttlMs });
    }
    return user;
  };
}
