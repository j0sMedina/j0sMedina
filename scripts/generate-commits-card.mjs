// scripts/generate-commits-card.mjs
//
// Genera una tarjeta SVG con los commits recientes agrupados por repositorio.
// Los repos privados se muestran como "Private repository" (sin revelar el nombre).
//
// IMPORTANTE: para ver actividad de repos privados, GITHUB_TOKEN necesita ser un
// Personal Access Token (classic) con scope "repo" -- el token automatico de
// Actions no tiene permiso para leer datos de tus otros repos privados.
//
// Uso: GITHUB_TOKEN=xxx GITHUB_USER=j0sMedina node scripts/generate-commits-card.mjs

const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USER;

if (!token || !username) {
  console.error("Missing GITHUB_TOKEN or GITHUB_USER environment variables.");
  process.exit(1);
}

const query = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        commitContributionsByRepository(maxRepositories: 15) {
          repository {
            name
            isPrivate
            url
          }
          contributions {
            totalCount
          }
        }
      }
    }
  }
`;

async function main() {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: username } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const repos = json?.data?.user?.contributionsCollection?.commitContributionsByRepository;

  if (!repos) {
    throw new Error("Could not read commit contributions. Check the token/username.");
  }

  const sorted = [...repos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount);

  console.log("--- DEBUG: raw repository data ---");
  sorted.forEach((entry) => {
    console.log(`${entry.repository.name} | isPrivate: ${entry.repository.isPrivate} | commits: ${entry.contributions.totalCount}`);
  });
  console.log("-----------------------------------");

  const rowHeight = 30;
  const paddingTop = 50;
  const paddingBottom = 16;
  const paddingX = 20;
  const width = 420;
  const height = paddingTop + sorted.length * rowHeight + paddingBottom;
  const maxCommits = Math.max(...sorted.map((r) => r.contributions.totalCount), 1);

  let rows = "";
  sorted.forEach((entry, i) => {
    const y = paddingTop + i * rowHeight;
    const isPrivate = entry.repository.isPrivate;
    const label = isPrivate ? "Private repository" : entry.repository.name;
    const count = entry.contributions.totalCount;
    const barMaxWidth = 180;
    const barWidth = Math.max(4, (count / maxCommits) * barMaxWidth);
    const delay = (i * 0.06).toFixed(3);

    rows += `
      <g class="row" style="animation-delay:${delay}s">
        <text class="repo${isPrivate ? " private" : ""}" x="${paddingX}" y="${y + 14}">${escapeXml(label)}</text>
        <rect class="bar" x="${paddingX}" y="${y + 20}" width="${barWidth}" height="6" rx="3" fill="${isPrivate ? "#484f58" : "#39d353"}" />
        <text class="count" x="${width - paddingX}" y="${y + 14}" text-anchor="end">${count}</text>
      </g>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<style>
  text.title { fill:#e6edf3; font-size:16px; font-weight:700; }
  text.repo { fill:#c9d1d9; font-size:13px; font-weight:600; }
  text.repo.private { fill:#8b949e; font-style:italic; font-weight:500; }
  text.count { fill:#7d8590; font-size:12px; font-weight:600; }
  .row { opacity:0; animation: fadeIn 0.5s ease-out both; }
  @keyframes fadeIn { 0%{opacity:0; transform:translateX(-6px);} 100%{opacity:1; transform:translateX(0);} }
  @media (prefers-reduced-motion: reduce) { .row { opacity:1 !important; animation:none !important; } }
</style>
<rect width="${width}" height="${height}" fill="none"/>
<text class="title" x="${paddingX}" y="28">Recent Commit Activity</text>
${rows}
</svg>`;

  const fs = await import("node:fs");
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/commits-card.svg", svg);
  console.log(`SVG generated at dist/commits-card.svg (${sorted.length} repositories)`);
}

function escapeXml(str) {
  return str.replace(/[<>&'"]/g, (c) => ({
    "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
  })[c]);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});