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

  // Ordena por cantidad de commits, de mayor (arriba) a menor (abajo) -- automatico
  const sorted = [...repos].sort((a, b) => b.contributions.totalCount - a.contributions.totalCount);

  // Diagnostico temporal: muestra en el log lo que realmente devuelve la API
  console.log("--- DEBUG: raw repository data ---");
  sorted.forEach((entry) => {
    console.log(`${entry.repository.name} | isPrivate: ${entry.repository.isPrivate} | commits: ${entry.contributions.totalCount} | url: ${entry.repository.url}`);
  });
  console.log("-----------------------------------");

  const rowHeight = 30;
  const paddingTop = 16;
  const paddingBottom = 16;
  const paddingX = 20;

  // --- Layout de la barra ---
  // barMaxWidth es el tope duro que una barra puede alcanzar (aunque el repo
  // con mas commits la llene al 100%). El numero de commits se ancla siempre
  // a este mismo punto (barEndX), en vez de flotar hacia el borde derecho de
  // la tarjeta -- asi todos los numeros quedan alineados en una sola columna
  // justo despues de donde terminan las barras.
  const barMaxWidth = 180;
  const countGap = 10; // espacio entre el final de la barra y el numero
  const countColumnWidth = 34; // espacio reservado para el texto del numero
  const barEndX = paddingX + barMaxWidth;
  const countX = barEndX + countGap;
  const width = countX + countColumnWidth;

  const height = paddingTop + sorted.length * rowHeight + paddingBottom;
  const maxCommits = Math.max(...sorted.map((r) => r.contributions.totalCount), 1);

  // Colores tipo "medalla" para el top 3 (oro, plata, bronce) -- SOLO para el
  // nombre del repo, ya no para la barra. Las barras siempre van en verde
  // GitHub (o gris para repos privados).
  const RANK_COLORS = ["#e3b341", "#b0b7bd", "#cd7f32"];
  const GITHUB_GREEN = "#39d353";
  const PRIVATE_GRAY = "#484f58";

  function barColor(isPrivate) {
    return isPrivate ? PRIVATE_GRAY : GITHUB_GREEN;
  }

  function nameColor(isPrivate, rank) {
    if (isPrivate) return null; // usa el fill por defecto de .repo.private
    if (rank < RANK_COLORS.length) return RANK_COLORS[rank];
    return null; // usa el fill por defecto de .repo
  }

  // --- Timing ---
  // Las barras llenan lento y el tiempo total de la animacion (ultima fila
  // terminando de llenarse) se hace coincidir con el tiempo que tarda en
  // completarse el "wave" del grafico de contribuciones (generate-wave-graph.mjs),
  // para que si se muestran juntos terminen a la vez.
  //
  // wave: lastCellDelay = (weeks-1)*weekDelay + 6*rowDelay ; termina en + popDuration
  // usando ~53 semanas (tamano tipico del calendario de GitHub):
  //   (53-1)*0.065 + 6*0.036 + 0.55 ≈ 4.15s
  const WAVE_COMPLETION_TIME = 4.15;

  const growDuration = 1.8; // duracion del llenado de cada barra
  const staggerBudget = Math.max(WAVE_COMPLETION_TIME - growDuration, 0);
  const delayStep = sorted.length > 1 ? staggerBudget / (sorted.length - 1) : 0;

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
  @media (prefers-reduced-motion: reduce) { .row, .bar, .count { opacity:1 !important; transform:none !important; animation:none !important; } }
</style>
<rect width="${width}" height="${height}" fill="none"/>
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