import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";
import { presentationConfigSchema, publishEnvelopeSchema } from "@ai-usage-profile/shared";

const migrationsUrl = new URL("../../migrations/postgres/", import.meta.url);

function mapProfile(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    githubUserId: row.github_user_id ?? null,
    providerId: row.provider_id,
    card: presentationConfigSchema.parse(JSON.parse(row.card_config)),
    publishTokenHash: row.publish_token_hash,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapSnapshot(row) {
  if (!row?.snapshot) return null;
  const envelope = publishEnvelopeSchema.parse({
    schemaVersion: row.schema_version,
    collectedAt: row.collected_at.toISOString(),
    snapshot: JSON.parse(row.snapshot),
  });
  return {
    ...envelope,
    hash: row.snapshot_hash,
    receivedAt: row.received_at.toISOString(),
    revision: row.revision,
  };
}

export class PostgresProfileRepository {
  constructor({ connectionString, now = () => new Date() }) {
    this.pool = new pg.Pool({ connectionString, max: 10 });
    this.now = now;
  }

  async init() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL
        )
      `);
      const applied = new Set(
        (await client.query("SELECT version FROM schema_migrations")).rows.map(({ version }) => version),
      );
      const migrations = readdirSync(migrationsUrl)
        .filter((filename) => /^\d+_[a-z0-9_-]+\.sql$/i.test(filename))
        .sort();
      for (const filename of migrations) {
        const version = Number.parseInt(filename.split("_", 1)[0], 10);
        if (applied.has(version)) continue;
        await client.query("BEGIN");
        try {
          await client.query(readFileSync(new URL(filename, migrationsUrl), "utf8"));
          await client.query(
            "INSERT INTO schema_migrations(version, applied_at) VALUES ($1, $2)",
            [version, this.now().toISOString()],
          );
          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }
    } finally {
      client.release();
    }
  }

  async createProfile({ id, slug, providerId, card, publishTokenHash, githubUserId = null }) {
    const timestamp = this.now().toISOString();
    await this.pool.query(`
      INSERT INTO profiles(
        id, slug, github_user_id, provider_id, username, card_config, publish_token_hash, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `, [
      id,
      slug.toLowerCase(),
      githubUserId,
      providerId,
      card.username,
      JSON.stringify(card),
      publishTokenHash,
      timestamp,
      timestamp,
    ]);
    return this.getProfileById(id);
  }

  async getProfileById(id) {
    const { rows } = await this.pool.query("SELECT * FROM profiles WHERE id = $1", [id]);
    return mapProfile(rows[0]);
  }

  async getProfileBySlug(slug) {
    const { rows } = await this.pool.query(
      "SELECT * FROM profiles WHERE lower(slug) = lower($1)",
      [slug],
    );
    return mapProfile(rows[0]);
  }

  async getProfileByGithubUserId(githubUserId) {
    const { rows } = await this.pool.query(
      "SELECT * FROM profiles WHERE github_user_id = $1",
      [githubUserId],
    );
    return mapProfile(rows[0]);
  }

  async upsertGitHubProfile({ githubUserId, login, providerId, card, publishTokenHash, id }) {
    const slug = login.toLowerCase();
    const existing = await this.getProfileByGithubUserId(githubUserId);
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
    await this.pool.query(`
      UPDATE profiles
      SET slug = $1, username = $2, card_config = $3, updated_at = $4
      WHERE github_user_id = $5
    `, [slug, login, JSON.stringify(nextCard), this.now().toISOString(), githubUserId]);
    return this.getProfileByGithubUserId(githubUserId);
  }

  async updateProfile(id, card) {
    const { rowCount } = await this.pool.query(`
      UPDATE profiles SET username = $1, card_config = $2, updated_at = $3 WHERE id = $4
    `, [card.username, JSON.stringify(card), this.now().toISOString(), id]);
    return rowCount === 0 ? null : this.getProfileById(id);
  }

  async updatePublishToken(id, publishTokenHash) {
    const { rowCount } = await this.pool.query(`
      UPDATE profiles SET publish_token_hash = $1, updated_at = $2 WHERE id = $3
    `, [publishTokenHash, this.now().toISOString(), id]);
    return rowCount === 0 ? null : this.getProfileById(id);
  }

  async deleteProfile(id) {
    const { rowCount } = await this.pool.query("DELETE FROM profiles WHERE id = $1", [id]);
    return rowCount > 0;
  }

  async getSnapshot(profileId) {
    const { rows } = await this.pool.query("SELECT * FROM snapshots WHERE profile_id = $1", [profileId]);
    return mapSnapshot(rows[0]);
  }

  async saveSnapshot(profileId, envelope) {
    const parsed = publishEnvelopeSchema.parse(envelope);
    const serialized = JSON.stringify(parsed.snapshot);
    const hash = createHash("sha256").update(serialized).digest("base64url");
    const receivedAt = this.now().toISOString();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query(
        "SELECT snapshot_hash, revision, received_at FROM snapshots WHERE profile_id = $1",
        [profileId],
      );
      const row = existing.rows[0];
      if (row?.snapshot_hash === hash) {
        await client.query(`
          UPDATE snapshots SET schema_version = $1, collected_at = $2, received_at = $3
          WHERE profile_id = $4
        `, [parsed.schemaVersion, parsed.collectedAt, receivedAt, profileId]);
        await client.query("COMMIT");
        return { changed: false, revision: row.revision, receivedAt, hash };
      }
      const revision = (row?.revision ?? 0) + 1;
      await client.query(`
        INSERT INTO snapshots(
          profile_id, schema_version, snapshot, snapshot_hash, collected_at, received_at, revision
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT(profile_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          snapshot = EXCLUDED.snapshot,
          snapshot_hash = EXCLUDED.snapshot_hash,
          collected_at = EXCLUDED.collected_at,
          received_at = EXCLUDED.received_at,
          revision = EXCLUDED.revision
      `, [
        profileId,
        parsed.schemaVersion,
        serialized,
        hash,
        parsed.collectedAt,
        receivedAt,
        revision,
      ]);
      await client.query("COMMIT");
      return { changed: true, revision, receivedAt, hash };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async health() {
    const { rows } = await this.pool.query("SELECT 1 AS ok, COUNT(*)::int AS count FROM profiles");
    return { ok: rows[0].ok === 1, profiles: rows[0].count };
  }

  async close() {
    await this.pool.end();
  }
}
