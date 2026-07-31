const panelFadeInDuration = 0.6; // debe coincidir con la duracion de fadeInPanel en el CSS
const panelStagger = 0.35; // separacion entre la aparicion de cada panel

let panelsSvg = "";
let cursorX = barsColumnWidth;

panels.forEach((panel, i) => {
  const gap = 34;
  const dividerX = cursorX + gap / 2;
  const panelX = cursorX + gap;
  const thisPanelDelay = (lastRowFlashDelay + 0.25 + i * panelStagger).toFixed(3);

  panelsSvg += `
    <line class="divider" x1="${dividerX}" y1="${paddingTop}" x2="${dividerX}" y2="${height - paddingBottom}" />
    <g class="panel" style="animation-delay:${thisPanelDelay}s">
      ${panel.render(panelX)}
    </g>`;

  cursorX = panelX + panel.width;
});