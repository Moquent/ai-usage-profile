import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { renderCard } from "../packages/server/src/render/card.js";
import { DEFAULT_PROFILE_STATS } from "../packages/shared/src/schema.js";
import { loadUsageSnapshot } from "../packages/test-support/helpers.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const generatedAt = new Date("2026-08-27T12:00:00.000Z");
const snapshot = await loadUsageSnapshot();

const examples = [
  {
    file: "graph-dark.svg",
    layout: "graph",
    showIdentity: false,
    stats: [],
  },
  {
    file: "stats-dark.svg",
    layout: "stats",
    stats: DEFAULT_PROFILE_STATS,
  },
  {
    file: "profile-dark.svg",
    layout: "profile",
    stats: DEFAULT_PROFILE_STATS,
  },
];

for (const example of examples) {
  const svg = renderCard({
    snapshot,
    username: "Moquent",
    theme: "dark",
    layout: example.layout,
    stats: example.stats,
    showIdentity: example.showIdentity ?? true,
    generatedAt,
  });
  await writeFile(`${root}/assets/examples/${example.file}`, svg);
}

console.log(`Generated ${examples.length} example cards in assets/examples/`);
