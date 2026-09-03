import { z } from "zod";

export const CARD = Object.freeze({
  width: 760,
  weekCount: 53,
  cell: 10,
  gap: 3,
  gridX: 26,
  font: "ui-monospace,SFMono-Regular,Menlo,Consolas,Liberation Mono,monospace",
});

export const LAYOUTS = Object.freeze({
  graph: { defaultHeight: 194 },
  stats: { defaultHeight: 146 },
  profile: { defaultHeight: 340 },
});

const LAYOUT_IDS = Object.freeze(Object.keys(LAYOUTS));

export const layoutSchema = z.enum(LAYOUT_IDS);

export function normalizeLayout(layout) {
  return layout === "full" ? "profile" : layout;
}

const layoutQuerySchema = z.union([layoutSchema, z.literal("full")]);

export const DEFAULT_STATS = Object.freeze([
  "lifetime",
  "peak",
  "longest-chat",
  "current-streak",
  "longest-streak",
]);

/** Full profile README card — six stats (schema max). */
export const DEFAULT_PROFILE_STATS = Object.freeze([
  ...DEFAULT_STATS,
  "active-days",
]);

export const STAT_CATALOG = Object.freeze({
  lifetime: { label: "Lifetime tokens", field: "lifetimeTokens", format: "compact" },
  peak: { label: "Peak day", field: "peakDailyTokens", format: "compact" },
  "longest-chat": { label: "Longest session", field: "longestRunningTurnSec", format: "duration" },
  "current-streak": { label: "Current streak", field: "currentStreakDays", format: "days" },
  "longest-streak": { label: "Longest streak", field: "longestStreakDays", format: "days" },
  "active-days": { label: "Active days", derived: "activeDays", format: "days" },
  "reported-days": { label: "Days tracked", derived: "reportedDays", format: "days" },
});

export const PALETTES = Object.freeze({
  dark: {
    background: "#0D1117",
    border: "#30363D",
    surface: "#161B22",
    accent: "#0077B6",
    primary: "#F0F6FC",
    secondary: "#8B949E",
    cells: ["#161B22", "#0B3B60", "#0077B6", "#00B4D8", "#90E0EF"],
  },
  light: {
    background: "#FFFFFF",
    border: "#D0D7DE",
    surface: "#F6F8FA",
    accent: "#0077B6",
    primary: "#1F2328",
    secondary: "#57606A",
    cells: ["#EBEDF0", "#CAF0F8", "#90E0EF", "#00B4D8", "#0077B6"],
  },
});

export const PROVIDER_CATALOG = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    name: "Codex",
    source: "OpenAI Codex App Server",
  }),
});

export const DEFAULT_PUBLIC_ORIGIN = "https://aiusage.teje.sh";

/** Public OAuth App client id for GitHub device login (not a secret). */
export const DEFAULT_GITHUB_OAUTH_CLIENT_ID = "Ov23li8itwuDv2LS0tI0";

export function listProviders() {
  return Object.keys(PROVIDER_CATALOG);
}

export function getProviderMetadata(id) {
  const metadata = PROVIDER_CATALOG[id];
  if (!metadata) {
    throw new Error(`Unknown provider "${id}". Available providers: ${listProviders().join(", ")}`);
  }
  return metadata;
}

export function resolvePublicOrigin(explicit, env = process.env) {
  return explicit ?? env.AI_USAGE_ENDPOINT ?? DEFAULT_PUBLIC_ORIGIN;
}

export function publicCardUrl(origin, slug) {
  return new URL(`/u/${String(slug).toLowerCase()}/card.svg`, origin).toString();
}

export function buildCardSvgQuery({
  theme = "dark",
  layout = "profile",
  stats = DEFAULT_PROFILE_STATS,
  identity = "show",
} = {}) {
  const params = new URLSearchParams();
  params.set("theme", theme);
  if (layout) params.set("layout", layout);
  if (identity) params.set("identity", identity);
  if (stats?.length) params.set("stats", stats.join(","));
  return params.toString();
}

export function buildCardSvgUrl(origin, slug, options = {}) {
  return `${publicCardUrl(origin, slug)}?${buildCardSvgQuery(options)}`;
}

function escapeHtmlAttribute(value) {
  return String(value).replaceAll("&", "&amp;");
}

