// scripts/generate-commits-card.mjs
//
// Genera una tarjeta SVG con los commits recientes agrupados por repositorio,
// mas un bloque extra abajo con el repo con mas Pull Requests de este mes.
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

// Dos alias sobre contributionsCollection en el mismo query:
//  - allTime: para los commits por repo (igual que antes)
//  - thisMonth: acotado con from/to al mes actual, para los Pull Requests
const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      allTime: contributionsCollection {
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
      thisMonth: contributionsCollection(from: $from, to: $to) {
        pullRequestContributionsByRepository(maxRepositories: 10) {
          repository {
            name
            isPrivate
          }
          contributions {
            totalCount
          }
        }
      }
    }
  }
`;

function monthRange() {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return { from: from.toISOString(), to: now.toISOString() };
}

async function main() {
  const { from, to } = monthRange();

  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables: { login: username, from, to } }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();

  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  const repos = json?.data?.user?.allTime?.commitContributionsByRepository;
  const prRepos = json?.data?.user?.thisMonth?.pullRequestContributionsByRepository ?? [];

  if (!repos) {
    throw new Error("Could not read commit contributions. Check the token/username.");
  }

  // Ordena por cantidad de commits, de mayor (arriba) a menor (abajo) -- automatico
  const sorted = [...repos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount);

  // Repo con mas PRs este mes (si hay alguno)
  const topPR = [...prRepos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount)[0] || null;

  // Diagnostico temporal: muestra en el log lo que realmente devuelve la API
  console.log("--- DEBUG: raw repository data ---");
  sorted.forEach((entry) => {
    console.log(`${entry.repository.name} | isPrivate: ${entry.repository.isPrivate} | commits: ${entry.contributions.totalCount} | url: ${entry.repository.url}`);
  });
  if (topPR) {
    console.log(`--- DEBUG: top PR repo this month --- ${topPR.repository.name} | isPrivate: ${topPR.repository.isPrivate} | PRs: ${topPR.contributions.totalCount}`);
  }
  console.log("-----------------------------------");

  const rowHeight = 30;
  const paddingTop = 16;
  const paddingBottom = 16;
  const paddingX = 20;

  // --- Layout de la barra ---
  const barMaxWidth = 180;
  const countGap = 10;
  const countColumnWidth = 34;
  const barEndX = paddingX + barMaxWidth;
  const countX = barEndX + countGap;
  const width = countX + countColumnWidth;

  // --- Layout del bloque extra (PRs del mes) ---
  // Solo se agrega si hay datos; queda debajo de las filas de commits, en
  // tono mas apagado para no competir visualmente con las barras.
  const extraSectionGap = 18; // separacion entre la ultima fila y el bloque extra
  const extraSectionHeight = topPR ? 58 : 0;

  const rowsHeight = sorted.length * rowHeight;
  const height = paddingTop + rowsHeight + (topPR ? extraSectionGap + extraSectionHeight : 0) + paddingBottom;
  const maxCommits = Math.max(...sorted.map((r) => r.contributions.totalCount), 1);

  const RANK_COLORS = ["#e3b341", "#b0b7bd", "#cd7f32"];
  const GITHUB_GREEN = "#39d353";
  const PRIVATE_GRAY = "#484f58";

  function barColor(isPrivate) {
    return isPrivate ? PRIVATE_GRAY : GITHUB_GREEN;
  }

  function nameColor(isPrivate, rank) {
    if (isPrivate) return null;
    if (rank < RANK_COLORS.length) return RANK_COLORS[rank];
    return null;
  }

  // --- Timing ---
  // wave: (53-1)*0.065 + 6*0.036 + 0.55 ≈ 4.15s -- ver generate-wave-graph.mjs
  const WAVE_COMPLETION_TIME = 4.15;

  const growDuration = 1.8;
  const staggerBudget = Math.max(WAVE_COMPLETION_TIME - growDuration, 0);
  const delayStep = sorted.length > 1 ? staggerBudget / (sorted.length - 1) : 0;

  // El bloque extra aparece justo despues de que termina de llenarse la
  // ultima barra (delay de la ultima fila + su duracion de llenado).
  const lastRowFlashDelay = (sorted.length - 1) * delayStep + growDuration;
  const extraDelay = (lastRowFlashDelay + 0.25).toFixed(3);

  let rows = "";
  sorted.forEach((entry, i) => {
    const y = paddingTop + i * rowHeight;
    const isPrivate = entry.repository.isPrivate;
    const label = isPrivate ? "Private repository" : entry.repository.name;
    const count = entry.contributions.totalCount;
    const barWidth = Math.max(4, (count / maxCommits) * barMaxWidth);
    const delay = (i * delayStep).toFixed(3);
    const flashDelay = (i * delayStep + growDuration).toFixed(3);
    const color = barColor(isPrivate);
    const nameHex = nameColor(isPrivate, i);
    const nameStyle = nameHex ? ` style="fill:${nameHex}"` : "";

    rows += `
      <g class="row" style="animation-delay:${delay}s">
        <text class="repo${isPrivate ? " private" : ""}"${nameStyle} x="${paddingX}" y="${y + 14}">${escapeXml(label)}</text>
        <rect class="bar-track" x="${paddingX}" y="${y + 20}" width="${barMaxWidth}" height="6" rx="3" />
        <rect class="bar" x="${paddingX}" y="${y + 20}" width="${barWidth}" height="6" rx="3" fill="${color}" style="animation-delay:${delay}s, ${flashDelay}s" />
        <text class="count" x="${countX}" y="${y + 24}" style="animation-delay:${flashDelay}s">${count}</text>
      </g>`;
  });

  let extraSection = "";
  if (topPR) {
    const isPrivate = topPR.repository.isPrivate;
    const prLabel = isPrivate ? "Private repository" : topPR.repository.name;
    const prCount = topPR.contributions.totalCount;
    const extraY = paddingTop + rowsHeight + extraSectionGap;

    extraSection = `
      <g class="extra" style="animation-delay:${extraDelay}s">
        <text class="extra-label" x="${paddingX}" y="${extraY + 12}">MOST PULL REQUESTS THIS MONTH</text>
        <text class="extra-repo${isPrivate ? " private" : ""}" x="${paddingX}" y="${extraY + 34}">${escapeXml(prLabel)}</text>
        <text class="extra-count" x="${width - paddingX}" y="${extraY + 34}" text-anchor="end">${prCount}</text>
      </g>`;
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<style>
  text.repo { fill:#c9d1d9; font-size:13px; font-weight:600; }
  text.repo.private { fill:#8b949e; font-style:italic; font-weight:500; }
  text.count { fill:#7d8590; font-size:12px; font-weight:600; opacity:0; animation: fadeInCount 0.4s ease-out both; }
  .bar-track { fill:#21262d; }
  .bar {
    transform-box:fill-box;
    transform-origin:left;
    transform:scaleX(0);
    animation:
      growBar ${growDuration}s cubic-bezier(0.22,0.61,0.36,1) both,
      flash 0.6s ease-out both;
  }
  @keyframes growBar { 0%{transform:scaleX(0);} 100%{transform:scaleX(1);} }
  @keyframes flash { 0%{filter:brightness(1);} 35%{filter:brightness(2.1) saturate(1.3);} 100%{filter:brightness(1);} }
  @keyframes fadeInCount { 0%{opacity:0; transform:translateX(-4px);} 100%{opacity:1; transform:translateX(0);} }
  .row { opacity:0; animation: fadeIn 0.5s ease-out both; }
  @keyframes fadeIn { 0%{opacity:0; transform:translateX(-6px);} 100%{opacity:1; transform:translateX(0);} }

  /* Bloque extra: PRs del mes -- tonos apagados, no compite con las barras */
  .extra { opacity:0; animation: fadeInExtra 0.6s ease-out both; }
  @keyframes fadeInExtra { 0%{opacity:0; transform:translateY(4px);} 100%{opacity:1; transform:translateY(0);} }
  text.extra-label { fill:#6e7681; font-size:10px; font-weight:700; letter-spacing:0.06em; }
  text.extra-repo { fill:#a8b1bb; font-size:13px; font-weight:600; }
  text.extra-repo.private { fill:#8b949e; font-style:italic; font-weight:500; }
  text.extra-count { fill:#c9d1d9; font-size:26px; font-weight:700; }

  @media (prefers-reduced-motion: reduce) { .row, .bar, .count, .extra { opacity:1 !important; transform:none !important; animation:none !important; } }
</style>
<rect width="${width}" height="${height}" fill="none"/>
${rows}
${extraSection}
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