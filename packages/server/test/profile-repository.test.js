import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ProfileRepository } from "../src/service/profile-repository.js";
import { loadUsageSnapshot } from "../../test-support/helpers.js";

const card = {
  username: "Moquent",
  layout: "graph",
  stats: ["lifetime", "peak"],
  labels: {},
  identity: false,
};

describe("profile repository", () => {
  let snapshot;

  beforeAll(async () => {
    snapshot = await loadUsageSnapshot();
  });

  it("migrates, persists profiles, and revisions snapshots atomically", () => {
    let current = new Date("2026-08-30T12:00:00.000Z");
    const repository = new ProfileRepository({ now: () => current });
    try {
      const profile = repository.createProfile({
        id: "b2168b83-27d6-46cf-a543-7086aa49fd53",
        slug: "moquent",
        providerId: "codex",
        card,
        publishTokenHash: "hashed-token",
      });
      expect(profile.card.username).toBe("Moquent");
      expect(repository.getProfileBySlug("moquent").id).toBe(profile.id);

      const envelope = {
        schemaVersion: 1,
        collectedAt: "2026-08-30T11:59:00.000Z",
        snapshot,
      };
      const first = repository.saveSnapshot(profile.id, envelope);
      expect(first).toMatchObject({ changed: true, revision: 1 });

      current = new Date("2026-08-30T12:05:00.000Z");
      const heartbeat = repository.saveSnapshot(profile.id, {
        ...envelope,
        collectedAt: "2026-08-30T12:04:00.000Z",
      });
      expect(heartbeat.changed).toBe(false);
      expect(heartbeat.revision).toBe(1);
      expect(repository.getSnapshot(profile.id).collectedAt).toBe("2026-08-30T12:04:00.000Z");

      const changed = repository.saveSnapshot(profile.id, {
        ...envelope,
        collectedAt: "2026-08-30T12:05:00.000Z",
        snapshot: {
          ...snapshot,
          metrics: { ...snapshot.metrics, lifetimeTokens: 5_200_000_000 },
        },
      });
      expect(changed.revision).toBe(2);
      expect(repository.health().profiles).toBe(1);
    } finally {
      repository.close();
    }
  });

  it("deletes a profile and cascades to its snapshot", () => {
    const repository = new ProfileRepository();
    try {
      repository.createProfile({
        id: "b2168b83-27d6-46cf-a543-7086aa49fd53",
        slug: "moquent",
        providerId: "codex",
        card,
        publishTokenHash: "hashed-token",
      });
      repository.saveSnapshot("b2168b83-27d6-46cf-a543-7086aa49fd53", {
        schemaVersion: 1,
        collectedAt: "2026-08-30T12:00:00.000Z",
        snapshot,
      });
      expect(repository.deleteProfile("b2168b83-27d6-46cf-a543-7086aa49fd53")).toBe(true);
      expect(repository.getSnapshot("b2168b83-27d6-46cf-a543-7086aa49fd53")).toBeNull();
    } finally {
      repository.close();
    }
  });

  it("survives a process restart with migration history intact", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "ai-usage-repository-"));
    const filename = path.join(directory, "service.sqlite");
    try {
      const first = new ProfileRepository({ filename });
      first.createProfile({
        id: "b2168b83-27d6-46cf-a543-7086aa49fd53",
        slug: "moquent",
        providerId: "codex",
        card,
        publishTokenHash: "hashed-token",
      });
      first.saveSnapshot("b2168b83-27d6-46cf-a543-7086aa49fd53", {
        schemaVersion: 1,
        collectedAt: "2026-08-30T12:00:00.000Z",
        snapshot,
      });
      first.close();

      const reopened = new ProfileRepository({ filename });
      try {
        expect(reopened.getProfileBySlug("moquent").providerId).toBe("codex");
        expect(reopened.getSnapshot("b2168b83-27d6-46cf-a543-7086aa49fd53").revision).toBe(1);
        expect(reopened.database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count).toBe(2);
      } finally {
        reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("binds a GitHub account and preserves presentation on upsert", () => {
    const repository = new ProfileRepository();
    try {
      const created = repository.upsertGitHubProfile({
        id: "b2168b83-27d6-46cf-a543-7086aa49fd53",
        githubUserId: 1,
        login: "Moquent",
        providerId: "codex",
        card,
        publishTokenHash: "hashed-token",
      });
      expect(created.slug).toBe("moquent");
      expect(created.githubUserId).toBe(1);
      repository.updateProfile(created.id, { ...card, layout: "stats", username: "Moquent" });
      const again = repository.upsertGitHubProfile({
        id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        githubUserId: 1,
        login: "Moquent",
        providerId: "codex",
        card,
        publishTokenHash: "other-hash",
      });
      expect(again.id).toBe(created.id);
      expect(again.card.layout).toBe("stats");
    } finally {
      repository.close();
    }
  });

  it("returns null for missing profiles and update operations", () => {
    const repository = new ProfileRepository();
    try {
      expect(repository.getProfileById("00000000-0000-0000-0000-000000000000")).toBeNull();
      expect(repository.updateProfile("00000000-0000-0000-0000-000000000000", card)).toBeNull();
      expect(repository.updatePublishToken("00000000-0000-0000-0000-000000000000", "hash")).toBeNull();
      expect(() => repository.saveSnapshot("00000000-0000-0000-0000-000000000000", {
        schemaVersion: 1,
        collectedAt: "2026-08-30T12:00:00.000Z",
        snapshot,
      })).toThrow();
    } finally {
      repository.close();
    }
  });
});