export function readmeCardSnippet(origin, slug, { alt = "Account-wide AI usage", ...options } = {}) {
  const dark = buildCardSvgUrl(origin, slug, { theme: "dark", ...options });
  const light = buildCardSvgUrl(origin, slug, { theme: "light", ...options });
  return `<picture>
  <source media="(prefers-color-scheme: dark)" srcset="${escapeHtmlAttribute(dark)}">
  <source media="(prefers-color-scheme: light)" srcset="${escapeHtmlAttribute(light)}">
  <img width="100%" src="${escapeHtmlAttribute(dark)}" alt="${escapeXml(alt)}">
</picture>`;
}

export function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const nullableMetric = z.number().safe().nonnegative().nullable().default(null);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const providerIdPattern = /^[a-z0-9][a-z0-9-]{0,31}$/;
const usernamePattern = /^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/;

const usageBucketSchema = z.object({
  date: z.string().regex(datePattern, "must use YYYY-MM-DD"),
  tokens: z.number().safe().nonnegative(),
});

export const usageSnapshotSchema = z
  .object({
    provider: z.object({
      id: z.string().trim().regex(providerIdPattern),
      name: z.string().trim().min(1).max(48),
      source: z.string().trim().min(1).max(120),
    }),
    account: z.object({
      plan: z.string().trim().min(1).max(48).nullable().default(null),
    }).default({ plan: null }),
    metrics: z.object({
      lifetimeTokens: nullableMetric,
      peakDailyTokens: nullableMetric,
      longestRunningTurnSec: nullableMetric,
      currentStreakDays: nullableMetric,
      longestStreakDays: nullableMetric,
    }),
    daily: z.array(usageBucketSchema).max(400).default([]),
  })
  .superRefine((snapshot, context) => {
    const seen = new Set();
    for (const [index, bucket] of snapshot.daily.entries()) {
      if (seen.has(bucket.date)) {
        context.addIssue({
          code: "custom",
          path: ["daily", index, "date"],
          message: `duplicate daily bucket for ${bucket.date}`,
        });
      }
      seen.add(bucket.date);
    }
  })
  .transform((snapshot) => ({
    ...snapshot,
    daily: [...snapshot.daily].sort((left, right) => left.date.localeCompare(right.date)),
  }));

export const statIdSchema = z.enum(Object.keys(STAT_CATALOG));
export const labelsSchema = z.partialRecord(statIdSchema, z.string().trim().min(1).max(28));
export const statsSchema = z.array(statIdSchema).max(6).superRefine((stats, context) => {
  if (new Set(stats).size !== stats.length) {
    context.addIssue({ code: "custom", message: "must not contain duplicates" });
  }
});
export const githubUsernameSchema = z.string().trim().regex(usernamePattern, "must be a GitHub username");
export const githubSlugSchema = z.string().trim().toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/, "must be a GitHub-compatible slug");

const cardPresentationDefaults = {
  layout: layoutSchema.default("profile"),
  stats: statsSchema.default([...DEFAULT_PROFILE_STATS]),
  labels: labelsSchema.default({}),
  identity: z.boolean().default(true),
};

function refineStatsLayout(schema) {
  return schema.superRefine((config, context) => {
    if (config.layout === "stats" && config.stats.length === 0) {
      context.addIssue({ code: "custom", path: ["stats"], message: "requires at least one stat" });
    }
  });
}

export const presentationConfigSchema = refineStatsLayout(z.object({
  username: githubUsernameSchema,
  ...cardPresentationDefaults,
}));

export const cardOptionsSchema = refineStatsLayout(z.object({
  username: z.string().trim().min(1).max(80),
  theme: z.enum(Object.keys(PALETTES)).default("dark"),
  ...cardPresentationDefaults,
  statLabels: labelsSchema.default({}),
  showIdentity: z.boolean().default(true),
  generatedAt: z.date().refine((date) => !Number.isNaN(date.valueOf()), "must be valid"),
}));

const cardQuerySchema = z.object({
  theme: z.enum(Object.keys(PALETTES)).default("dark"),
  layout: layoutQuerySchema.optional(),
  stats: z.string().optional(),
  identity: z.enum(["show", "hide"]).optional(),
});

