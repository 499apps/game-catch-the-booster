// Post-flight graphs on a 2D canvas: altitude and speed against time, and the
// engines-lit timeline. Line styles differ (solid / dashed) as well as colours.
import type { FlightSeries } from '../sim/timeline';

export interface GraphMarks {
  ignitionT: number | null;
  contactT: number | null;
}

const ALT = '#5fffd0';
const SPD = '#ffcf86';
const LIT = '#ffb347';
const GRID = 'rgba(160, 190, 215, 0.18)';
const TEXT = '#c9d6e2';

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Draws the graphs into `canvas` at its CSS size (crisp on high-DPI screens). */
export function drawFlightGraphs(canvas: HTMLCanvasElement, s: FlightSeries, marks: GraphMarks): void {
  const cssW = canvas.clientWidth || 260;
  const cssH = canvas.clientHeight || 170;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const n = s.t.length;
  if (n < 2) return;
  const t0 = s.t[0] ?? 0;
  const t1 = s.t[n - 1] ?? 1;
  const pad = { l: 34, r: 34, t: 14, b: 18 };
  const litH = 20;
  const plotH = cssH - pad.t - pad.b - litH - 8;
  const plotW = cssW - pad.l - pad.r;
  const xOf = (t: number): number => pad.l + ((t - t0) / Math.max(t1 - t0, 1e-6)) * plotW;
  const altMax = niceMax(Math.max(...s.altitude));
  const spdMax = niceMax(Math.max(...s.speed));
  const yAlt = (v: number): number => pad.t + plotH - (v / altMax) * plotH;
  const ySpd = (v: number): number => pad.t + plotH - (v / spdMax) * plotH;

  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.lineWidth = 1;
  // Grid and axes labels.
  ctx.strokeStyle = GRID;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (plotH * i) / 4;
    ctx.beginPath();
    ctx.moveTo(pad.l, y);
    ctx.lineTo(pad.l + plotW, y);
    ctx.stroke();
  }
  ctx.fillStyle = ALT;
  ctx.textAlign = 'right';
  ctx.fillText(altMax >= 1000 ? `${altMax / 1000} km` : `${altMax} m`, pad.l - 3, pad.t + 4);
  ctx.fillText('0', pad.l - 3, pad.t + plotH + 3);
  ctx.fillStyle = SPD;
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(spdMax * 3.6)}`, pad.l + plotW + 3, pad.t + 4);
  ctx.fillText('km/h', pad.l + plotW + 3, pad.t + 15);

  // Event marks: ignition and contact.
  const mark = (t: number | null, label: string): void => {
    if (t === null || t < t0 || t > t1) return;
    const x = xOf(t);
    ctx.strokeStyle = 'rgba(232, 238, 244, 0.45)';
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, pad.t);
    ctx.lineTo(x, pad.t + plotH + litH + 8);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, pad.t - 4);
  };
  mark(marks.ignitionT, 'LIGHT');
  mark(marks.contactT, 'CATCH');

  const line = (ys: readonly number[], yOf: (v: number) => number, color: string, dash: number[]): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash(dash);
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = xOf(s.t[i] ?? 0);
      const y = yOf(ys[i] ?? 0);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
  };
  line(s.altitude, yAlt, ALT, []);
  line(s.speed, ySpd, SPD, [5, 3]);

  // Engines-lit timeline: a step band, height = engines lit (0..13).
  const by = pad.t + plotH + 8;
  ctx.fillStyle = 'rgba(255, 255, 255, 0.05)';
  ctx.fillRect(pad.l, by, plotW, litH);
  ctx.fillStyle = LIT;
  for (let i = 0; i < n - 1; i++) {
    const lit = s.lit[i] ?? 0;
    if (lit <= 0) continue;
    const x0 = xOf(s.t[i] ?? 0);
    const x1 = xOf(s.t[i + 1] ?? 0);
    const h = (lit / 13) * litH;
    ctx.fillRect(x0, by + litH - h, Math.max(1, x1 - x0), h);
  }
  ctx.fillStyle = TEXT;
  ctx.textAlign = 'right';
  ctx.fillText('ENG', pad.l - 3, by + litH - 5);
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(t1 - t0)} s`, pad.l + plotW + 3, by + litH - 5);
}
