// Draws a regulation field (120 x 53.33 yd incl. end zones) to a canvas.
const PX = 24; // pixels per yard

export function drawField(home, away) {
  const W = 120 * PX, H = Math.round(53.33 * PX);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const X = (yd) => (yd + 10) * PX;           // yard line (0..100) -> px; end zones at -10..0, 100..110
  const Y = (yd) => H - yd * PX;               // field Y (0 at near sideline) -> px (flipped so near sideline is bottom)

  // grass stripes every 5 yards
  for (let i = 0; i < 24; i++) {
    g.fillStyle = i % 2 ? '#2f7d32' : '#347f36';
    g.fillRect(i * 5 * PX, 0, 5 * PX, H);
  }
  // subtle mowing texture
  g.globalAlpha = 0.05;
  for (let y = 0; y < H; y += 6) { g.fillStyle = y % 12 ? '#000' : '#fff'; g.fillRect(0, y, W, 3); }
  g.globalAlpha = 1;

  // end zones
  const ez = (x0, team) => {
    g.fillStyle = team.colors.primary;
    g.fillRect(x0, 0, 10 * PX, H);
    g.save();
    g.translate(x0 + 5 * PX, H / 2);
    g.rotate(x0 < W / 2 ? -Math.PI / 2 : Math.PI / 2);
    g.fillStyle = team.colors.secondary;
    g.strokeStyle = 'rgba(0,0,0,0.35)';
    g.lineWidth = 6;
    g.font = `900 ${Math.round(6.2 * PX)}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const txt = team.name.toUpperCase();
    const maxW = 48 * PX;
    const m = g.measureText(txt).width;
    if (m > maxW) g.scale(maxW / m, 1);
    g.strokeText(txt, 0, 0);
    g.fillText(txt, 0, 0);
    g.restore();
  };
  ez(0, home);
  ez(110 * PX, away);

  g.strokeStyle = '#f4f4f0';
  g.fillStyle = '#f4f4f0';
  // sidelines & end lines
  g.lineWidth = PX * 0.3;
  g.strokeRect(PX * 0.15, PX * 0.15, W - PX * 0.3, H - PX * 0.3);
  // yard lines every 5, goal lines thicker
  for (let yd = 0; yd <= 100; yd += 5) {
    g.lineWidth = yd === 0 || yd === 100 ? PX * 0.33 : PX * 0.14;
    g.beginPath(); g.moveTo(X(yd), 0); g.lineTo(X(yd), H); g.stroke();
  }
  // hash marks and sideline ticks every yard
  const hashL = 26.67 + 3.08, hashR = 26.67 - 3.08;
  g.lineWidth = PX * 0.1;
  for (let yd = 1; yd < 100; yd++) {
    if (yd % 5 === 0) continue;
    const x = X(yd);
    for (const [y0, len] of [[0.3, 0.7], [53.03 - 0.7, 0.7], [hashL, 0.7], [hashR - 0.7, 0.7]]) {
      g.beginPath(); g.moveTo(x, Y(y0)); g.lineTo(x, Y(y0 + len)); g.stroke();
    }
  }
  // two-point / PAT lines
  for (const yd of [2, 98]) { g.beginPath(); g.moveTo(X(yd), Y(26.67 - 0.5)); g.lineTo(X(yd), Y(26.67 + 0.5)); g.stroke(); }
  // numbers
  g.font = `bold ${Math.round(2 * PX)}px "Arial", sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let yd = 10; yd <= 90; yd += 10) {
    const n = yd <= 50 ? yd : 100 - yd;
    const label = String(n).split('').join(' ');
    for (const [fy, rot] of [[9, 0], [53.33 - 9, Math.PI]]) {
      g.save();
      g.translate(X(yd), Y(fy));
      g.rotate(rot);
      g.fillText(label, 0, 0);
      // direction arrows toward the nearest goal
      if (n !== 50) {
        const dir = yd < 50 ? -1 : 1;
        const ax = (rot ? -dir : dir) * 1.9 * PX;
        g.beginPath();
        g.moveTo(ax + (rot ? -dir : dir) * 0.45 * PX, 0);
        g.lineTo(ax, -0.3 * PX); g.lineTo(ax, 0.3 * PX); g.closePath(); g.fill();
      }
      g.restore();
    }
  }
  // midfield logo
  g.save();
  g.translate(X(50), H / 2);
  g.globalAlpha = 0.9;
  g.fillStyle = home.colors.primary;
  g.beginPath(); g.arc(0, 0, 4 * PX, 0, Math.PI * 2); g.fill();
  g.lineWidth = PX * 0.35; g.strokeStyle = home.colors.secondary; g.stroke();
  g.fillStyle = home.colors.secondary;
  g.font = `900 ${Math.round(2.6 * PX)}px "Arial Black", Arial, sans-serif`;
  g.fillText(home.abbr, 0, PX * 0.1);
  g.restore();
  return cv;
}
