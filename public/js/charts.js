// 圖表：純 SVG，無外部套件。顏色走 CSS 變數（--c1…--c5），深淺色模式各自驗證過。
const Chart = (() => {
  const esc = s => UI.esc(String(s ?? ''));
  const fmt = v => Number(v || 0).toLocaleString('en-US');
  const short = v => {
    const n = Math.abs(Number(v) || 0);
    if (n >= 1e8) return (v / 1e8).toFixed(1) + '億';
    if (n >= 1e4) return (v / 1e4).toFixed(n >= 1e5 ? 0 : 1) + '萬';
    return fmt(v);
  };
  const C = i => `var(--c${(i % 5) + 1})`;

  // 好看的刻度（1 / 2 / 5 × 10^n）
  function ticks(max, want = 4) {
    if (max <= 0) return { top: 1, step: 1, list: [0, 1] };
    const raw = max / want, p = Math.pow(10, Math.floor(Math.log10(raw)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw) || 10 * p;
    const top = Math.ceil(max / step) * step;
    const list = []; for (let v = 0; v <= top + 1e-9; v += step) list.push(v);
    return { top, step, list };
  }

  const frame = (h, inner) =>
    `<svg class="chart" viewBox="0 0 640 ${h}" role="img" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  function legend(items) {
    if (items.length < 2) return '';
    return `<div class="chart-legend">${items.map((s, i) =>
      `<span><i style="background:${s.color || C(i)}"></i>${esc(s.label)}</span>`).join('')}</div>`;
  }

  /** 直條圖：rows = [{label, ...}]，series = [{key, label}]（1~3 條，同單位同軸） */
  function bars(rows, series, { height = 240, unit = '雨幣', everyN = 1 } = {}) {
    const W = 640, H = height, pad = { l: 52, r: 12, t: 14, b: 26 };
    const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
    const max = Math.max(1, ...rows.flatMap(r => series.map(s => Number(r[s.key]) || 0)));
    const t = ticks(max);
    const y = v => pad.t + ph - (v / t.top) * ph;
    const slot = pw / Math.max(1, rows.length);
    const bw = Math.max(2, Math.min(26, (slot - 6) / series.length - 2));

    const grid = t.list.map(v => `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="ax" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${short(v)}</text>`).join('');

    const marks = rows.map((r, ri) => {
      const gx = pad.l + slot * ri + slot / 2 - (bw * series.length + 2 * (series.length - 1)) / 2;
      return series.map((s, si) => {
        const v = Number(r[s.key]) || 0, h = Math.max(v > 0 ? 2 : 0, (v / t.top) * ph);
        const x = gx + si * (bw + 2);
        return `<rect class="bar" x="${x}" y="${y(v)}" width="${bw}" height="${h}" rx="3" fill="${C(si)}"
          ><title>${esc(r.label)}　${esc(s.label)}：${fmt(v)} ${esc(unit)}</title></rect>`;
      }).join('') +
      (ri % everyN === 0
        ? `<text class="ax" x="${pad.l + slot * ri + slot / 2}" y="${H - 8}" text-anchor="middle">${esc(r.label)}</text>` : '');
    }).join('');

    return legend(series) + frame(H, grid + marks);
  }

  /** 橫條圖：items = [{label, amount}]，適合排行 */
  function hbar(items, { height = null, unit = '雨幣', color = null } = {}) {
    if (!items.length) return '<div class="empty">目前沒有資料</div>';
    const rowH = 30, pad = { l: 108, r: 62, t: 8, b: 8 };
    const H = height || pad.t + pad.b + rowH * items.length;
    const W = 640, pw = W - pad.l - pad.r;
    const max = Math.max(1, ...items.map(i => Number(i.amount) || 0));
    const marks = items.map((it, i) => {
      const v = Number(it.amount) || 0, w = Math.max(v > 0 ? 2 : 0, (v / max) * pw);
      const y = pad.t + i * rowH;
      return `<text class="ax" x="${pad.l - 10}" y="${y + rowH / 2 + 4}" text-anchor="end">${esc(it.label).slice(0, 12)}</text>
        <rect class="bar" x="${pad.l}" y="${y + 6}" width="${w}" height="${rowH - 14}" rx="3" fill="${color || C(i)}"
          ><title>${esc(it.label)}：${fmt(v)} ${esc(unit)}</title></rect>
        <text class="val" x="${pad.l + w + 8}" y="${y + rowH / 2 + 4}">${short(v)}</text>`;
    }).join('');
    return frame(H, marks);
  }

  /** 甜甜圈：items = [{label, amount}] */
  function donut(items, { height = 240, unit = '雨幣', colors = null } = {}) {
    const data = items.filter(i => Number(i.amount) > 0);
    if (!data.length) return '<div class="empty">目前沒有資料</div>';
    const total = data.reduce((s, i) => s + Number(i.amount), 0);
    const cx = 130, cy = height / 2, R = Math.min(96, cy - 12), r = R * 0.62;
    let a = -Math.PI / 2;
    const arcs = data.map((it, i) => {
      const frac = Number(it.amount) / total;
      const a2 = a + frac * Math.PI * 2 - (data.length > 1 ? 0.02 : 0);
      const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)} ${(cy + rad * Math.sin(ang)).toFixed(2)}`;
      const big = a2 - a > Math.PI ? 1 : 0;
      const d = `M ${p(R, a)} A ${R} ${R} 0 ${big} 1 ${p(R, a2)} L ${p(r, a2)} A ${r} ${r} 0 ${big} 0 ${p(r, a)} Z`;
      a += frac * Math.PI * 2;
      return `<path class="slice" d="${d}" fill="${(colors && colors[i]) || C(i)}"
        ><title>${esc(it.label)}：${fmt(it.amount)} ${esc(unit)}（${(frac * 100).toFixed(1)}%）</title></path>`;
    }).join('');

    const rows = data.map((it, i) => `
      <g transform="translate(268, ${height / 2 - data.length * 11 + i * 22})">
        <rect x="0" y="-9" width="10" height="10" rx="2.5" fill="${(colors && colors[i]) || C(i)}"/>
        <text class="ax leg" x="18" y="0">${esc(it.label)}</text>
        <text class="val" x="360" y="0" text-anchor="end">${short(it.amount)}　${((it.amount / total) * 100).toFixed(0)}%</text>
      </g>`).join('');

    return frame(height, `${arcs}
      <text class="hero" x="${cx}" y="${cy - 2}" text-anchor="middle">${short(total)}</text>
      <text class="ax" x="${cx}" y="${cy + 16}" text-anchor="middle">合計 ${esc(unit)}</text>${rows}`);
  }

  const card = (title, body, sub = '') =>
    `<div class="card chart-card"><h3>${esc(title)}${sub ? ` <span class="muted" style="font-weight:400;font-size:13px">${esc(sub)}</span>` : ''}</h3>${body}</div>`;

  return { bars, hbar, donut, card, legend, fmt, short, C };
})();
