// 共用小工具
const H = {
  n: v => Number(v || 0).toLocaleString('en-US'),
  money: v => Number(v || 0).toLocaleString('en-US') + ' 雨幣',
  date: s => (s || '').replace('T', ' ').slice(0, 16),
  esc: s => UI.esc(s),

  user(id, name) {
    if (!id) return '<span class="muted">—</span>';
    return `<span title="${UI.esc(id)}">${UI.esc(name || id)}</span>`;
  },

  statusTag(s) {
    const map = { pending: ['warn', '待核銷'], settled: ['ok', '已核銷'], refunded: ['err', '已退單'],
                  open: ['warn', '待處理'], claimed: ['', '已接單'], closed: ['ok', '已結束'],
                  done: ['ok', '已完成'], rejected: ['err', '已退回'],
                  passed: ['ok', '通過'], failed: ['err', '未通過'] };
    const [c, t] = map[s] || ['', s];
    return `<span class="tag ${c}">${UI.esc(t)}</span>`;
  },

  sourceLabel(s) {
    return { self: '自主報單', cross: '跨服 1 號', cross2: '唱歌跨服', ticket: '派單' }[s] || s;
  },

  table(headers, rows, emptyText = '目前沒有資料') {
    if (!rows.length) return `<div class="empty">${UI.esc(emptyText)}</div>`;
    return `<div class="table-wrap"><table>
      <thead><tr>${headers.map(h => `<th class="${h.num ? 'num' : ''}">${UI.esc(h.label || h)}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody></table></div>`;
  },

  stat(k, v, { accent = false, small = false } = {}) {
    return `<div class="stat ${accent ? 'accent' : ''}"><div class="k">${UI.esc(k)}</div>
      <div class="v ${small ? 'small' : ''}">${v}</div></div>`;
  },

  thisMonth() { return new Date().toLocaleDateString('sv-SE').slice(0, 7); }
};

// 集團綁定（PUT /api/org）
const POST_ORG = body => PUT('/org', body);
