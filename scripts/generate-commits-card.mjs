// scripts/generate-commits-card.mjs
//
// Genera una tarjeta SVG con los commits recientes agrupados por repositorio,
// mas paneles laterales con estadisticas extra del mes (PRs, lineas cambiadas).
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
//  - thisMonth: acotado con from/to al mes actual, para PRs y para saber
//    en que repos hubo commits este mes (base para el panel de lineas)
const query = `
  query ($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      id
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
        commitContributionsByRepository(maxRepositories: 15) {
          repository {
            name
            isPrivate
            url
          }
        }
      }
    }
  }
`;

// Query auxiliar: additions/deletions de los commits del usuario en un repo
// especifico, dentro del mes, sobre la rama por defecto.
const historyQuery = `
  query ($owner: String!, $name: String!, $since: GitTimestamp!, $until: GitTimestamp!, $authorId: ID!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(since: $since, until: $until, author: { id: $authorId }) {
              nodes {
                additions
                deletions
              }
            }
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

function parseOwnerAndName(url) {
  // https://github.com/owner/repo -> { owner, name }
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  return { owner: parts[0], name: parts[1] };
}

async function gql(query, variables) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`GitHub GraphQL responded ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

// Suma additions/deletions del usuario en cada repo donde tuvo commits este
// mes. Se ejecuta en paralelo, uno por repo; si alguno falla (repo vacio,
// sin defaultBranchRef, etc.) simplemente se ignora en vez de tumbar el script.
async function fetchLinesChangedByRepo(repos, authorId, from, to) {
  const results = await Promise.all(
    repos.map(async (entry) => {
      try {
        const { owner, name } = parseOwnerAndName(entry.repository.url);
        const data = await gql(historyQuery, { owner, name, since: from, until: to, authorId });
        const nodes = data?.repository?.defaultBranchRef?.target?.history?.nodes ?? [];
        const additions = nodes.reduce((sum, c) => sum + c.additions, 0);
        const deletions = nodes.reduce((sum, c) => sum + c.deletions, 0);
        return {
          name: entry.repository.name,
          isPrivate: entry.repository.isPrivate,
          additions,
          deletions,
        };
      } catch {
        return null;
      }
    })
  );
  return results.filter(Boolean).filter((r) => r.additions + r.deletions > 0);
}

