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

  /** 篩選條件記在瀏覽器，換頁回來不用重填 */
  savedFilters(id) {
    try { return JSON.parse(localStorage.getItem('meow_f_' + id) || '{}'); } catch { return {}; }
  },
  saveFilters(id, v) { localStorage.setItem('meow_f_' + id, JSON.stringify(v)); },

  /** 篩選列：欄位定義 [{id,label,type,options,placeholder,width}] */
  filters(id, fields) {
    const saved = H.savedFilters(id);
    const f = x => {
      const w = x.width ? ` style="min-width:${x.width}px"` : '';
      const v = saved[x.id] ?? '';
      if (x.type === 'select')
        return `<label class="f"><span>${UI.esc(x.label)}</span><select id="${id}_${x.id}"${w}>${
          x.options.map(o => `<option value="${UI.esc(o.v)}" ${String(o.v) === String(v) ? 'selected' : ''}>${
            UI.esc(o.t)}</option>`).join('')}</select></label>`;
      return `<label class="f"><span>${UI.esc(x.label)}</span><input id="${id}_${x.id}" type="${x.type || 'text'}"${w}
        value="${UI.esc(v)}" placeholder="${UI.esc(x.placeholder || '')}"></label>`;
    };
    return `<div class="card filter-card">
      <div class="row" style="margin-bottom:8px;align-items:center">
        <div class="grow"><span class="muted" style="font-size:12.5px">篩選條件</span>
          <span id="${id}_chips" class="filter-chips"></span></div>
      </div>
      <div class="grid c3">${fields.map(f).join('')}</div>
      <div class="row" style="margin-top:10px">
        <div class="fit"><button class="btn" id="${id}_go">🔍 查詢</button></div>
        <div class="fit"><button class="btn secondary" id="${id}_reset">清除條件</button></div>
        <div class="grow muted" id="${id}_count" style="align-self:center;text-align:right"></div>
        <div class="fit"><button class="btn secondary sm" id="${id}_prev">← 上一頁</button></div>
        <div class="fit"><button class="btn secondary sm" id="${id}_next">下一頁 →</button></div>
      </div>
    </div>`;
  },

  /** 把篩選列接起來：回傳 { values() } */
  bindFilters(id, fields, load, state) {
    const el = k => document.getElementById(`${id}_${k}`);
    const raw = () => Object.fromEntries(
      fields.map(x => [x.id, (el(x.id)?.value || '').trim()]).filter(([, v]) => v !== ''));
    const values = () => { const v = raw(); H.saveFilters(id, v); H.chips(id, fields, v); return v; };

    const go = () => { state.offset = 0; load(); };
    const clearOne = key => { const e = el(key); if (e) e.value = ''; go(); };
    el('go').onclick = go;
    el('reset').onclick = () => { fields.forEach(x => { if (el(x.id)) el(x.id).value = ''; }); go(); };
    el('prev').onclick = () => { state.offset = Math.max(0, state.offset - state.limit); load(); };
    el('next').onclick = () => { state.offset += state.limit; load(); };
    fields.forEach(x => {
      const e = el(x.id);
      if (!e) return;
      if (e.tagName === 'SELECT') e.onchange = go;
      else e.onkeydown = ev => { if (ev.key === 'Enter') go(); };
    });
    // 條件標籤上的 × 可以單獨移除一個條件
    document.getElementById(`${id}_chips`).onclick = ev => {
      const k = ev.target.closest('[data-chip]')?.dataset.chip;
      if (k) clearOne(k);
    };
    H.chips(id, fields, raw());
    return { values };
  },

  /** 目前生效中的條件，做成可點掉的標籤 */
  chips(id, fields, values) {
    const box = document.getElementById(`${id}_chips`);
    if (!box) return;
    const label = k => fields.find(x => x.id === k)?.label || k;
    const shown = k => {
      const f = fields.find(x => x.id === k);
      if (f?.type === 'select') return f.options.find(o => String(o.v) === String(values[k]))?.t ?? values[k];
      return values[k];
    };
    const keys = Object.keys(values);
    box.innerHTML = keys.length
      ? keys.map(k => `<button class="chip" data-chip="${UI.esc(k)}" title="移除這個條件">${
          UI.esc(label(k))}：${UI.esc(String(shown(k)))} <span aria-hidden="true">×</span></button>`).join('')
      : '<span class="muted" style="font-size:12.5px">未設條件，顯示全部</span>';
  },

  /** 更新筆數顯示與翻頁鈕狀態 */
  pager(id, total, state) {
    const shown = Math.min(state.offset + state.limit, total);
    const page = Math.floor(state.offset / state.limit) + 1;
    const pages = Math.max(1, Math.ceil(total / state.limit));
    document.getElementById(`${id}_count`).textContent =
      total ? `第 ${state.offset + 1}–${shown} 筆，共 ${H.n(total)} 筆（第 ${page} / ${pages} 頁）`
            : '沒有符合條件的資料';
    document.getElementById(`${id}_prev`).disabled = state.offset <= 0;
    document.getElementById(`${id}_next`).disabled = state.offset + state.limit >= total;
  },

  table(headers, rows, emptyText = '目前沒有資料') {
    const lastLabel = (h => (typeof h === 'string' ? h : h?.label) || '')(headers[headers.length - 1]);
    const sticky = /操作/.test(lastLabel) ? ' has-actions' : '';
    if (!rows.length) return `<div class="empty">${UI.esc(emptyText)}</div>`;
    return `<div class="table-wrap"><table class="${sticky.trim()}">
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
