import { CARD, PALETTES, STAT_CATALOG, cardOptionsSchema, escapeXml, normalizeLayout, parseUsageSnapshot } from "@ai-usage-profile/shared";

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
    return `<path d="M${x} ${y + 16}v42" stroke="${palette.border}" />`;
  }).join("\n    ");
  const values = stats.map(({ value, suffix, label }, index) => {
    const x = 20 + columnWidth * index + columnWidth / 2;
    return `<text x="${x}" y="${y + 34}" class="stat" text-anchor="middle">${escapeXml(value)}${suffix}</text>
    <text x="${x}" y="${y + 52}" class="label" text-anchor="middle">${escapeXml(label)}</text>`;
  }).join("\n    ");

  return `<rect x="20" y="${y}" width="${width}" height="68" rx="10" fill="${palette.surface}" stroke="${palette.border}" />
    ${separators}
    ${values}`;
}

function renderIdentity(snapshot, options, y, palette) {
  const handle = options.username.replace(/^@/, "").toLowerCase();
  const name = options.username.replace(/^@/, "");
  const plan = snapshot.account.plan;
  const subline = plan ? `@${escapeXml(handle)} · ${escapeXml(plan)}` : `@${escapeXml(handle)}`;
  return `<circle cx="48" cy="${y}" r="22" fill="${palette.accent}" />
    <text x="48" y="${y + 7}" class="avatar" text-anchor="middle">${initials(name)}</text>
    <text x="82" y="${y - 3}" class="name">${escapeXml(name)}</text>
    <text x="82" y="${y + 17}" class="identity">${subline}</text>`;
}

function renderGraphHeading(snapshot, y) {
  return `<text x="26" y="${y}" class="section">${escapeXml(snapshot.provider.name)} activity</text>`;
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
  const graphHeadingY = statsY + 107;
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
  return profileGeometry(options.showIdentity, options.stats.length);
}

function renderGraph(snapshot, options, palette, headingY) {
  const gridY = headingY + 21;
  const monthY = gridY + 113;
  const legendY = monthY + 15;
  return `${renderGraphHeading(snapshot, headingY)}
    ${renderHeatmap(snapshot.daily, options.generatedAt, palette, gridY, monthY)}
    ${renderLegend(legendY, palette)}`;
}

function renderBody(snapshot, options, palette, geometry) {
  if (options.layout === "graph") {
    return renderGraph(snapshot, options, palette, geometry.graphHeadingY);
  }
  if (options.layout === "stats") {
    return `${options.showIdentity ? renderIdentity(snapshot, options, geometry.identityY, palette) : ""}
    ${renderStats(snapshot, options, geometry.statsY, palette)}`;
  }

  return `${options.showIdentity ? renderIdentity(snapshot, options, geometry.identityY, palette) : ""}
    ${options.stats.length > 0 ? renderStats(snapshot, options, geometry.statsY, palette) : ""}
    ${renderGraph(snapshot, options, palette, geometry.graphHeadingY)}`;
}

function layoutDescription(snapshot, layout) {
  const provider = snapshot.provider.name;
  if (layout === "graph") return `One year of daily account-wide ${provider} token activity.`;
  if (layout === "stats") return `Selected account-wide ${provider} usage statistics.`;
  return `${provider} usage statistics and daily token activity.`;
}

export function renderCard({ snapshot: inputSnapshot, ...inputOptions }) {
  const snapshot = parseUsageSnapshot(inputSnapshot);
  const layout = inputOptions.layout === undefined
    ? inputOptions.layout
    : normalizeLayout(inputOptions.layout);
  const options = cardOptionsSchema.parse({ generatedAt: new Date(), ...inputOptions, layout });
  const palette = PALETTES[options.theme];
  const geometry = geometryFor(options);
  const body = renderBody(snapshot, options, palette, geometry);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${geometry.height}" viewBox="0 0 ${CARD.width} ${geometry.height}" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(options.username)} ${escapeXml(snapshot.provider.name)} usage</title>
  <desc id="desc">${escapeXml(layoutDescription(snapshot, options.layout))}</desc>
  <style>
    text { font-family: ${CARD.font}; }
    .name { fill: ${palette.primary}; font-size: 17px; font-weight: 650; letter-spacing: .3px; }
    .identity { fill: ${palette.secondary}; font-size: 11px; }
    .avatar { fill: #FFFFFF; font-size: 15px; font-weight: 600; }
    .stat { fill: ${palette.primary}; font-size: 15px; font-weight: 700; }
    .label { fill: ${palette.secondary}; font-size: 10px; }
    .section { fill: ${palette.primary}; font-size: 13px; font-weight: 650; }
    .month { fill: ${palette.secondary}; font-size: 9px; }
  </style>
  <rect x="1" y="1" width="${CARD.width - 2}" height="${geometry.height - 2}" rx="12" fill="${palette.background}" stroke="${palette.border}" />
  ${body}
</svg>`;
}
