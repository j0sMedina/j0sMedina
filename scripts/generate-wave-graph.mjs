// scripts/generate-wave-graph.mjs
//
// Trae el calendario de contribuciones real de un usuario de GitHub (vía GraphQL)
// y genera un SVG estilo "GitHub dark" con:
//  - paleta oficial de GitHub en modo oscuro
//  - pop-in con leve overshoot de escala
//  - flash de brillo en celdas con actividad
//  - delay diagonal (columna + fila) -> efecto de ola de izquierda a derecha
//  - respeta prefers-reduced-motion
//
// Uso: GITHUB_TOKEN=xxx GITHUB_USER=j0sMedina node scripts/generate-wave-graph.mjs

const token = process.env.GITHUB_TOKEN;
const username = process.env.GITHUB_USER;

if (!token || !username) {
  console.error("Faltan GITHUB_TOKEN o GITHUB_USER como variables de entorno.");
  process.exit(1);
}

const query = `
  query ($login: String!) {
    user(login: $login) {
      contributionsCollection {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              weekday
              contributionCount
            }
          }
        }
      }
    }
  }
`;

// Paleta oficial de GitHub (tema oscuro)
const PALETTE = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function levelForCount(count, max) {
  if (count === 0) return 0;
  if (max <= 0) return 1;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

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
    throw new Error(`GitHub GraphQL respondió ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  const calendar = json?.data?.user?.contributionsCollection?.contributionCalendar;

  if (!calendar) {
    throw new Error("No se pudo leer el calendario de contribuciones. Revisa el token/usuario.");
  }

  const { weeks, totalContributions } = calendar;
  const maxCount = Math.max(...weeks.flatMap((w) => w.contributionDays.map((d) => d.contributionCount)));

  const cellSize = 13;
  const step = 16; // separación entre celdas (tamaño + gap)
  const radius = 2.5;
  const paddingLeft = 34;
  const paddingTop = 24;
  const paddingBottom = 22;
  const width = paddingLeft + weeks.length * step + 6;
  const height = paddingTop + 7 * step + paddingBottom;

  const weekDelay = 0.065; // delay por columna (semana)
  const rowDelay = 0.036; // delay adicional por fila -> hace el efecto diagonal

  let rects = "";
  let prevMonth = null;
  let monthLabels = "";

  weeks.forEach((week, weekIndex) => {
    const x = paddingLeft + weekIndex * step;

    const firstDay = week.contributionDays[0];
    if (firstDay) {
      const month = new Date(firstDay.date).getMonth();
      if (month !== prevMonth) {
        monthLabels += `<text class="lbl" x="${x}" y="16">${MONTH_NAMES[month]}</text>\n`;
        prevMonth = month;
      }
    }

    week.contributionDays.forEach((day) => {
      const y = paddingTop + day.weekday * step;
      const level = levelForCount(day.contributionCount, maxCount);
      const delay = (weekIndex * weekDelay + day.weekday * rowDelay).toFixed(3);
      const cls = level === 0 ? "c e" : "c g";
      rects += `<rect class="${cls}" x="${x}" y="${y}" width="${cellSize}" height="${cellSize}" rx="${radius}" fill="${PALETTE[level]}" style="animation-delay:${delay}s"><title>${day.date}: ${day.contributionCount} contributions</title></rect>\n`;
    });
  });

  const dayLabels = `<text class="lbl" x="2" y="${paddingTop + 1 * step + 11}">Mon</text><text class="lbl" x="2" y="${paddingTop + 3 * step + 11}">Wed</text><text class="lbl" x="2" y="${paddingTop + 5 * step + 11}">Fri</text>`;

  const totalLabel = `<text class="total" x="${paddingLeft}" y="${height - 6}">${totalContributions.toLocaleString("en-US")} contributions in the last year</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<style>
  text.lbl { fill:#7d8590; font-size:13px; font-weight:600; }
  text.total { fill:#e6edf3; font-size:15px; font-weight:700; }
  .c { transform-box:fill-box; transform-origin:center; opacity:0; animation:pop 0.55s ease-out both; }
  .g { animation:pop 0.55s ease-out both, flash 0.7s ease-out both; }
  @keyframes pop { 0%{opacity:0;transform:scale(.2)} 60%{opacity:1;transform:scale(1.1)} 100%{opacity:1;transform:scale(1)} }
  @keyframes flash { 0%{filter:brightness(2.4)} 45%{filter:brightness(2.4)} 100%{filter:brightness(1)} }
  @media (prefers-reduced-motion: reduce) { .c { opacity:1 !important; animation:none !important; } }
</style>
<rect width="${width}" height="${height}" fill="none"/>
${monthLabels}${dayLabels}
${rects}
${totalLabel}
</svg>`;

  const fs = await import("node:fs");
  fs.mkdirSync("dist", { recursive: true });
  fs.writeFileSync("dist/wave-graph.svg", svg);
  console.log(`SVG generado en dist/wave-graph.svg (${totalContributions} contributions)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
