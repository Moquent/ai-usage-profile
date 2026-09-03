import { CARD, PALETTES, STAT_CATALOG, cardOptionsSchema, escapeXml, parseUsageSnapshot } from "@ai-usage-profile/shared";

export function formatCompact(value) {
  if (value === null || value === undefined) return "—";
  const units = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  for (const [divisor, suffix] of units) {
    if (value >= divisor) {
      const scaled = value / divisor;
      const digits = Number.isInteger(scaled) ? 0 : 1;
      return `${scaled.toFixed(digits).replace(/\.0$/, "")}${suffix}`;
    }
  }
  return String(value);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainder}s`;
  return `${remainder}s`;
}

function dateKey(date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date, days) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcWeek(date) {
  const start = new Date(`${dateKey(date)}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  return start;
}

function heatmapIntensity(tokens, maxTokens) {
  if (!tokens || maxTokens <= 0) return 0;
  const ratio = Math.log10(tokens + 1) / Math.log10(maxTokens + 1);
  return Math.max(1, Math.min(4, Math.ceil(ratio * 4)));
}

function renderHeatmap(buckets, generatedAt, palette, gridY, monthY) {
  const values = new Map(buckets.map((bucket) => [bucket.date, bucket.tokens]));
  const maxTokens = Math.max(0, ...values.values());
  const currentWeek = startOfUtcWeek(generatedAt);
  const firstWeek = addUtcDays(currentWeek, -(CARD.weekCount - 1) * 7);
  const cells = [];
  const monthLabels = [];
  let lastMonth = null;

  for (let week = 0; week < CARD.weekCount; week += 1) {
    const weekStart = addUtcDays(firstWeek, week * 7);
    const month = weekStart.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    if (month !== lastMonth && week > 0) {
      monthLabels.push(
        `<text x="${CARD.gridX + week * (CARD.cell + CARD.gap)}" y="${monthY}" class="month">${month}</text>`,
      );
    }
    lastMonth = month;

    for (let day = 0; day < 7; day += 1) {
      const date = addUtcDays(weekStart, day);
      const key = dateKey(date);
      const tokens = values.get(key) ?? 0;
      const level = date > generatedAt ? 0 : heatmapIntensity(tokens, maxTokens);
      cells.push(
        `<rect class="activity-cell" x="${CARD.gridX + week * (CARD.cell + CARD.gap)}" y="${gridY + day * (CARD.cell + CARD.gap)}" width="${CARD.cell}" height="${CARD.cell}" rx="2" fill="${palette.cells[level]}"><title>${key}: ${tokens.toLocaleString("en-US")} tokens</title></rect>`,
      );
    }
  }

  return `${monthLabels.join("\n    ")}\n    ${cells.join("\n    ")}`;
}

function initials(username) {
  return username.replace(/[^a-z0-9]/gi, "").slice(0, 2).toUpperCase() || "AI";
}

function formatStatValue(value, format) {
  if (value === null || value === undefined) return { value: "—", suffix: "" };
  if (format === "compact") return { value: formatCompact(value), suffix: "" };
  if (format === "duration") return { value: formatDuration(value), suffix: "" };
  if (format === "days") return { value: String(value), suffix: " days" };
  return { value: String(value), suffix: "" };
}

function selectStats(snapshot, statIds, labels) {
  const derived = {
    activeDays: snapshot.daily.filter((bucket) => bucket.tokens > 0).length,
    reportedDays: snapshot.daily.length,
  };
  return statIds.map((id) => {
    const definition = STAT_CATALOG[id];
    const rawValue = definition.field
      ? snapshot.metrics[definition.field]
      : derived[definition.derived];
    return {
      label: labels[id] ?? definition.label,
      ...formatStatValue(rawValue, definition.format),
    };
  });
}

function renderStats(snapshot, options, y, palette) {
  const width = 720;
  const stats = selectStats(snapshot, options.stats, options.statLabels);
  const columnWidth = width / stats.length;
  const separators = Array.from({ length: stats.length - 1 }, (_, index) => {
    const x = 20 + columnWidth * (index + 1);
    return `<path d="M${x} ${y + 13}v40" stroke="${palette.border}" />`;
  }).join("\n    ");
  const values = stats.map(({ value, suffix, label }, index) => {
    const x = 20 + columnWidth * index + columnWidth / 2;
    return `<text x="${x}" y="${y + 29}" class="stat" text-anchor="middle">${escapeXml(value)}${suffix}</text>
    <text x="${x}" y="${y + 50}" class="label" text-anchor="middle">${escapeXml(label)}</text>`;
  }).join("\n    ");

  return `<rect x="20" y="${y}" width="${width}" height="66" rx="10" fill="none" stroke="${palette.border}" />
    ${separators}
    ${values}`;
}

function renderIdentity(snapshot, options, y) {
  const username = options.username.toLowerCase();
  const accountLabel = snapshot.account.plan ?? snapshot.provider.name;
  return `<circle cx="48" cy="${y}" r="22" fill="#9B59B6" />
    <text x="48" y="${y + 7}" class="avatar" text-anchor="middle">${initials(username)}</text>
    <text x="82" y="${y - 3}" class="name">${escapeXml(username)}</text>
    <text x="82" y="${y + 17}" class="identity">@${escapeXml(username)} · ${escapeXml(accountLabel)}</text>`;
}

function renderGraphHeading(snapshot, y, updated) {
  return `<text x="26" y="${y}" class="section">${escapeXml(snapshot.provider.name)} token activity</text>
    <text x="734" y="${y}" class="meta" text-anchor="end">ACCOUNT-WIDE · DAILY · ${updated}</text>`;
}

