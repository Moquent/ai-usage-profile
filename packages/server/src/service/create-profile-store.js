import { ProfileRepository } from "./profile-repository.js";
import { PostgresProfileRepository } from "./postgres-profile-repository.js";

function wrapSyncRepository(repository) {
  return {
    createProfile: async (input) => repository.createProfile(input),
    getProfileById: async (id) => repository.getProfileById(id),
    getProfileBySlug: async (slug) => repository.getProfileBySlug(slug),
    getProfileByGithubUserId: async (id) => repository.getProfileByGithubUserId(id),
    upsertGitHubProfile: async (input) => repository.upsertGitHubProfile(input),
    updateProfile: async (id, card) => repository.updateProfile(id, card),
    updatePublishToken: async (id, hash) => repository.updatePublishToken(id, hash),
    deleteProfile: async (id) => repository.deleteProfile(id),
    getSnapshot: async (profileId) => repository.getSnapshot(profileId),
    saveSnapshot: async (profileId, envelope) => repository.saveSnapshot(profileId, envelope),
    health: async () => repository.health(),
    close: async () => repository.close(),
  };
}

export async function createProfileStore({
  databaseUrl,
  databasePath,
  now = () => new Date(),
} = {}) {
  if (databaseUrl) {
    const repository = new PostgresProfileRepository({ connectionString: databaseUrl, now });
    await repository.init();
    return repository;
  }
  return wrapSyncRepository(new ProfileRepository({ filename: databasePath, now }));
}
