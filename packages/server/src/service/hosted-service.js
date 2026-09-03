import { createHash } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import Fastify from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import {
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import {
  bearerToken,
  cardOptionsFromQuery,
  createGitHubUserLookup,
  createProfileBodySchema,
  createProfileResponseSchema,
  errorResponseSchema,
  formatValidationError,
  getProviderMetadata,
  presentationCard,
  publishedCardPresentation,
  profileIdParamsSchema,
  profileResponseSchema,
  profileSlugParamsSchema,
  publicCardUrl,
  publishBodySchema,
  publishEnvelopeSchema,
  publishResponseSchema,
  toCardOptions,
  updateProfileBodySchema,
} from "@ai-usage-profile/shared";
import { renderCard } from "../render/card.js";
import { createProfileStore } from "./create-profile-store.js";
import {
  createProfileId,
  createPublishToken,
  credentialsEqual,
  GITHUB_BOUND_TOKEN_HASH,
  hashCredential,
} from "./profile-repository.js";
import { createCardStore, loadObjectStoreConfig } from "./object-store.js";

const MAX_CLOCK_SKEW_MS = 10 * 60 * 1_000;
const PUBLISH_LIMIT = { rateLimit: { max: 30, timeWindow: "1 minute" } };
const READ_LIMIT = { rateLimit: { max: 60, timeWindow: "1 minute" } };
const GITHUB_SNAPSHOT_LIMIT = {
  rateLimit: {
    max: 6,
    timeWindow: "1 hour",
    keyGenerator: (request) => {
      const token = bearerToken(request.headers.authorization);
      return token ? hashCredential(token) : request.ip;
    },
  },
};

const serviceEnvironmentSchema = z.object({
  AI_USAGE_ADMIN_KEY: z.string().min(32),
  DATABASE_URL: z.string().trim().min(1).optional(),
  AI_USAGE_DATABASE_PATH: z.string().trim().min(1).default("data/ai-usage-profile.sqlite"),
  AI_USAGE_PUBLIC_BASE_URL: z.url().optional(),
  AI_USAGE_HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
  AI_USAGE_LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  AI_USAGE_TRUST_PROXY: z.stringbool().default(false),
  AI_USAGE_STALE_HOURS: z.coerce.number().positive().max(24 * 30).default(24),
});

export function loadServiceConfig(environment = process.env) {
  const config = serviceEnvironmentSchema.parse(environment);
  return {
    adminKey: config.AI_USAGE_ADMIN_KEY,
    databaseUrl: config.DATABASE_URL,
    databasePath: path.resolve(config.AI_USAGE_DATABASE_PATH),
    objectStore: loadObjectStoreConfig(environment),
    publicBaseUrl: config.AI_USAGE_PUBLIC_BASE_URL,
    host: config.AI_USAGE_HOST,
    port: config.PORT,
    logLevel: config.AI_USAGE_LOG_LEVEL,
    trustProxy: config.AI_USAGE_TRUST_PROXY,
    staleAfterMs: config.AI_USAGE_STALE_HOURS * 60 * 60 * 1_000,
  };
}

function isUniqueConstraintError(error) {
  return error?.code === "23505"
    || error?.code === "SQLITE_CONSTRAINT_UNIQUE"
    || (error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed/i.test(error.message ?? ""));
}

function errorPayload(request, error, message) {
  return { error, message, requestId: request.id };
}

function requestOrigin(request, configuredBaseUrl) {
  return configuredBaseUrl ?? `${request.protocol}://${request.headers.host}`;
}

function cardUrl(request, profile, configuredBaseUrl) {
  return publicCardUrl(requestOrigin(request, configuredBaseUrl), profile.slug);
}

function snapshotStatus(profile, snapshot, url) {
  return {
    profileId: profile.id,
    providerId: profile.providerId,
    published: snapshot !== null,
    revision: snapshot?.revision ?? 0,
    collectedAt: snapshot?.collectedAt ?? null,
    receivedAt: snapshot?.receivedAt ?? null,
    cardUrl: url,
  };
}

function publicProfile(request, profile, baseUrl) {
  return {
    id: profile.id,
    slug: profile.slug,
    providerId: profile.providerId,
    cardUrl: cardUrl(request, profile, baseUrl),
    card: profile.card,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  };
}

function setSvgHeaders(reply, { etag, stale, collectedAt }) {
  reply
    .type("image/svg+xml; charset=utf-8")
    .header("Cache-Control", "public, no-cache")
    .header("ETag", etag)
    .header("Last-Modified", new Date(collectedAt).toUTCString())
    .header("X-Content-Type-Options", "nosniff")
    .header("Access-Control-Allow-Origin", "*")
    .header("X-AI-Usage-Snapshot", stale ? "stale" : "fresh");
}

async function publishRenderedCards(cardStore, profile, envelope, result) {
  if (!cardStore) return;
  const generatedAt = new Date(envelope.collectedAt);
  const meta = { revision: result.revision, collectedAt: envelope.collectedAt };
  const presentation = publishedCardPresentation(profile.card.username, {
    labels: profile.card.labels ?? {},
  });
  for (const theme of ["dark", "light"]) {
    const card = toCardOptions(presentation, { theme, generatedAt });
    const svg = renderCard({
      snapshot: envelope.snapshot,
      username: profile.card.username,
      ...card,
    });
    await cardStore.putCard(profile.slug, `${theme}.svg`, svg, meta);
    if (theme === "dark") {
      await cardStore.putCard(profile.slug, "card.svg", svg, meta);
    }
  }
}

export async function createHostedService({
  repository,
  databasePath,
  databaseUrl,
  cardStore,
  adminKey,
  publicBaseUrl,
  staleAfterMs = 24 * 60 * 60 * 1_000,
  trustProxy = false,
  logger = true,
  now = () => new Date(),
  lookupGitHubUser = createGitHubUserLookup(),
} = {}) {
  if (typeof adminKey !== "string" || adminKey.length < 32) {
    throw new TypeError("Hosted service requires an admin key of at least 32 characters");
  }
  const store = repository ?? await createProfileStore({ databaseUrl, databasePath, now });
  const adminKeyHash = hashCredential(adminKey);
  const app = Fastify({
    logger,
    trustProxy,
    bodyLimit: 256 * 1_024,
    requestIdHeader: "x-request-id",
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  });
  await app.register(rateLimit, {
    global: false,
  });

  app.decorate("profileRepository", store);

  app.addHook("onClose", async () => {
    await store.close();
  });

  async function requireAdmin(request, reply) {
    if (!credentialsEqual(bearerToken(request.headers.authorization), adminKeyHash)) {
      return reply.code(401).send(errorPayload(request, "unauthorized", "A valid admin bearer token is required"));
    }
  }

  async function requirePublisher(request, reply) {
    const profile = await store.getProfileById(request.params.id);
    if (!profile || !credentialsEqual(
      bearerToken(request.headers.authorization),
      profile.publishTokenHash,
    )) {
      return reply.code(401).send(errorPayload(request, "unauthorized", "A valid publishing token is required"));
    }
    request.profile = profile;
  }

  async function requireGitHubUser(request, reply) {
    const token = bearerToken(request.headers.authorization);
    if (!token) {
      return reply.code(401).send(errorPayload(request, "unauthorized", "A GitHub bearer token is required"));
    }
    let githubUser;
    try {
      githubUser = await lookupGitHubUser(token);
    } catch (error) {
      request.log.error({ err: error }, "github user lookup failed");
      return reply.code(503).send(errorPayload(request, "github_unavailable", "Unable to validate GitHub token"));
    }
    if (!githubUser) {
      return reply.code(401).send(errorPayload(request, "unauthorized", "GitHub token is invalid or expired"));
    }
    request.githubUser = githubUser;
  }

  async function writeSnapshot(request, reply, profile) {
    const collectedAt = Date.parse(request.body.collectedAt);
    if (collectedAt > now().valueOf() + MAX_CLOCK_SKEW_MS) {
      return reply.code(409).send(errorPayload(
        request,
        "invalid_timestamp",
        "collectedAt is too far in the future",
      ));
    }
    const existing = await store.getSnapshot(profile.id);
    if (existing && collectedAt < Date.parse(existing.collectedAt)) {
      return reply.code(409).send(errorPayload(
        request,
        "out_of_order_snapshot",
        "A newer snapshot has already been published",
      ));
    }
    const envelope = publishEnvelopeSchema.parse({
      ...request.body,
      snapshot: {
        ...request.body.snapshot,
        provider: getProviderMetadata(profile.providerId),
      },
    });
    const result = await store.saveSnapshot(profile.id, envelope);
    if (result.changed) {
      try {
        await publishRenderedCards(cardStore, profile, envelope, result);
      } catch (error) {
        request.log.error({ err: error }, "card upload failed");
        return reply.code(503).send(errorPayload(request, "card_upload_failed", "Unable to publish rendered card"));
      }
    }
    return {
      status: result.changed ? "updated" : "unchanged",
      revision: result.revision,
      receivedAt: result.receivedAt,
      cardUrl: cardUrl(request, profile, publicBaseUrl),
    };
  }

  app.get("/healthz", {
    schema: { hide: true },
  }, async () => ({ status: "ok" }));

  app.get("/readyz", {
    schema: { hide: true },
  }, async (_request, reply) => {
    const health = await store.health();
    let objectStoreOk = true;
    if (cardStore) {
      try {
        await cardStore.health();
      } catch {
        objectStoreOk = false;
      }
    }
    const ready = health.ok && objectStoreOk;
    return reply.code(ready ? 200 : 503).send({
      status: ready ? "ready" : "unavailable",
      profiles: health.profiles,
      objectStore: objectStoreOk,
    });
  });

  app.post("/v1/profiles", {
    onRequest: requireAdmin,
    config: PUBLISH_LIMIT,
    schema: {
      tags: ["admin"],
      security: [{ bearerAuth: [] }],
      body: createProfileBodySchema,
      response: {
        201: createProfileResponseSchema,
        401: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const provider = getProviderMetadata(request.body.providerId);
    const card = presentationCard(request.body.card?.username ?? request.body.slug, request.body.card);
    const id = createProfileId();
    const publishToken = createPublishToken(id);
    let profile;
    try {
      profile = await store.createProfile({
        id,
        slug: request.body.slug,
        providerId: provider.id,
        card,
        publishTokenHash: hashCredential(publishToken),
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send(errorPayload(request, "slug_conflict", "That profile slug already exists"));
      }
      throw error;
    }
    return reply.code(201).send({
      ...publicProfile(request, profile, publicBaseUrl),
      publishToken,
    });
  });

  app.get("/v1/profiles/:id", {
    onRequest: requireAdmin,
    config: READ_LIMIT,
    schema: {
      tags: ["admin"],
      params: profileIdParamsSchema,
      response: { 200: profileResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
    },
  }, async (request, reply) => {
    const profile = await store.getProfileById(request.params.id);
    if (!profile) return reply.code(404).send(errorPayload(request, "not_found", "Profile not found"));
    return publicProfile(request, profile, publicBaseUrl);
  });

  app.patch("/v1/profiles/:id", {
    onRequest: requireAdmin,
    config: READ_LIMIT,
    schema: {
      tags: ["admin"],
      params: profileIdParamsSchema,
      body: updateProfileBodySchema,
      response: { 200: profileResponseSchema, 401: errorResponseSchema, 404: errorResponseSchema },
    },
  }, async (request, reply) => {
    const existing = await store.getProfileById(request.params.id);
    if (!existing) return reply.code(404).send(errorPayload(request, "not_found", "Profile not found"));
    const card = presentationCard(existing.card.username, { ...existing.card, ...request.body.card });
    const profile = await store.updateProfile(existing.id, card);
    return publicProfile(request, profile, publicBaseUrl);
  });

  app.post("/v1/profiles/:id/token", {
    onRequest: requireAdmin,
    config: PUBLISH_LIMIT,
    schema: {
      tags: ["admin"],
      params: profileIdParamsSchema,
      response: {
        200: createProfileResponseSchema.pick({ publishToken: true }),
        401: errorResponseSchema,
        404: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const publishToken = createPublishToken(request.params.id);
    const profile = await store.updatePublishToken(request.params.id, hashCredential(publishToken));
    if (!profile) return reply.code(404).send(errorPayload(request, "not_found", "Profile not found"));
    return { publishToken };
  });

  app.delete("/v1/profiles/:id", {
    onRequest: requireAdmin,
    config: PUBLISH_LIMIT,
    schema: { tags: ["admin"], params: profileIdParamsSchema },
  }, async (request, reply) => {
    if (!(await store.deleteProfile(request.params.id))) {
      return reply.code(404).send(errorPayload(request, "not_found", "Profile not found"));
    }
    return reply.code(204).send();
  });

  app.put("/v1/me/snapshot", {
    onRequest: requireGitHubUser,
    config: GITHUB_SNAPSHOT_LIMIT,
    schema: {
      tags: ["publisher"],
      security: [{ githubAuth: [] }],
      body: publishBodySchema,
      response: {
        200: publishResponseSchema,
        401: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  }, async (request, reply) => {
    const githubUser = request.githubUser;
    let profile;
    try {
      profile = await store.upsertGitHubProfile({
        id: createProfileId(),
        githubUserId: githubUser.id,
        login: githubUser.login,
        providerId: "codex",
        card: publishedCardPresentation(githubUser.login),
        publishTokenHash: GITHUB_BOUND_TOKEN_HASH,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return reply.code(409).send(errorPayload(
          request,
          "slug_conflict",
          "That GitHub username is already bound to a different account",
        ));
      }
      throw error;
    }
    return writeSnapshot(request, reply, profile);
  });

  app.get("/v1/me/status", {
    onRequest: requireGitHubUser,
    config: READ_LIMIT,
    schema: { tags: ["publisher"], security: [{ githubAuth: [] }] },
  }, async (request) => {
    const profile = await store.getProfileByGithubUserId(request.githubUser.id);
    if (!profile) {
      return {
        username: request.githubUser.login,
        published: false,
        cardUrl: publicCardUrl(requestOrigin(request, publicBaseUrl), request.githubUser.slug),
      };
    }
    const snapshot = await store.getSnapshot(profile.id);
    return {
      username: profile.card.username,
      ...snapshotStatus(profile, snapshot, cardUrl(request, profile, publicBaseUrl)),
    };
  });

  app.put("/v1/profiles/:id/snapshot", {
    onRequest: requirePublisher,
    config: PUBLISH_LIMIT,
    schema: {
      tags: ["publisher"],
      params: profileIdParamsSchema,
      body: publishBodySchema,
      response: {
        200: publishResponseSchema,
        401: errorResponseSchema,
        409: errorResponseSchema,
      },
    },
  }, async (request, reply) => writeSnapshot(request, reply, request.profile));

  app.get("/v1/profiles/:id/status", {
    onRequest: requirePublisher,
    config: READ_LIMIT,
    schema: { tags: ["publisher"], params: profileIdParamsSchema },
  }, async (request) => {
    return snapshotStatus(
      request.profile,
      await store.getSnapshot(request.profile.id),
      cardUrl(request, request.profile, publicBaseUrl),
    );
  });

  app.get("/u/:slug/card.svg", {
    schema: { tags: ["public"], params: profileSlugParamsSchema },
  }, async (request, reply) => {
    const profile = await store.getProfileBySlug(request.params.slug);
    if (!profile) return reply.code(404).type("text/plain").send("Profile not found\n");
    const stored = await store.getSnapshot(profile.id);
    if (!stored) return reply.code(503).type("text/plain").send("Usage snapshot not published yet\n");

    let card;
    try {
      card = cardOptionsFromQuery(
        new URL(request.raw.url, "http://localhost").searchParams,
        profile.card,
        new Date(stored.collectedAt),
      );
    } catch (error) {
      return reply.code(400).type("text/plain").send(`${formatValidationError(error)}\n`);
    }
    const svg = renderCard({
      snapshot: stored.snapshot,
      username: profile.card.username,
      ...card,
    });
    const etag = `"${createHash("sha256").update(svg).digest("base64url")}"`;
    const stale = now().valueOf() - Date.parse(stored.receivedAt) >= staleAfterMs;
    setSvgHeaders(reply, { etag, stale, collectedAt: stored.collectedAt });
    if (request.headers["if-none-match"] === etag) return reply.code(304).send();
    return reply.send(svg);
  });

  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      return reply.code(400).send(errorPayload(request, "invalid_request", error.message));
    }
    request.log.error({ err: error }, "request failed");
    return reply.code(500).send(errorPayload(request, "internal_error", "Internal server error"));
  });

  return app;
}

export async function startHostedService({ config }) {
  const cardStore = createCardStore(config.objectStore);
  const app = await createHostedService({
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath,
    cardStore,
    adminKey: config.adminKey,
    publicBaseUrl: config.publicBaseUrl,
    staleAfterMs: config.staleAfterMs,
    trustProxy: config.trustProxy,
    logger: { level: config.logLevel },
  });
  await app.listen({ host: config.host, port: config.port });
  return app;
}