async function main() {
  const { from, to } = monthRange();

  const data = await gql(query, { login: username, from, to });

  const repos = data?.user?.allTime?.commitContributionsByRepository;
  const prRepos = data?.user?.thisMonth?.pullRequestContributionsByRepository ?? [];
  const thisMonthCommitRepos = data?.user?.thisMonth?.commitContributionsByRepository ?? [];
  const authorId = data?.user?.id;

  if (!repos) {
    throw new Error("Could not read commit contributions. Check the token/username.");
  }

  // Ordena por cantidad de commits, de mayor (arriba) a menor (abajo) -- automatico
  const sorted = [...repos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount);

  // Repo con mas PRs este mes (si hay alguno)
  const topPR = [...prRepos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount)[0] || null;

  // Lineas cambiadas este mes, por repo -> total agregado + repo con mas lineas
  const linesByRepo = authorId
    ? await fetchLinesChangedByRepo(thisMonthCommitRepos, authorId, from, to)
    : [];
  const totalAdditions = linesByRepo.reduce((sum, r) => sum + r.additions, 0);
  const totalDeletions = linesByRepo.reduce((sum, r) => sum + r.deletions, 0);
  const topLinesRepo =
    [...linesByRepo].sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions))[0] || null;

  // Diagnostico temporal: muestra en el log lo que realmente devuelve la API
  console.log("--- DEBUG: raw repository data ---");
  sorted.forEach((entry) => {
    console.log(`${entry.repository.name} | isPrivate: ${entry.repository.isPrivate} | commits: ${entry.contributions.totalCount} | url: ${entry.repository.url}`);
  });
  if (topPR) {
    console.log(`--- DEBUG: top PR repo this month --- ${topPR.repository.name} | PRs: ${topPR.contributions.totalCount}`);
  }
  if (topLinesRepo) {
    console.log(`--- DEBUG: lines changed this month --- total +${totalAdditions}/-${totalDeletions} | top: ${topLinesRepo.name} +${topLinesRepo.additions}/-${topLinesRepo.deletions}`);
  }
  console.log("-----------------------------------");

  const rowHeight = 30;
  const paddingTop = 16;
  const paddingBottom = 16;
  const paddingX = 20;

  // --- Layout de la barra (columna izquierda) ---
  const barMaxWidth = 180;
  const countGap = 10;
  const countColumnWidth = 34;
  const barEndX = paddingX + barMaxWidth;
  const countX = barEndX + countGap;
  const barsColumnWidth = countX + countColumnWidth;

  const rowsHeight = sorted.length * rowHeight;
  const height = paddingTop + rowsHeight + paddingBottom;

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

  // Los paneles laterales aparecen justo despues de que termina de llenarse
  // la ultima barra (delay de la ultima fila + su duracion de llenado).
  const lastRowFlashDelay = (sorted.length - 1) * delayStep + growDuration;
  const panelDelay = (lastRowFlashDelay + 0.25).toFixed(3);

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

  // --- Paneles laterales genericos ---
  // Cada panel define su ancho y su propio SVG interno (ya posicionado en
  // 0,0); el layout los va acomodando en fila, uno tras otro, con un
  // divisor entre cada uno. Agregar un tercer panel en el futuro es solo
  // empujar un objeto mas a este arreglo.
  const panels = [];

  if (topPR) {
    const isPrivate = topPR.repository.isPrivate;
    const prLabel = isPrivate ? "Private repository" : topPR.repository.name;
    const prCount = topPR.contributions.totalCount;

    panels.push({
      width: 140,
      render: (x, contentTop) => `
        <text class="panel-label" x="${x}" y="${contentTop + 11}">MOST PULL REQUESTS THIS MONTH</text>
        <text class="panel-repo${isPrivate ? " private" : ""}" x="${x}" y="${contentTop + 30}">${escapeXml(prLabel)}</text>
        <text class="panel-number" x="${x + 70}" y="${contentTop + 70}" text-anchor="middle">${prCount}</text>`,
    });
  }

  if (topLinesRepo) {
    const isPrivate = topLinesRepo.isPrivate;
    const repoLabel = isPrivate ? "Private repository" : topLinesRepo.name;

    panels.push({
      width: 160,
      render: (x, contentTop) => `
        <text class="panel-label" x="${x}" y="${contentTop + 11}">LINES CHANGED THIS MONTH</text>
        <text class="panel-lines-add" x="${x}" y="${contentTop + 45}">+${totalAdditions.toLocaleString("en-US")}</text>
        <text class="panel-lines-del" x="${x + 78}" y="${contentTop + 45}">-${totalDeletions.toLocaleString("en-US")}</text>
        <text class="panel-sub"${isPrivate ? ' style="font-style:italic"' : ""} x="${x}" y="${contentTop + 66}">${escapeXml(repoLabel)}: +${topLinesRepo.additions.toLocaleString("en-US")}/-${topLinesRepo.deletions.toLocaleString("en-US")}</text>`,
    });
  }

  let panelsSvg = "";
  let cursorX = barsColumnWidth;

  panels.forEach((panel) => {
    const gap = 28;
    const dividerX = cursorX + gap / 2;
    const panelX = cursorX + gap;
    const contentTop = (height - 78) / 2; // centra el bloque de contenido verticalmente

    panelsSvg += `
      <line class="divider" x1="${dividerX}" y1="${paddingTop}" x2="${dividerX}" y2="${height - paddingBottom}" />
      <g class="panel" style="animation-delay:${panelDelay}s">
        ${panel.render(panelX, contentTop)}
      </g>`;

    cursorX = panelX + panel.width;
  });

  const width = cursorX + (panels.length ? paddingX : 0);

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

  /* Paneles laterales -- tonos apagados, no compiten con las barras */
  .divider { stroke:#21262d; stroke-width:1; }
  .panel { opacity:0; animation: fadeInPanel 0.6s ease-out both; }
  @keyframes fadeInPanel { 0%{opacity:0; transform:translateX(4px);} 100%{opacity:1; transform:translateX(0);} }
  text.panel-label { fill:#6e7681; font-size:9.5px; font-weight:700; letter-spacing:0.05em; }
  text.panel-repo { fill:#a8b1bb; font-size:13px; font-weight:600; }
  text.panel-repo.private { fill:#8b949e; font-style:italic; font-weight:500; }
  text.panel-number { fill:#c9d1d9; font-size:30px; font-weight:700; }
  text.panel-lines-add { fill:#3fb950; font-size:22px; font-weight:700; }
  text.panel-lines-del { fill:#f85149; font-size:22px; font-weight:700; }
  text.panel-sub { fill:#7d8590; font-size:10.5px; font-weight:500; }

  @media (prefers-reduced-motion: reduce) { .row, .bar, .count, .panel { opacity:1 !important; transform:none !important; animation:none !important; } }
</style>
<rect width="${width}" height="${height}" fill="none"/>
${rows}
${panelsSvg}
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