export const publishEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  collectedAt: z.iso.datetime({ offset: true }),
  snapshot: usageSnapshotSchema,
});

export const presentationCardFieldsSchema = z.object({
  username: z.string().optional(),
  layout: layoutQuerySchema.optional(),
  stats: statsSchema.optional(),
  labels: labelsSchema.optional(),
  identity: z.boolean().optional(),
}).strict();

export const profileIdParamsSchema = z.object({ id: z.uuid() });
export const profileSlugParamsSchema = z.object({ slug: githubSlugSchema });

export const createProfileBodySchema = z.object({
  slug: githubSlugSchema,
  providerId: z.enum(listProviders()).default("codex"),
  card: presentationCardFieldsSchema.optional(),
}).strict();

export const updateProfileBodySchema = z.object({
  card: presentationCardFieldsSchema,
}).strict();

export const publishBodySchema = publishEnvelopeSchema;

export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  requestId: z.string(),
});

export const profileResponseSchema = z.object({
  id: z.uuid(),
  slug: githubSlugSchema,
  providerId: z.string(),
  cardUrl: z.url(),
  card: presentationConfigSchema,
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});

export const createProfileResponseSchema = profileResponseSchema.extend({
  publishToken: z.string(),
});

export const publishResponseSchema = z.object({
  status: z.enum(["updated", "unchanged"]),
  revision: z.number().int().positive(),
  receivedAt: z.iso.datetime({ offset: true }),
  cardUrl: z.url(),
});

export function parseUsageSnapshot(input) {
  return usageSnapshotSchema.parse(input);
}

export function formatValidationError(error) {
  return error instanceof z.ZodError ? z.prettifyError(error) : error.message;
}

export function parseStatsParam(value) {
  if (value === undefined) return undefined;
  if (value === "none") return [];
  return value.split(",").map((id) => id.trim());
}

export function parseLabelsParam(value) {
  if (value === undefined) return undefined;
  const labels = {};
  for (const assignment of value.split(",")) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) throw new Error("labels must use ID=Custom label entries");
    const id = assignment.slice(0, separator).trim();
    if (Object.hasOwn(labels, id)) throw new Error(`Duplicate label override: ${id}`);
    labels[id] = assignment.slice(separator + 1).trim();
  }
  return labelsSchema.parse(labels);
}

export function presentationOverridesFromCli(options) {
  return Object.fromEntries(
    Object.entries({
      username: options.username,
      layout: options.layout,
      stats: options.stats === undefined ? undefined : parseStatsParam(options.stats),
      labels: options.labels === undefined ? undefined : parseLabelsParam(options.labels),
      identity: options.identity,
    }).filter(([, value]) => value !== undefined),
  );
}

export function presentationCard(username, overrides = {}) {
  const parsed = presentationCardFieldsSchema.parse({
    ...overrides,
    username: overrides.username ?? username,
  });
  return presentationConfigSchema.parse({
    ...parsed,
    ...(parsed.layout === undefined ? {} : { layout: normalizeLayout(parsed.layout) }),
  });
}

export function publishedCardPresentation(username, overrides = {}) {
  return presentationCard(username, {
    layout: "profile",
    identity: true,
    stats: [...DEFAULT_PROFILE_STATS],
    ...overrides,
  });
}

export function presentationCardFromCli(options, slug) {
  return presentationCard(slug, presentationOverridesFromCli(options));
}

export function toCardOptions(presentation, { theme = "dark", generatedAt = new Date() } = {}) {
  return {
    username: presentation.username,
    theme,
    layout: presentation.layout,
    stats: presentation.stats,
    statLabels: presentation.labels,
    showIdentity: presentation.identity,
    generatedAt,
  };
}

export function cardOptionsFromQuery(searchParams, presentation, generatedAt = new Date()) {
  const query = cardQuerySchema.parse(Object.fromEntries(searchParams));
  return cardOptionsSchema.parse({
    ...toCardOptions(presentation, { theme: query.theme, generatedAt }),
    ...(query.layout === undefined ? {} : { layout: normalizeLayout(query.layout) }),
    ...(query.stats === undefined ? {} : { stats: parseStatsParam(query.stats) }),
    ...(query.identity === undefined ? {} : { showIdentity: query.identity === "show" }),
  });
}
