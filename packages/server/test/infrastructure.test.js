import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";

async function fixture(relativePath) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

describe("server infrastructure", () => {
  it("runs unprivileged with durable storage and readiness checks", async () => {
    const dockerfile = await fixture("Dockerfile");
    const compose = parseYaml(await fixture("compose.yaml"));
    expect(dockerfile).toMatch(/USER node/);
    expect(dockerfile).toMatch(/HEALTHCHECK/);
    expect(dockerfile).toMatch(/VOLUME \["\/data"\]/);
    expect(dockerfile).toMatch(/ai-usage-service\.js", "service"/);
    expect(compose.services["ai-usage-profile"].read_only).toBe(true);
    expect(compose.services["ai-usage-profile"].security_opt).toContain("no-new-privileges:true");
  });
});
