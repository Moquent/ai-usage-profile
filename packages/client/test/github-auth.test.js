import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  GITHUB_OAUTH_CLIENT_TYPE,
  GITHUB_OAUTH_SCOPES,
  loginWithDeviceFlow,
  readGitHubCredentials,
  resolveGitHubCredentials,
  resolveGitHubToken,
  writeGitHubCredentials,
} from "../src/local/setup.js";
import { schedulePaths, resolveStateDir } from "../src/local/schedule.js";

describe("GitHub authentication", () => {
  it("uses the OAuth App client with no extra scopes during device login", async () => {
    const seen = [];
    const token = await loginWithDeviceFlow({
      clientId: "oauth-client-id",
      onVerification: (verification) => seen.push(verification),
      createAuth: (options) => {
        expect(options.clientType).toBe(GITHUB_OAUTH_CLIENT_TYPE);
        expect(options.scopes).toEqual([]);
        expect(GITHUB_OAUTH_SCOPES).toHaveLength(0);
        return async ({ type, refresh }) => {
          expect(type).toBe("oauth");
          expect(refresh).toBe(true);
          await options.onVerification({
            user_code: "WDJB-MJHT",
            verification_uri: "https://github.com/login/device",
          });
          return { token: "gho_device_token" };
        };
      },
    });
    expect(token).toBe("gho_device_token");
    expect(seen[0].user_code).toBe("WDJB-MJHT");
  });

  it("falls back to the built-in OAuth client id", async () => {
    const token = await loginWithDeviceFlow({
      createAuth: (options) => {
        expect(options.clientId).toBe("Ov23li8itwuDv2LS0tI0");
        return async () => ({ token: "gho_device_token" });
      },
    });
    expect(token).toBe("gho_device_token");
  });

  it("prefers an explicit client id over the built-in default", async () => {
    await loginWithDeviceFlow({
      clientId: "custom-client-id",
      createAuth: (options) => {
        expect(options.clientId).toBe("custom-client-id");
        return async () => ({ token: "gho_device_token" });
      },
    });
  });

  it("accepts a bearer token from the environment", async () => {
    const credentials = await resolveGitHubCredentials({
      env: { GITHUB_TOKEN: "gho_env_token" },
      fetch: async (url, init) => {
        expect(String(url)).toBe("https://api.github.com/user");
        expect(init.headers.get("Authorization")).toBe("Bearer gho_env_token");
        return Response.json({ id: 42, login: "Moquent" });
      },
    });
    expect(credentials).toMatchObject({
      username: "Moquent",
      githubUserId: 42,
      source: "env",
      githubToken: "gho_env_token",
    });
  });

  it("reads stored credentials when the file token is still valid", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-auth-"));
    const stateDir = resolveStateDir(home);
    await mkdir(stateDir, { recursive: true });
    await writeGitHubCredentials(stateDir, {
      githubToken: "gho_file_token",
      username: "Moquent",
      githubUserId: 42,
      source: "file",
    });

    const credentials = await resolveGitHubCredentials({
      stateDir,
      env: {},
      fetch: async () => Response.json({ id: 42, login: "Moquent" }),
    });
    expect(credentials.source).toBe("file");
    expect(credentials.githubToken).toBe("gho_file_token");
  });

  it("returns null from resolveGitHubToken when no credentials are available", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-auth-"));
    const stateDir = resolveStateDir(home);
    await expect(resolveGitHubToken({ env: {}, stateDir })).resolves.toBeNull();
  });

  it("ignores invalid stored credentials and falls back to device login", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-auth-"));
    const stateDir = resolveStateDir(home);
    await mkdir(stateDir, { recursive: true });
    await writeFile(schedulePaths(stateDir).credentialsPath, JSON.stringify({ githubToken: "gho_stale" }), "utf8");

    const credentials = await resolveGitHubCredentials({
      stateDir,
      env: { AI_USAGE_GITHUB_CLIENT_ID: "oauth-client-id" },
      fetch: async (_url, init) => {
        if (init.headers.get("Authorization") === "Bearer gho_stale") {
          return new Response("nope", { status: 401 });
        }
        return Response.json({ id: 1, login: "Moquent" });
      },
      createAuth: () => async () => ({ token: "gho_device_token" }),
      onVerification: () => {},
    });
    expect(credentials.source).toBe("device");
    expect(credentials.githubToken).toBe("gho_device_token");
  });

  it("returns null for missing credential files", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ai-usage-auth-"));
    await expect(readGitHubCredentials(resolveStateDir(home))).resolves.toBeNull();
  });
});
