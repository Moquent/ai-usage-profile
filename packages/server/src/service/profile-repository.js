import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseStoredPresentation, publishEnvelopeSchema } from "@ai-usage-profile/shared";

const TOKEN_PREFIX = "aup_v1";

export function createProfileId() {
  return randomUUID();
}

export function createPublishToken(profileId) {
  return `${TOKEN_PREFIX}_${profileId}.${randomBytes(32).toString("base64url")}`;
}

export function hashCredential(value) {
  return createHash("sha256").update(value, "utf8").digest("base64url");
}

export const GITHUB_BOUND_TOKEN_HASH = hashCredential("github-bound");

export function credentialHashEquals(leftHash, rightHash) {
  if (typeof leftHash !== "string" || typeof rightHash !== "string") return false;
  const left = Buffer.from(leftHash);
  const right = Buffer.from(rightHash);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function credentialsEqual(candidate, expectedHash) {
  if (typeof candidate !== "string" || typeof expectedHash !== "string") return false;
  return credentialHashEquals(hashCredential(candidate), expectedHash);
}

export function isGitHubBoundProfile(profile) {
  return profile && credentialHashEquals(profile.publishTokenHash, GITHUB_BOUND_TOKEN_HASH);
}

const migrationsUrl = new URL("../../migrations/", import.meta.url);

function withTransaction(database, fn) {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    githubUserId: row.github_user_id ?? null,
    providerId: row.provider_id,
    card: parseStoredPresentation(row.card_config),
    publishTokenHash: row.publish_token_hash,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapSnapshot(row) {
  if (!row?.snapshot) return null;
  const envelope = publishEnvelopeSchema.parse({
    schemaVersion: row.schema_version,
    collectedAt: row.collected_at,
    snapshot: JSON.parse(row.snapshot),
  });
  return {
    ...envelope,
    hash: row.snapshot_hash,
    receivedAt: row.received_at,
    revision: row.revision,
  };
}

export class ProfileRepository {
  constructor({ filename = ":memory:", now = () => new Date() } = {}) {
    if (filename !== ":memory:") mkdirSync(path.dirname(path.resolve(filename)), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.now = now;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    if (filename !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL");
    this.#migrate();
  }

  #migrate() {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = new Set(
      this.database.prepare("SELECT version FROM schema_migrations").all().map(({ version }) => version),
    );
    const migrations = readdirSync(migrationsUrl)
      .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
      .sort();
    for (const filename of migrations) {
      const version = Number.parseInt(filename.split("_", 1)[0], 10);
      if (applied.has(version)) continue;
      withTransaction(this.database, () => {
        this.database.exec(readFileSync(new URL(filename, migrationsUrl), "utf8"));
        this.database.prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
        ).run(version, this.now().toISOString());
      });
    }
  }

  createProfile({ id, slug, providerId, card, publishTokenHash, githubUserId = null }) {
    const timestamp = this.now().toISOString();
    this.database.prepare(`
      INSERT INTO profiles(
        id, slug, github_user_id, provider_id, username, card_config, publish_token_hash, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      slug.toLowerCase(),
      githubUserId,
      providerId,
      card.username,
      JSON.stringify(card),
      publishTokenHash,
      timestamp,
      timestamp,
    );
    return this.getProfileById(id);
  }

  getProfileById(id) {
    return mapProfile(this.database.prepare("SELECT * FROM profiles WHERE id = ?").get(id));
  }

  getProfileBySlug(slug) {
    return mapProfile(this.database.prepare(
      "SELECT * FROM profiles WHERE lower(slug) = lower(?)",
    ).get(slug));
  }

  getProfileByGithubUserId(githubUserId) {
    return mapProfile(this.database.prepare(
      "SELECT * FROM profiles WHERE github_user_id = ?",
    ).get(githubUserId));
  }

  upsertGitHubProfile({ githubUserId, login, providerId, card, publishTokenHash, id }) {
    const slug = login.toLowerCase();
    const existing = this.getProfileByGithubUserId(githubUserId);
    if (!existing) {
      return this.createProfile({
        id,
        slug,
        githubUserId,
        providerId,
        card: { ...card, username: login },
        publishTokenHash,
      });
    }

    const nextCard = { ...existing.card, username: login };
    this.database.prepare(`
      UPDATE profiles
      SET slug = ?, username = ?, card_config = ?, updated_at = ?
      WHERE github_user_id = ?
    `).run(slug, login, JSON.stringify(nextCard), this.now().toISOString(), githubUserId);
    return this.getProfileByGithubUserId(githubUserId);
  }

  updateProfile(id, card) {
    const result = this.database.prepare(`
      UPDATE profiles SET username = ?, card_config = ?, updated_at = ? WHERE id = ?
    `).run(card.username, JSON.stringify(card), this.now().toISOString(), id);
    return result.changes === 0 ? null : this.getProfileById(id);
  }

  updatePublishToken(id, publishTokenHash) {
    const result = this.database.prepare(`
      UPDATE profiles SET publish_token_hash = ?, updated_at = ? WHERE id = ?
    `).run(publishTokenHash, this.now().toISOString(), id);
    return result.changes === 0 ? null : this.getProfileById(id);
  }

  deleteProfile(id) {
    return this.database.prepare("DELETE FROM profiles WHERE id = ?").run(id).changes > 0;
  }

  getSnapshot(profileId) {
    return mapSnapshot(this.database.prepare("SELECT * FROM snapshots WHERE profile_id = ?").get(profileId));
  }

  saveSnapshot(profileId, envelope) {
    const parsed = publishEnvelopeSchema.parse(envelope);
    const serialized = JSON.stringify(parsed.snapshot);
    const hash = createHash("sha256").update(serialized).digest("base64url");
    const receivedAt = this.now().toISOString();

    return withTransaction(this.database, () => {
      const existing = this.database.prepare(
        "SELECT snapshot_hash, revision, received_at FROM snapshots WHERE profile_id = ?",
      ).get(profileId);
      if (existing?.snapshot_hash === hash) {
        this.database.prepare(`
          UPDATE snapshots SET schema_version = ?, collected_at = ?, received_at = ?
          WHERE profile_id = ?
        `).run(parsed.schemaVersion, parsed.collectedAt, receivedAt, profileId);
        return { changed: false, revision: existing.revision, receivedAt, hash };
      }
      const revision = (existing?.revision ?? 0) + 1;
      this.database.prepare(`
        INSERT INTO snapshots(
          profile_id, schema_version, snapshot, snapshot_hash, collected_at, received_at, revision
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          snapshot = excluded.snapshot,
          snapshot_hash = excluded.snapshot_hash,
          collected_at = excluded.collected_at,
          received_at = excluded.received_at,
          revision = excluded.revision
      `).run(
        profileId,
        parsed.schemaVersion,
        serialized,
        hash,
        parsed.collectedAt,
        receivedAt,
        revision,
      );
      return { changed: true, revision, receivedAt, hash };
    });
  }

  health() {
    const { ok } = this.database.prepare("SELECT 1 AS ok").get();
    const { count } = this.database.prepare("SELECT COUNT(*) AS count FROM profiles").get();
    return { ok: ok === 1, profiles: count };
  }

  close() {
    this.database.close();
  }
}
