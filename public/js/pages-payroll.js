// 記帳 · 未發放薪資：儀表板（月份長條圖／欠款排行／項目佔比）＋ 篩選 ＋ 新增／編輯／刪除／發放

Pages.payroll = async view => {
  const ST = { offset: 0, limit: 50, sort: 'created_at', dir: 'desc' };
  let META = { categories: [], statuses: [] };

  const F = [
    { id: 'q', label: '關鍵字（對象／備註）' },
    { id: 'status', label: '狀態', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'unpaid', t: '未發放' }, { v: 'paid', t: '已發放' }] },
    { id: 'category', label: '項目', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'salary', t: '薪資' }, { v: 'bonus', t: '獎金' },
                { v: 'subsidy', t: '補貼' }, { v: 'advance', t: '代墊款' }, { v: 'other', t: '其他' }] },
    { id: 'period', label: '歸屬月份', type: 'month' },
    { id: 'staff', label: '對象（名稱或 Discord ID）' },
    { id: 'overdue', label: '逾期未發', type: 'select',
      options: [{ v: '', t: '不限' }, { v: '1', t: '只看逾期' }] },
    { id: 'from', label: '建立日期（起）', type: 'date' },
    { id: 'to', label: '建立日期（迄）', type: 'date' },
    { id: 'min_amount', label: '金額 ≥', type: 'number' },
    { id: 'max_amount', label: '金額 ≤', type: 'number' }
  ];

  const catLabel = k => (META.categories.find(c => c.key === k) || {}).label || k;
  const today = () => new Date().toLocaleDateString('sv-SE');
  const overdue = r => r.status === 'unpaid' && r.due_date && r.due_date < today();

  // ---------- 儀表板 ----------
  const loadStats = async () => {
    const q = new URLSearchParams({ ...bind.values(), months: 12 });
    const d = await GET('/payroll/stats?' + q);
    document.getElementById('pcharts').innerHTML =
      Chart.card('每月未發放 vs 已發放', Chart.bars(d.monthly, [
        { key: 'unpaid', label: '未發放' }, { key: 'paid', label: '已發放' }
      ], { unit: '元' }), '近 12 個月，依歸屬月份') +
      `<div class="grid c2">
        ${Chart.card('未發放金額排行（前 10）', Chart.hbar(d.top_staff, { unit: '元' }))}
        ${Chart.card('未發放項目佔比', Chart.donut(d.by_category, { unit: '元' }))}
      </div>`;
  };

  // ---------- 列表 ----------
  const load = async () => {
    const d = await GET('/payroll?' + new URLSearchParams({
      ...bind.values(), limit: ST.limit, offset: ST.offset, sort: ST.sort, dir: ST.dir
    }));
    META = { categories: d.categories, statuses: d.statuses };
    const s = d.summary;
    document.getElementById('psum').innerHTML = `
      ${H.stat('筆數', H.n(s.cnt))}
      ${H.stat('未發放筆數', H.n(s.unpaid_cnt))}
      ${H.stat('未發放金額', H.n(s.unpaid), { accent: true })}
      ${H.stat('已發放金額', H.n(s.paid))}
      ${H.stat('逾期未發', H.n(s.overdue), { accent: true })}`;

    const th = (key, label, num) =>
      `<th class="${num ? 'num' : ''}" data-sort="${key}" style="cursor:pointer">${label}${
        ST.sort === key ? (ST.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;

    document.getElementById('ptable').innerHTML = d.rows.length ? `
      <div class="table-wrap"><table class="has-actions">
        <thead><tr>
          <th><input type="checkbox" id="pall" style="width:auto"></th>
          ${th('period', '歸屬月份')}${th('staff_name', '對象')}<th>項目</th>
          ${th('amount', '金額', 1)}${th('status', '狀態')}${th('due_date', '預計發放日')}
          <th>實際發放</th><th>備註</th><th>登錄人</th>${th('created_at', '建立時間')}<th>操作</th>
        </tr></thead>
        <tbody>${d.rows.map(r => `<tr>
          <td><input type="checkbox" class="pchk" value="${r.id}" style="width:auto"
              ${r.status === 'unpaid' ? '' : 'disabled'}></td>
          <td>${UI.esc(r.period || '—')}</td>
          <td title="${UI.esc(r.staff_id)}">${UI.esc(r.staff_name || r.staff_id || '—')}</td>
          <td>${UI.esc(catLabel(r.category))}</td>
          <td class="num"><b>${H.n(r.amount)}</b></td>
          <td>${r.status === 'paid' ? '<span class="tag ok">已發放</span>'
              : overdue(r) ? '<span class="tag err">逾期未發</span>' : '<span class="tag warn">未發放</span>'}</td>
          <td>${UI.esc(r.due_date || '—')}</td>
          <td>${UI.esc((r.paid_at || '').slice(0, 16) || '—')}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${UI.esc(r.note || '')}</td>
          <td>${UI.esc(r.operator || '')}</td>
          <td>${UI.esc((r.created_at || '').slice(0, 16))}</td>
          <td>
            <button class="btn ${r.status === 'unpaid' ? 'ok' : 'secondary'} sm" data-pay="${r.id}">${
              r.status === 'unpaid' ? '標記已發' : '改回未發'}</button>
            <button class="btn sm" data-edit='${UI.esc(JSON.stringify(r))}'>編輯</button>
            <button class="btn danger sm" data-del="${r.id}">刪除</button>
          </td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">沒有符合條件的紀錄</div>';

    H.pager('pr', d.total, ST);

    view.querySelectorAll('[data-sort]').forEach(el => el.onclick = () => {
      const k = el.dataset.sort;
      if (ST.sort === k) ST.dir = ST.dir === 'asc' ? 'desc' : 'asc';
      else { ST.sort = k; ST.dir = 'desc'; }
      load();
    });
    const all = document.getElementById('pall');
    if (all) all.onchange = () => view.querySelectorAll('.pchk:not(:disabled)').forEach(c => { c.checked = all.checked; });

    view.querySelectorAll('[data-pay]').forEach(b => b.onclick = async () => {
      try { const r = await POST(`/payroll/${b.dataset.pay}/pay`); UI.ok(r.status === 'paid' ? '已標記發放' : '已改回未發放'); refresh(); }
      catch (e) { UI.err(e.message); }
    });
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('確定要刪除這筆記帳嗎？刪掉就找不回來了。')) return;
      await DEL('/payroll/' + b.dataset.del); UI.ok('已刪除'); refresh();
    });
    view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(JSON.parse(b.dataset.edit)));
  };

  const refresh = async () => { await load(); await loadStats(); };

  // ---------- 新增／編輯 ----------
  const catOptions = cur => (META.categories.length ? META.categories : [
    { key: 'salary', label: '薪資' }, { key: 'bonus', label: '獎金' }, { key: 'subsidy', label: '補貼' },
    { key: 'advance', label: '代墊款' }, { key: 'other', label: '其他' }
  ]).map(c => `<option value="${c.key}" ${c.key === cur ? 'selected' : ''}>${UI.esc(c.label)}</option>`).join('');

  const openForm = (r = null) => UI.modal({
    title: r ? `編輯記帳 #${r.id}` : '新增未發放薪資',
    okText: r ? '儲存' : '建立',
    bodyHTML: `
      <div class="row">
        <label class="f"><span>對象名稱</span><input name="staff_name" value="${UI.esc(r?.staff_name || '')}" placeholder="小雨"></label>
        <label class="f"><span>Discord ID（選填）</span><input name="staff_id" value="${UI.esc(r?.staff_id || '')}"></label>
      </div>
      <div class="row">
        <label class="f"><span>項目</span><select name="category">${catOptions(r?.category || 'salary')}</select></label>
        <label class="f"><span>歸屬月份</span><input name="period" type="month" value="${UI.esc(r?.period || H.thisMonth())}"></label>
      </div>
      <div class="row">
        <label class="f"><span>金額</span><input name="amount" type="number" value="${Number(r?.amount || 0)}"></label>
        <label class="f"><span>預計發放日（選填）</span><input name="due_date" type="date" value="${UI.esc(r?.due_date || '')}"></label>
      </div>
      <label class="f"><span>狀態</span><select name="status">
        <option value="unpaid" ${r?.status === 'paid' ? '' : 'selected'}>未發放</option>
        <option value="paid" ${r?.status === 'paid' ? 'selected' : ''}>已發放</option>
      </select></label>
      <label class="f"><span>備註</span><input name="note" value="${UI.esc(r?.note || '')}" placeholder="例：7 月結算尾款"></label>`,
    onOk: async back => {
      const body = {
        staff_name: UI.val(back, 'staff_name'), staff_id: UI.val(back, 'staff_id'),
        category: UI.val(back, 'category'), period: UI.val(back, 'period'),
        amount: Number(UI.val(back, 'amount')), due_date: UI.val(back, 'due_date'),
        status: UI.val(back, 'status'), note: UI.val(back, 'note')
      };
      if (r) await PUT('/payroll/' + r.id, body); else await POST('/payroll', body);
      UI.ok(r ? '已更新' : '已新增');
      refresh();
    }
  });

  // ---------- 版面 ----------
  view.innerHTML = `
    <div class="card"><div class="row">
      <div class="grow"><h3 style="margin:0">記帳 · 未發放薪資</h3>
        <div class="muted" style="font-size:12.5px">登錄還沒發出去的薪資、獎金、補貼與代墊款，發放後標記起來就好</div></div>
      <div class="fit"><button class="btn secondary" id="pbatch">批次標記已發放</button></div>
      <div class="fit"><button class="btn" id="padd">＋ 新增記帳</button></div>
    </div></div>
    <div class="grid c4" id="psum"></div>
    <div id="pcharts"><div class="card"><div class="empty">圖表載入中…</div></div></div>
    ${H.filters('pr', F, { exportPath: '/exports/payroll' })}
    <div class="card" id="ptable"><div class="empty">載入中…</div></div>`;

  const bind = H.bindFilters('pr', F, () => refresh(), ST, { exportPath: '/exports/payroll' });

  document.getElementById('padd').onclick = () => openForm();
  document.getElementById('pbatch').onclick = async () => {
    const ids = [...view.querySelectorAll('.pchk:checked')].map(c => Number(c.value));
    if (!ids.length) return UI.err('請先勾選要發放的紀錄');
    if (!await UI.confirm(`確定把勾選的 ${ids.length} 筆標記成「已發放」嗎？`, '確定發放', 'btn ok')) return;
    const r = await POST('/payroll/pay-batch', { ids });
    UI.ok(`已標記 ${r.updated} 筆`);
    refresh();
  };

  await refresh();
};
