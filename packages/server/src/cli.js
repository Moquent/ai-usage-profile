import { Command, InvalidArgumentError, Option } from "commander";
import { z } from "zod";
import packageJson from "../package.json" with { type: "json" };
import {
  adminClientOptionsSchema,
  createApiClient,
  createProfileResponseSchema,
  LAYOUTS,
  listProviders,
  presentationCardFromCli,
} from "@ai-usage-profile/shared";
import { loadServiceConfig, startHostedService } from "./service/hosted-service.js";

function identity(value) {
  if (value === "show") return true;
  if (value === "hide") return false;
  throw new InvalidArgumentError("must be show or hide");
}

function requireEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Required environment variable ${name} is not set`);
  return value;
}

function adminClient(options) {
  const config = adminClientOptionsSchema.parse({
    endpoint: options.endpoint ?? requireEnvironment("AI_USAGE_ENDPOINT"),
    adminKey: requireEnvironment(options.adminKeyEnv),
  });
  return createApiClient({
    baseUrl: config.endpoint,
    token: config.adminKey,
    userAgent: "ai-usage-profile-admin/1",
  });
}

export function createProgram() {
  const program = new Command()
    .name("ai-usage-service")
    .description("Hosted AI usage profile origin")
    .version(packageJson.version);

  program.command("service")
    .description("Run the origin API")
    .action(async () => {
      const app = await startHostedService({ config: loadServiceConfig() });
      const address = app.server.address();
      process.stdout.write(`AI Usage Profile service listening on ${address.address}:${address.port}\n`);
    });

  const profile = program.command("profile", { hidden: true }).description("Operator profile provisioning");
  addProfileCardOptions(
    profile.command("create")
      .description("Create a hosted profile and issue a publishing token")
      .requiredOption("--slug <slug>", "public profile slug"),
  )
    .option("--endpoint <url>", "origin (or AI_USAGE_ENDPOINT)")
    .option("--admin-key-env <name>", "environment variable containing the admin key", "AI_USAGE_ADMIN_KEY")
    .action(async (options) => {
      const created = await adminClient(options).request("POST", "/v1/profiles", {
        body: {
          slug: options.slug,
          providerId: options.provider,
          card: presentationCardFromCli(options, options.slug),
        },
        schema: createProfileResponseSchema,
      });
      process.stdout.write(`${JSON.stringify(created, null, 2)}\n`);
    });

  profile.command("rotate-token")
    .description("Rotate and revoke a profile publishing token")
    .requiredOption("--id <uuid>", "hosted profile ID")
    .option("--endpoint <url>", "origin (or AI_USAGE_ENDPOINT)")
    .option("--admin-key-env <name>", "environment variable containing the admin key", "AI_USAGE_ADMIN_KEY")
    .action(async (options) => {
      const response = await adminClient(options).request(
        "POST",
        `/v1/profiles/${z.uuid().parse(options.id)}/token`,
      );
      process.stdout.write(`${JSON.stringify(z.object({ publishToken: z.string() }).parse(response), null, 2)}\n`);
    });

  return program;
}

function addProfileCardOptions(command) {
  return command
    .option("-p, --provider <id>", `usage provider (available: ${listProviders().join(", ")})`)
    .option("-u, --username <name>", "GitHub username")
    .addOption(new Option("-l, --layout <preset>", "card layout").choices(Object.keys(LAYOUTS)))
    .option("--stats <ids>", "ordered comma-separated stat IDs, or none")
    .option("--labels <entries>", "comma-separated ID=Custom label entries")
    .option("--identity <mode>", "show or hide profile identity", identity);
}

export async function runCli(argv = process.argv) {
  await createProgram().parseAsync(argv);
}
