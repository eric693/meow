// 交易流水帳：全欄位 CRUD、篩選器、匯出 CSV/Excel/PDF、歷史 CSV 匯入
// 欄位對齊公司既有匯出格式：訂單編號／交易時間／交易類型／經辦客服／金主名稱／陪玩名稱／
// 訂單原價／實收金額／陪玩抽成／伺服器淨利／狀態／備註

const LedgerState = {
  f: { month: '', from: '', to: '', kind: '', status: '', source: '', cs: '', customer: '', staff: '',
       min_amount: '', max_amount: '', q: '', sort: 'created_at', dir: 'desc' },
  page: 0, limit: 50, meta: null
};

Pages.orders = async view => {
  const S = LedgerState;
  const qs = extra => new URLSearchParams(
    Object.entries({ ...S.f, ...extra }).filter(([, v]) => v !== '' && v != null));

  const load = async () => {
    const d = await GET('/ledger?' + qs({ limit: S.limit, offset: S.page * S.limit }));
    S.meta = d;
    const sum = d.summary;
    document.getElementById('lsum').innerHTML = `
      ${H.stat('筆數', H.n(sum.cnt))}
      ${H.stat('訂單原價', H.n(sum.list))}
      ${H.stat('實收金額', H.n(sum.amount), { accent: true })}
      ${H.stat('陪玩抽成', H.n(sum.share))}
      ${H.stat('伺服器淨利', H.n(sum.net), { accent: true })}`;

    const th = (key, label, num) =>
      `<th class="${num ? 'num' : ''}" data-sort="${key}" style="cursor:pointer">${label}${
        S.f.sort === key ? (S.f.dir === 'asc' ? ' ▲' : ' ▼') : ''}</th>`;

    document.getElementById('ltable').innerHTML = d.rows.length ? `
      <div class="table-wrap"><table class="has-actions">
        <thead><tr>
          <th><input type="checkbox" id="lall" style="width:auto"></th>
          ${th('order_no', '訂單編號')}${th('created_at', '交易時間')}${th('kind', '交易類型')}
          <th>經辦客服</th><th>金主名稱</th><th>陪玩名稱</th>
          ${th('list_price', '訂單原價', 1)}${th('amount', '實收金額', 1)}
          ${th('staff_share', '陪玩抽成', 1)}${th('net', '伺服器淨利', 1)}
          ${th('status', '狀態')}<th>備註</th><th>操作</th>
        </tr></thead>
        <tbody>${d.rows.map(o => `<tr>
          <td><input type="checkbox" class="lchk" value="${o.order_no}" style="width:auto"
              ${o.status === 'pending' ? '' : 'disabled'}></td>
          <td><code>${UI.esc(o.order_no)}</code></td>
          <td>${H.esc(o.created_at)}</td>
          <td>${UI.esc(LedgerState.kindLabel(o.kind))}</td>
          <td>${UI.esc(o.cs_name || '')}</td>
          <td title="${UI.esc(o.customer_id)}">${UI.esc(o.customer_name || o.customer_id)}</td>
          <td title="${UI.esc(o.staff_id)}">${UI.esc(o.staff_name || o.staff_id)}</td>
          <td class="num">${H.n(o.list_price)}</td>
          <td class="num"><b>${H.n(o.amount)}</b></td>
          <td class="num">${H.n(o.staff_share)}</td>
          <td class="num">${H.n(o.net)}</td>
          <td>${H.statusTag(o.status)}</td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${UI.esc(o.note || '')}</td>
          <td>
            ${o.status === 'pending' ? `<button class="btn ok sm" data-settle="${o.order_no}">核銷</button> ` : ''}
            <button class="btn sm" data-edit='${UI.esc(JSON.stringify(o))}'>編輯</button>
            ${o.status !== 'refunded' ? `<button class="btn secondary sm" data-refund="${o.order_no}">退單</button> ` : ''}
            <button class="btn danger sm" data-del="${o.order_no}">刪除</button>
          </td></tr>`).join('')}</tbody>
      </table></div>` : '<div class="empty">沒有符合條件的交易紀錄</div>';

    // 分頁
    const pages = Math.ceil(d.total / S.limit) || 1;
    document.getElementById('lpage').innerHTML = `
      <button class="btn secondary sm" id="lprev" ${S.page === 0 ? 'disabled' : ''}>← 上一頁</button>
      <span class="muted">第 ${S.page + 1} / ${pages} 頁・共 ${H.n(d.total)} 筆</span>
      <button class="btn secondary sm" id="lnext" ${S.page + 1 >= pages ? 'disabled' : ''}>下一頁 →</button>
      <select id="llimit" style="width:auto">
        ${[25, 50, 100, 200, 500].map(n => `<option value="${n}" ${n === S.limit ? 'selected' : ''}>每頁 ${n} 筆</option>`).join('')}
      </select>`;
    document.getElementById('lprev').onclick = () => { S.page--; load(); };
    document.getElementById('lnext').onclick = () => { S.page++; load(); };
    document.getElementById('llimit').onchange = e => { S.limit = Number(e.target.value); S.page = 0; load(); };

    // 排序
    view.querySelectorAll('[data-sort]').forEach(el => el.onclick = () => {
      const k = el.dataset.sort;
      if (S.f.sort === k) S.f.dir = S.f.dir === 'asc' ? 'desc' : 'asc';
      else { S.f.sort = k; S.f.dir = 'desc'; }
      load();
    });

    // 全選
    const all = document.getElementById('lall');
    if (all) all.onchange = () => view.querySelectorAll('.lchk:not(:disabled)').forEach(c => { c.checked = all.checked; });

    // 操作
    view.querySelectorAll('[data-settle]').forEach(b => b.onclick = async () => {
      try { await POST(`/ledger/${b.dataset.settle}/settle`); UI.ok('核銷完成'); load(); }
      catch (e) { UI.err(e.message); }
    });
    view.querySelectorAll('[data-refund]').forEach(b => b.onclick = () => UI.modal({
      title: `退單／撤銷 ${b.dataset.refund}`, okText: '確定退單', okClass: 'btn danger',
      bodyHTML: `<label class="f"><span>原因</span><input name="reason" placeholder="選填"></label>
                 <div class="muted">會退還金主實收金額，並扣回陪玩抽成。</div>`,
      onOk: async back => {
        await POST(`/ledger/${b.dataset.refund}/refund`, { reason: UI.val(back, 'reason') });
        UI.ok('已退單'); load();
      }
    }));
    view.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm(`確定要「刪除」${b.dataset.del} 嗎？金額會整筆回沖，紀錄不保留。`)) return;
      await DEL('/ledger/' + b.dataset.del); UI.ok('已刪除'); load();
    });
    view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(JSON.parse(b.dataset.edit)));
  };

  // ---------- 新增／編輯表單 ----------
  const kindOptions = (cur) => (S.meta?.kinds || []).map(k =>
    `<option value="${k.key}" ${k.key === cur ? 'selected' : ''}>${UI.esc(k.label)}</option>`).join('');
  const statusOptions = (cur) => (S.meta?.statuses || []).map(k =>
    `<option value="${k.key}" ${k.key === cur ? 'selected' : ''}>${UI.esc(k.label)}</option>`).join('');

  const openForm = (o = null) => UI.modal({
    title: o ? `編輯交易 ${o.order_no}` : '新增交易',
    okText: o ? '儲存' : '建立',
    bodyHTML: `
      <div class="row">
        <label class="f"><span>交易類型</span><select name="kind">${kindOptions(o?.kind || 'order')}</select></label>
        <label class="f"><span>狀態</span>${o
          ? `<input value="${UI.esc({ pending: '暫存中', settled: '已核銷', refunded: '已退單/撤銷' }[o.status])}" disabled>`
          : `<select name="status">${statusOptions('pending')}</select>`}</label>
      </div>
      <label class="f"><span>交易時間</span><input name="created_at" value="${UI.esc(o?.created_at || '')}"
        placeholder="YYYY-MM-DD HH:MM:SS，留空=現在"></label>
      <div class="row">
        <label class="f"><span>金主 Discord ID</span><input name="customer_id" value="${UI.esc(o?.customer_id || '')}" ${o ? 'disabled' : ''}></label>
        <label class="f"><span>金主名稱</span><input name="customer_name" value="${UI.esc(o?.customer_name || '')}"></label>
      </div>
      <div class="row">
        <label class="f"><span>陪玩 Discord ID</span><input name="staff_id" value="${UI.esc(o?.staff_id || '')}" ${o ? 'disabled' : ''}></label>
        <label class="f"><span>陪玩名稱</span><input name="staff_name" value="${UI.esc(o?.staff_name || '')}"></label>
      </div>
      <div class="row">
        <label class="f"><span>經辦客服 ID</span><input name="cs_id" value="${UI.esc(o?.cs_id || '')}"></label>
        <label class="f"><span>經辦客服名稱</span><input name="cs_name" value="${UI.esc(o?.cs_name || '')}"></label>
      </div>
      <div class="row">
        <label class="f"><span>項目</span><input name="item" value="${UI.esc(o?.item || '')}"></label>
        <label class="f"><span>數量</span><input name="qty" type="number" step="0.5" value="${o?.qty ?? 1}"></label>
      </div>
      <div class="row">
        <label class="f"><span>訂單原價</span><input name="list_price" type="number" value="${o?.list_price ?? 0}"></label>
        <label class="f"><span>實收金額</span><input name="amount" type="number" value="${o?.amount ?? 0}"></label>
        <label class="f"><span>陪玩抽成</span><input name="staff_share" type="number" value="${o?.staff_share ?? ''}"
          placeholder="留空=依分潤成數自動計算"></label>
      </div>
      <label class="f"><span>備註</span><input name="note" value="${UI.esc(o?.note || '')}"></label>
      <div class="muted">伺服器淨利 = 實收金額 − 陪玩抽成，系統自動計算。${
        o ? '修改金額會同步調整金主錢包與陪玩薪資。' : '建立時會從金主雨幣餘額扣款。'}</div>`,
    onOk: async back => {
      const v = k => UI.val(back, k);
      const body = {
        kind: v('kind'), created_at: v('created_at') || null,
        customer_name: v('customer_name'), staff_name: v('staff_name'),
        cs_id: v('cs_id'), cs_name: v('cs_name'), item: v('item'),
        qty: Number(v('qty')) || 1,
        list_price: Number(v('list_price')) || 0,
        amount: Number(v('amount')),
        staff_share: v('staff_share') === '' ? null : Number(v('staff_share')),
        note: v('note')
      };
      if (o) await PUT('/ledger/' + o.order_no, body);
      else await POST('/ledger', {
        ...body, customer_id: v('customer_id'), staff_id: v('staff_id'), status: v('status')
      });
      UI.ok(o ? '已更新' : '已建立'); load();
    }
  });

  // ---------- 版面 ----------
  view.innerHTML = `
    <div class="card">
      <h3>結帳台</h3>
      <div class="muted" style="margin-bottom:10px">與 Discord 的 <code>/結帳</code> 同一套流程：可套用背包折價券、選擇付款方式，並把結帳明細發到指定頻道。</div>
      <div class="grid c3">
        <label class="f"><span>老闆 Discord ID</span><input id="ck_cust" placeholder="123456789012345678"></label>
        <label class="f"><span>陪玩（代號／藝名／ID）</span><input id="ck_staff" placeholder="lumi"></label>
        <label class="f"><span>服務項目</span><input id="ck_item" placeholder="娛樂4場"></label>
        <label class="f"><span>訂單原價</span><input id="ck_list" type="number" min="1"></label>
        <label class="f"><span>手動折讓</span><input id="ck_manual" type="number" value="0" min="0"></label>
        <label class="f"><span>背包折價券</span><select id="ck_coupon"><option value="">先填原價與老闆 ID</option></select></label>
        <label class="f"><span>結帳明細發到頻道</span><select id="ck_ch"><option value="">不發送，只建帳</option></select></label>
        <label class="f"><span>經辦客服 Discord ID（選填）</span><input id="ck_cs"></label>
        <label class="f"><span>備註</span><input id="ck_note"></label>
      </div>
      <div class="row" style="margin-top:8px">
        <div class="fit"><button class="btn ok" id="ck_cash">💸 現金 / 轉帳結帳</button></div>
        <div class="fit"><button class="btn" id="ck_coin">🪙 雨幣餘額扣款</button></div>
        <div class="grow muted" id="ck_hint" style="align-self:center"></div>
      </div>
    </div>

    <div class="card">
      <h3>特殊結帳與撤銷</h3>
      <div class="row">
        <div class="fit"><button class="btn secondary" data-sp="role">💳 身分組結帳</button></div>
        <div class="fit"><button class="btn secondary" data-sp="naming">🏷️ 伺服器冠名結帳</button></div>
        <div class="fit"><button class="btn secondary" data-sp="backfill">📒 補單</button></div>
        <div class="fit"><button class="btn secondary" data-sp="adjust">⚙️ 財務調整</button></div>
        <div class="fit"><button class="btn danger" id="ck_refund">🚫 退單／撤銷</button></div>
      </div>
    </div>

    <div class="card"><h3>篩選器</h3>
      <div class="row">
        <label class="f"><span>月份</span><input id="f_month" type="month" value="${S.f.month}"></label>
        <label class="f"><span>起始日</span><input id="f_from" type="date" value="${S.f.from}"></label>
        <label class="f"><span>結束日</span><input id="f_to" type="date" value="${S.f.to}"></label>
        <label class="f"><span>交易類型</span><select id="f_kind"><option value="">全部</option></select></label>
        <label class="f"><span>狀態</span><select id="f_status"><option value="">全部</option></select></label>
      </div>
      <div class="row">
        <label class="f"><span>經辦客服</span><input id="f_cs" value="${UI.esc(S.f.cs)}" placeholder="名稱或 ID"></label>
        <label class="f"><span>金主</span><input id="f_customer" value="${UI.esc(S.f.customer)}" placeholder="名稱或 ID"></label>
        <label class="f"><span>陪玩</span><input id="f_staff" value="${UI.esc(S.f.staff)}" placeholder="名稱或 ID"></label>
        <label class="f"><span>金額 ≥</span><input id="f_min" type="number" value="${S.f.min_amount}"></label>
        <label class="f"><span>金額 ≤</span><input id="f_max" type="number" value="${S.f.max_amount}"></label>
      </div>
      <div class="row">
        <label class="f"><span>關鍵字（訂單編號／項目／備註／姓名）</span><input id="f_q" value="${UI.esc(S.f.q)}"></label>
        <div class="fit"><button class="btn" id="f_go">套用篩選</button></div>
        <div class="fit"><button class="btn secondary" id="f_clear">清除</button></div>
      </div>
    </div>

    <div class="grid c4" id="lsum" style="margin-bottom:16px"></div>

    <div class="card"><div class="row">
      <div class="fit"><button class="btn" id="lnew">＋ 新增交易</button></div>
      <div class="fit"><button class="btn ok" id="lbulk">✅ 批次核銷勾選</button></div>
      <div class="grow"></div>
      <div class="fit"><button class="btn secondary" id="ex_csv">📄 匯出 CSV</button></div>
      <div class="fit"><button class="btn secondary" id="ex_xlsx">📊 匯出 Excel</button></div>
      <div class="fit"><button class="btn secondary" id="ex_pdf">📕 匯出 PDF</button></div>
      <div class="fit"><button class="btn secondary" id="l_import">📥 匯入歷史 CSV</button></div>
    </div>
    <div class="muted" style="margin-top:6px">匯出會套用目前的篩選條件，不受分頁限制。</div></div>

    <div class="card" id="ltable"><div class="empty">載入中…</div></div>
    <div class="row" id="lpage" style="align-items:center"></div>`;

  const apply = () => {
    S.f.month = document.getElementById('f_month').value;
    S.f.from = document.getElementById('f_from').value;
    S.f.to = document.getElementById('f_to').value;
    S.f.kind = document.getElementById('f_kind').value;
    S.f.status = document.getElementById('f_status').value;
    S.f.cs = document.getElementById('f_cs').value.trim();
    S.f.customer = document.getElementById('f_customer').value.trim();
    S.f.staff = document.getElementById('f_staff').value.trim();
    S.f.min_amount = document.getElementById('f_min').value;
    S.f.max_amount = document.getElementById('f_max').value;
    S.f.q = document.getElementById('f_q').value.trim();
    S.page = 0;
    load();
  };
  document.getElementById('f_go').onclick = apply;
  document.getElementById('f_q').onkeydown = e => { if (e.key === 'Enter') apply(); };
  document.getElementById('f_clear').onclick = () => {
    Object.assign(S.f, { month: '', from: '', to: '', kind: '', status: '', cs: '', customer: '',
                         staff: '', min_amount: '', max_amount: '', q: '' });
    App.reload();
  };

  document.getElementById('lnew').onclick = () => openForm(null);
  document.getElementById('lbulk').onclick = async () => {
    const nos = [...view.querySelectorAll('.lchk:checked')].map(c => c.value);
    if (!nos.length) return UI.err('請先勾選要核銷的訂單');
    if (!await UI.confirm(`確定要核銷勾選的 ${nos.length} 筆訂單嗎？`, '確定核銷', 'btn ok')) return;
    const r = await POST('/ledger/bulk/settle', { order_nos: nos });
    UI.ok(`已核銷 ${r.done} 筆${r.failed.length ? `，${r.failed.length} 筆失敗` : ''}`);
    load();
  };

  const exportAs = f => { location.href = '/api/exports/ledger?' + qs({ format: f }); };
  document.getElementById('ex_csv').onclick = () => exportAs('csv');
  document.getElementById('ex_xlsx').onclick = () => exportAs('xlsx');
  document.getElementById('ex_pdf').onclick = () => exportAs('pdf');

  document.getElementById('l_import').onclick = () => UI.modal({
    title: '匯入歷史流水帳 CSV', okText: '開始匯入',
    bodyHTML: `<label class="f"><span>選擇 CSV 檔</span><input type="file" name="file" accept=".csv,text/csv"></label>
      <label class="f"><input type="checkbox" name="dry" style="width:auto" checked> 先試算不寫入（確認筆數正確再取消勾選）</label>
      <div class="muted">支援欄位：訂單編號、交易時間、交易類型、經辦客服、金主名稱、陪玩名稱、
        訂單原價、實收金額、陪玩抽成、伺服器淨利、狀態、備註。<br>
        名稱找不到對應 Discord ID 時會自動以名稱建檔；匯入歷史資料<b>不會</b>變動目前的雨幣餘額。
        重複的訂單編號會自動略過。</div>`,
    onOk: async back => {
      const file = back.querySelector('[name="file"]').files[0];
      if (!file) { UI.err('請先選擇檔案'); return false; }
      const dry = back.querySelector('[name="dry"]').checked ? '1' : '0';
      const text = await file.text();
      const res = await fetch(`/api/ledger/import?dry=${dry}`, {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'text/csv', ...(window.CURRENT_GUILD ? { 'X-Guild-Id': window.CURRENT_GUILD } : {}) },
        body: text
      });
      const d = await res.json();
      if (!res.ok) { UI.err(d.error || '匯入失敗'); return false; }
      UI.ok(`${dry === '1' ? '試算' : '匯入'}完成：成功 ${d.ok} 筆、略過 ${d.skipped} 筆`);
      if (d.errors?.length) console.warn('匯入警告：', d.errors);
      if (dry === '0') load();
      return true;
    }
  });

  // 先載一次拿 kinds/statuses，再把下拉填好
  await load();
  const kSel = document.getElementById('f_kind'), sSel = document.getElementById('f_status');
  kSel.innerHTML = '<option value="">全部</option>' + (S.meta.kinds || [])
    .map(k => `<option value="${k.key}" ${k.key === S.f.kind ? 'selected' : ''}>${UI.esc(k.label)}</option>`).join('');
  sSel.innerHTML = '<option value="">全部</option>' + (S.meta.statuses || [])
    .map(k => `<option value="${k.key}" ${k.key === S.f.status ? 'selected' : ''}>${UI.esc(k.label)}</option>`).join('');

  // ---------- 結帳台 ----------
  const dcRes = await GET('/discord/resources').catch(() => ({ channels: [] }));
  const chOpts = dcRes.channels.map(c => `<option value="${c.id}">#${UI.esc(c.name)}</option>`).join('');
  document.getElementById('ck_ch').innerHTML = '<option value="">不發送，只建帳</option>' + chOpts;

  const refreshCoupons = async () => {
    const cust = document.getElementById('ck_cust').value.trim();
    const amount = Number(document.getElementById('ck_list').value) || 0;
    const sel = document.getElementById('ck_coupon');
    if (!cust || !amount) { sel.innerHTML = '<option value="">先填原價與老闆 ID</option>'; return; }
    const list = await GET('/checkout/coupons?' + new URLSearchParams({ customer_id: cust, amount }));
    sel.innerHTML = list.length
      ? '<option value="">不使用折價券</option>' +
        list.map(c => `<option value="${UI.esc(c.key)}">${UI.esc(c.label)}｜本單可折 ${H.n(c.discount)}</option>`).join('')
      : '<option value="">這位老闆沒有可用的券</option>';
  };
  document.getElementById('ck_cust').onchange = refreshCoupons;
  document.getElementById('ck_list').onchange = refreshCoupons;

  const doCheckout = async pay => {
    const r = await POST('/checkout', {
      customer_id: document.getElementById('ck_cust').value.trim(),
      staff: document.getElementById('ck_staff').value.trim(),
      item: document.getElementById('ck_item').value.trim(),
      list_price: Number(document.getElementById('ck_list').value),
      manual_discount: Number(document.getElementById('ck_manual').value) || 0,
      coupon_key: document.getElementById('ck_coupon').value,
      channel_id: document.getElementById('ck_ch').value,
      cs_id: document.getElementById('ck_cs').value.trim(),
      note: document.getElementById('ck_note').value.trim(),
      pay
    });
    UI.ok(`結帳完成 ${r.order.order_no}｜實付 ${H.n(r.order.amount)}${r.posted ? '，明細已發到頻道' : ''}`);
    document.getElementById('ck_hint').textContent =
      `${r.order.order_no}｜折抵 ${r.discount}｜實付 ${r.order.amount}｜陪玩分潤 ${r.order.staff_share}`;
    refreshCoupons(); S.page = 0; load();
  };
  document.getElementById('ck_cash').onclick = () => doCheckout('cash');
  document.getElementById('ck_coin').onclick = () => doCheckout('coin');

  // ---------- 特殊結帳 ----------
  const SPECIAL = {
    role:     { title: '身分組結帳', fields: ['customer_id', 'staff', 'item', 'amount'], hint: '完成後免核銷，分潤直接進可提領。' },
    naming:   { title: '伺服器冠名結帳', fields: ['customer_id', 'item', 'amount'], hint: '抽成 0，100% 進伺服器淨利。' },
    backfill: { title: '補單', fields: ['customer_id', 'staff', 'item', 'amount', 'created_at'], hint: '只補帳本，不動雨幣餘額與羈絆。' },
    adjust:   { title: '財務調整', fields: ['amount', 'note'], hint: '金額可為負數，用於平帳。' }
  };
  const FIELD = {
    customer_id: '<label class="f"><span>老闆 Discord ID</span><input name="customer_id"></label>',
    staff: '<label class="f"><span>陪玩（代號／藝名／ID）</span><input name="staff"></label>',
    item: '<label class="f"><span>項目</span><input name="item" placeholder="例：獨顯-週"></label>',
    amount: '<label class="f"><span>金額</span><input name="amount" type="number"></label>',
    created_at: '<label class="f"><span>日期（選填）</span><input name="created_at" type="date"></label>',
    note: '<label class="f"><span>原因</span><input name="note"></label>'
  };
  document.querySelectorAll('[data-sp]').forEach(b => b.onclick = () => {
    const type = b.dataset.sp, cfg = SPECIAL[type];
    const keys = cfg.fields.includes('note') ? cfg.fields : [...cfg.fields, 'note'];
    UI.modal({
      title: cfg.title,
      bodyHTML: keys.map(k => FIELD[k]).join('') + `<div class="muted">${cfg.hint}</div>`,
      onOk: async back => {
        const body = { type };
        keys.forEach(k => {
          const v = UI.val(back, k);
          if (v !== undefined && v !== '') body[k] = k === 'amount' ? Number(v) : v;
        });
        const r = await POST('/checkout/special', body);
        UI.ok(`已建立 ${r.order.order_no}`); load();
      }
    });
  });

  // ---------- 退單 ----------
  document.getElementById('ck_refund').onclick = () => UI.modal({
    title: '退單／撤銷',
    bodyHTML: `<label class="f"><span>訂單編號</span><input name="order_no" placeholder="ORD-12345678"></label>
      <label class="f"><span>原因</span><input name="reason"></label>
      <label class="f"><span>退還雨幣</span><select name="refund_coins">
        <option value="1">是（退錢給老闆）</option><option value="0">否（只撤單不退錢）</option></select></label>
      <label class="f"><span>撤銷通知發到頻道</span><select name="channel_id"><option value="">不發送</option>${chOpts}</select></label>`,
    onOk: async back => {
      await POST('/checkout/refund', {
        order_no: UI.val(back, 'order_no'), reason: UI.val(back, 'reason'),
        refund_coins: UI.val(back, 'refund_coins') === '1',
        channel_id: UI.val(back, 'channel_id')
      });
      UI.ok('已撤銷'); load();
    }
  });
};

LedgerState.kindLabel = k => {
  const m = (LedgerState.meta?.kinds || []).find(x => x.key === k);
  return m ? m.label : k;
};