function renderLegend(y, palette) {
  return `<text x="621" y="${y}" class="month">less</text>
    ${palette.cells.map((color, index) =>
      `<rect x="${647 + index * 13}" y="${y - 8}" width="9" height="9" rx="2" fill="${color}" />`,
    ).join("\n    ")}
    <text x="716" y="${y}" class="month">more</text>`;
}

function profileGeometry(showIdentity, statCount) {
  if (!showIdentity && statCount === 0) return { graphHeadingY: 31, height: 194 };
  if (showIdentity && statCount === 0) return { identityY: 39, graphHeadingY: 95, height: 252 };
  const statsY = showIdentity ? 76 : 20;
  const graphHeadingY = statsY + 105;
  return {
    identityY: showIdentity ? 39 : null,
    statsY,
    graphHeadingY,
    height: graphHeadingY + 157,
  };
}

function geometryFor(options) {
  if (options.layout === "graph") return { height: 194, graphHeadingY: 31 };
  if (options.layout === "stats") {
    return options.showIdentity
      ? { height: 146, identityY: 35, statsY: 66 }
      : { height: 94, identityY: null, statsY: 14 };
  }
  const profile = profileGeometry(options.showIdentity, options.stats.length);
  return options.layout === "full" ? { ...profile, height: profile.height + 76 } : profile;
}

function renderGraph(snapshot, options, palette, headingY) {
  const gridY = headingY + 21;
  const monthY = gridY + 113;
  const legendY = monthY + 15;
  const updated = options.generatedAt.toISOString().slice(0, 10);
  return `${renderGraphHeading(snapshot, headingY, updated)}
    ${renderHeatmap(snapshot.daily, options.generatedAt, palette, gridY, monthY)}
    ${renderLegend(legendY, palette)}`;
}

function renderBody(snapshot, options, palette, geometry) {
  if (options.layout === "graph") {
    return renderGraph(snapshot, options, palette, geometry.graphHeadingY);
  }
  if (options.layout === "stats") {
    return `${options.showIdentity ? renderIdentity(snapshot, options, geometry.identityY) : ""}
    ${renderStats(snapshot, options, geometry.statsY, palette)}`;
  }

  const profile = `${options.showIdentity ? renderIdentity(snapshot, options, geometry.identityY) : ""}
    ${options.stats.length > 0 ? renderStats(snapshot, options, geometry.statsY, palette) : ""}
    ${renderGraph(snapshot, options, palette, geometry.graphHeadingY)}`;
  if (options.layout === "profile") return profile;

  const profileHeight = geometry.height - 76;
  const provenance = [
    ["Scope", "Account-wide"],
    ["Provider", snapshot.provider.name],
    ["Source", snapshot.provider.source],
    ["Days reported", snapshot.daily.length],
  ];
  const rows = provenance.map(([label, value], index) => {
    const x = 26 + index * 182;
    return `<text x="${x}" y="${profileHeight + 50}" class="footer">${escapeXml(label)}</text>
    <text x="${x}" y="${profileHeight + 67}" class="footer-value">${escapeXml(value)}</text>`;
  }).join("\n    ");
  return `${profile}
    <path d="M26 ${profileHeight + 19}h708" stroke="${palette.border}" />
    ${rows}`;
}

function layoutDescription(snapshot, layout) {
  const provider = snapshot.provider.name;
  if (layout === "graph") return `One year of daily account-wide ${provider} token activity.`;
  if (layout === "stats") return `Selected account-wide ${provider} usage statistics.`;
  if (layout === "profile") {
    return `Compact ${provider} profile, selected statistics, and daily token activity.`;
  }
  return `${provider} profile, statistics, daily token activity, and data provenance.`;
}

export function renderCard({ snapshot: inputSnapshot, ...inputOptions }) {
  const snapshot = parseUsageSnapshot(inputSnapshot);
  const options = cardOptionsSchema.parse({ generatedAt: new Date(), ...inputOptions });
  const palette = PALETTES[options.theme];
  const geometry = geometryFor(options);
  const body = renderBody(snapshot, options, palette, geometry);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${geometry.height}" viewBox="0 0 ${CARD.width} ${geometry.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(options.username)} account-wide ${escapeXml(snapshot.provider.name)} activity</title>
  <desc id="desc">${escapeXml(layoutDescription(snapshot, options.layout))}</desc>
  <style>
    text { font-family: ${CARD.font}; }
    .name { fill: ${palette.primary}; font-size: 17px; font-weight: 650; letter-spacing: .5px; }
    .identity { fill: ${palette.secondary}; font-size: 11px; }
    .avatar { fill: #FFFFFF; font-size: 15px; font-weight: 600; }
    .stat { fill: ${palette.primary}; font-size: 14px; font-weight: 650; }
    .label { fill: ${palette.secondary}; font-size: 10px; }
    .section { fill: ${palette.primary}; font-size: 14px; font-weight: 650; }
    .meta { fill: ${palette.muted}; font-size: 9px; letter-spacing: .4px; }
    .month { fill: ${palette.secondary}; font-size: 9px; }
    .footer { fill: ${palette.secondary}; font-size: 9px; }
    .footer-value { fill: ${palette.primary}; font-size: 11px; }
  </style>
  <rect x="1" y="1" width="${CARD.width - 2}" height="${geometry.height - 2}" rx="12" fill="${palette.background}" stroke="${palette.border}" />
  ${body}
</svg>`;
}
