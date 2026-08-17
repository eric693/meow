// 頁面：禮物與親密度、背包、客服單與考核、投票與意見箱、報表、面板指令表、系統設定、帳號權限

// ---------------- 禮物與親密度 ----------------
Pages.gifts = async view => {
  const LOG = { offset: 0, limit: 50 }, INT = { offset: 0, limit: 50 };
  const logF = [
    { id: 'q', label: '關鍵字（禮物名／單號）', placeholder: '例：玫瑰 或 GFT-' },
    { id: 'customer_id', label: '老闆 Discord ID' },
    { id: 'staff_id', label: '陪玩 Discord ID' },
    { id: 'from', label: '起始日', type: 'date' },
    { id: 'to', label: '結束日', type: 'date' }
  ];
  const intF = [
    { id: 'q', label: '關鍵字（老闆／陪玩名稱）' },
    { id: 'staff_id', label: '陪玩 Discord ID' },
    { id: 'min', label: '羈絆點數 ≥', type: 'number' }
  ];

  const loadCat = async () => {
    const d = await GET('/gifts?limit=1');
    document.getElementById('gcat').innerHTML = H.table(
      ['', '代號', '名稱', { label: '價格', num: 1 }, { label: '親密度', num: 1 }, '狀態', '操作'],
      d.catalog.map(g => `<tr><td style="font-size:19px">${UI.esc(g.emoji)}</td><td><code>${UI.esc(g.key)}</code></td>
        <td>${UI.esc(g.name)}</td><td class="num">${H.n(g.price)}</td><td class="num">${H.n(g.intimacy)}</td>
        <td>${g.active ? '<span class="tag ok">上架</span>' : '<span class="tag err">下架</span>'}</td>
        <td><button class="btn sm" data-ge='${UI.esc(JSON.stringify(g))}'>編輯</button>
            <button class="btn danger sm" data-gd="${UI.esc(g.key)}">下架</button></td></tr>`));
    bindCat(d.catalog);
  };

  const loadLogs = async () => {
    const d = await GET('/gifts?' + new URLSearchParams({ ...logBind.values(), limit: LOG.limit, offset: LOG.offset }));
    H.pager('gl', d.total, LOG);
    document.getElementById('glog').innerHTML = H.table(
      ['時間', '單號', '老闆', '陪玩', '禮物', { label: '數量', num: 1 }, { label: '金額', num: 1 }, { label: '親密度', num: 1 }],
      d.rows.map(l => `<tr><td>${H.date(l.created_at)}</td><td><code>${UI.esc(l.order_no || '—')}</code></td>
        <td>${H.user(l.customer_id)}</td><td>${H.user(l.staff_id)}</td><td>${UI.esc(l.gift_name)}</td>
        <td class="num">${l.qty}</td><td class="num">${H.n(l.amount)}</td><td class="num">+${H.n(l.intimacy)}</td></tr>`));
  };

  const loadInti = async () => {
    const d = await GET('/intimacy?' + new URLSearchParams({ ...intBind.values(), limit: INT.limit, offset: INT.offset }));
    H.pager('gi', d.total, INT);
    document.getElementById('ginti').innerHTML = H.table(
      ['老闆', '陪玩', { label: '羈絆點數', num: 1 }, '更新時間', '操作'],
      d.rows.map(i => `<tr><td>${H.user(i.customer_id, i.customer_name)}</td>
        <td>${H.user(i.staff_id, i.staff_name)}</td><td class="num"><b>${H.n(i.points)}</b></td>
        <td>${H.date(i.updated_at)}</td>
        <td><button class="btn sm" data-ia="${i.customer_id}|${i.staff_id}">調整</button></td></tr>`));
    document.querySelectorAll('[data-ia]').forEach(b => b.onclick = () => {
      const [cid, sid] = b.dataset.ia.split('|');
      UI.modal({
        title: '親密度調整',
        bodyHTML: `<label class="f"><span>異動點數（正加負減）</span><input name="delta" type="number"></label>
          <div class="muted">歸零時該 CP 的歷史禮物紀錄會同步清除。</div>`,
        onOk: async back => {
          const r = await POST('/intimacy/adjust', { customer_id: cid, staff_id: sid, delta: Number(UI.val(back, 'delta')) });
          UI.ok(`已調整，目前 ${H.n(r.points)}（${r.rank.name}）`); loadInti();
        }
      });
    });
  };

  const giftForm = g => `
    <div class="row">
      <label class="f"><span>代號</span><input name="key" value="${UI.esc(g?.key || '')}" ${g ? 'readonly' : ''}></label>
      <label class="f"><span>Emoji</span><input name="emoji" value="${UI.esc(g?.emoji || '🎁')}"></label>
    </div>
    <label class="f"><span>名稱</span><input name="name" value="${UI.esc(g?.name || '')}"></label>
    <div class="row">
      <label class="f"><span>價格（雨幣）</span><input name="price" type="number" value="${g?.price || 0}"></label>
      <label class="f"><span>單份親密度</span><input name="intimacy" type="number" value="${g?.intimacy || 0}"></label>
      <label class="f"><span>排序</span><input name="sort" type="number" value="${g?.sort || 0}"></label>
    </div>
    <div class="muted">送禮的親密度依實付金額計算（後台「結帳親密度成數」），此欄僅作參考。</div>`;

  const saveGift = async back => {
    await POST('/gifts', {
      key: UI.val(back, 'key'), emoji: UI.val(back, 'emoji'), name: UI.val(back, 'name'),
      price: Number(UI.val(back, 'price')), intimacy: Number(UI.val(back, 'intimacy')),
      sort: Number(UI.val(back, 'sort'))
    });
    UI.ok('已儲存'); loadCat();
  };

  const bindCat = catalog => {
    document.querySelectorAll('[data-ge]').forEach(b => b.onclick = () =>
      UI.modal({ title: '編輯禮物款式', bodyHTML: giftForm(JSON.parse(b.dataset.ge)), onOk: saveGift }));
    document.querySelectorAll('[data-gd]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('確定要下架這個禮物款式嗎？')) return;
      await DEL('/gifts/' + encodeURIComponent(b.dataset.gd)); UI.ok('已下架'); loadCat();
    });
    document.getElementById('gsend').onclick = () => UI.modal({
      title: '代送禮物',
      bodyHTML: `<label class="f"><span>老闆 Discord ID</span><input name="customerId"></label>
        <label class="f"><span>陪玩 Discord ID</span><input name="staffId"></label>
        <label class="f"><span>禮物款式</span><select name="giftKey">
          ${catalog.filter(g => g.active).map(g => `<option value="${UI.esc(g.key)}">${UI.esc(g.emoji + ' ' + g.name)}（${H.n(g.price)}）</option>`).join('')}
        </select></label>
        <label class="f"><span>數量</span><input name="qty" type="number" value="1" min="1"></label>`,
      onOk: async back => {
        const r = await POST('/gifts/send', {
          customerId: UI.val(back, 'customerId'), staffId: UI.val(back, 'staffId'),
          giftKey: UI.val(back, 'giftKey'), qty: Number(UI.val(back, 'qty'))
        });
        UI.ok(`送出成功，親密度 +${H.n(r.gain)}`); loadCat(); loadLogs(); loadInti();
      }
    });
  };

  view.innerHTML = `
    <div class="card"><div class="row"><div class="grow"></div>
      <div class="fit"><button class="btn secondary" id="gsend">🎁 代送禮物</button></div>
      <div class="fit"><button class="btn" id="gnew">＋ 新增款式</button></div></div></div>
    <div class="card"><h3>禮物款式</h3><div id="gcat"><div class="empty">載入中…</div></div></div>
    <div class="card"><h3>親密度排行（CP）</h3></div>
    ${H.filters('gi', intF)}
    <div class="card"><div id="ginti"><div class="empty">載入中…</div></div></div>
    <div class="card"><h3>送禮紀錄</h3></div>
    ${H.filters('gl', logF)}
    <div class="card"><div id="glog"><div class="empty">載入中…</div></div></div>`;

  const logBind = H.bindFilters('gl', logF, () => loadLogs(), LOG);
  const intBind = H.bindFilters('gi', intF, () => loadInti(), INT);
  document.getElementById('gnew').onclick = () =>
    UI.modal({ title: '新增禮物款式', bodyHTML: giftForm(null), onOk: saveGift });
  loadCat(); loadLogs(); loadInti();
};

// ---------------- 背包 ----------------
Pages.backpack = async view => {
  const ST = { offset: 0, limit: 50 };
  const F = [
    { id: 'q', label: '關鍵字（名稱／代號）' },
    { id: 'user_id', label: '對象 Discord ID' },
    { id: 'type', label: '類型', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'coupon', t: '折價券' }, { v: 'item', t: '一般道具' }] },
    { id: 'expiring', label: '即將到期（7 天內）', type: 'select',
      options: [{ v: '', t: '不限' }, { v: '1', t: '只看即將到期' }] }
  ];
  const load = async () => {
    const d = await GET('/backpack?' + new URLSearchParams({ ...bind.values(), limit: ST.limit, offset: ST.offset }));
    H.pager('bk', d.total, ST);
    document.getElementById('kt').innerHTML = H.table(
      ['選取', '對象', '道具代號', '名稱',
       { label: '數量', num: 1 }, { label: '面額', num: 1 },
       { label: '折扣', num: 1 }, { label: '門檻', num: 1 }, '到期', '操作'],
      d.rows.map(r => `<tr>
        <td><input type="checkbox" class="kchk" value="${r.id}" style="width:auto"></td>
        <td>${H.user(r.user_id)}</td><td><code>${UI.esc(r.item_key)}</code></td>
        <td>${UI.esc(r.name)}</td><td class="num">${r.qty}</td>
        <td class="num">${r.value ? H.n(r.value) : '—'}</td>
        <td class="num">${r.percent ? r.percent + '%' : '—'}</td>
        <td class="num">${r.min_spend ? H.n(r.min_spend) : '—'}</td><td>${UI.esc(r.expires || '—')}</td>
        <td><button class="btn secondary sm" data-kminus='${UI.esc(JSON.stringify({ id: r.id, name: r.name, qty: r.qty }))}'>扣張數</button>
            <button class="btn danger sm" data-kd="${r.id}">刪除</button></td></tr>`));


    document.querySelectorAll('[data-kd]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('確定要刪除這筆道具嗎？整列（含全部張數）都會消失。')) return;
      await DEL('/backpack/' + b.dataset.kd); UI.ok('已刪除'); load();
    });
    // 只扣掉幾張，扣到 0 就整列刪掉
    document.querySelectorAll('[data-kminus]').forEach(b => b.onclick = () => {
      const it = JSON.parse(b.dataset.kminus);
      UI.modal({
        title: `扣除張數：${it.name}`, okText: '扣除',
        bodyHTML: `<div class="muted" style="margin-bottom:8px">目前持有 ${it.qty} 張，扣完剩 0 張時整列會自動刪掉。</div>
          <label class="f"><span>要扣幾張</span><input name="minus" type="number" min="1" max="${it.qty}" value="1"></label>`,
        onOk: async back => {
          const n = Number(UI.val(back, 'minus'));
          if (!(n > 0)) throw new Error('請填大於 0 的張數');
          const r = await PUT('/backpack/' + it.id, { minus: n });
          UI.ok(r.removed ? '已扣光並移除' : `已扣除，剩 ${r.qty} 張`);
          load();
        }
      });
    });
  };

  view.innerHTML = `
    <div class="card"><div class="row"><div class="grow"><h3 style="margin:0">背包與折價券</h3></div>
      <div class="fit"><label class="f" style="flex-direction:row;align-items:center;gap:6px;margin:0">
        <input type="checkbox" id="kall" style="width:auto"><span style="margin:0">全選</span></label></div>
      <div class="fit"><button class="btn danger" id="kbatch">批次刪除</button></div>
      <div class="fit"><button class="btn" id="kadd">＋ 發放道具／折價券</button></div></div></div>
    ${H.filters('bk', F)}
    <div class="card" id="kt"><div class="empty">載入中…</div></div>`;

  const bind = H.bindFilters('bk', F, () => load(), ST);
  document.getElementById('kall').onchange = e =>
    document.querySelectorAll('.kchk').forEach(c => { c.checked = e.target.checked; });
  document.getElementById('kbatch').onclick = async () => {
    const ids = [...document.querySelectorAll('.kchk:checked')].map(c => Number(c.value));
    if (!ids.length) return UI.err('請先勾選要刪除的道具');
    if (!await UI.confirm(`確定要刪除勾選的 ${ids.length} 列道具嗎？每列的全部張數都會消失。`)) return;
    const r = await POST('/backpack/delete-batch', { ids });
    UI.ok(`已刪除 ${r.deleted} 列、共 ${r.qty} 張`);
    load();
  };
  document.getElementById('kadd').onclick = () => UI.modal({
    title: '發放道具／折價券',
    bodyHTML: `<label class="f"><span>對象 Discord ID</span><input name="user_id"></label>
      <div class="row">
        <label class="f"><span>道具代號</span><input name="key" placeholder="coupon100"></label>
        <label class="f"><span>名稱</span><input name="name" placeholder="百元折價券"></label>
      </div>
      <div class="row">
        <label class="f"><span>數量</span><input name="qty" type="number" value="1"></label>
        <label class="f"><span>折價券面額（非折價券填 0）</span><input name="value" type="number" value="0"></label>
      </div>
      <div class="row">
        <label class="f"><span>折扣百分比（95 折填 5，非折扣券填 0）</span><input name="percent" type="number" value="0"></label>
        <label class="f"><span>最低消費門檻（無門檻填 0）</span><input name="min_spend" type="number" value="0"></label>
      </div>
      <label class="f"><span>到期日（選填）</span><input name="expires" type="date"></label>`,
    onOk: async back => {
      await POST('/backpack', {
        user_id: UI.val(back, 'user_id'), key: UI.val(back, 'key'), name: UI.val(back, 'name'),
        qty: Number(UI.val(back, 'qty')), value: Number(UI.val(back, 'value')),
        percent: Number(UI.val(back, 'percent')), min_spend: Number(UI.val(back, 'min_spend')),
        expires: UI.val(back, 'expires') || null
      });
      UI.ok('已發放'); load();
    }
  });
  load();
};

// ---------------- 客服單與考核 ----------------
Pages.tickets = async view => {
  const TK = { offset: 0, limit: 50 }, EX = { offset: 0, limit: 50 };
  const tkF = [
    { id: 'q', label: '關鍵字（單號／服務類型）' },
    { id: 'status', label: '狀態', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'open', t: '待處理' }, { v: 'claimed', t: '已接單' }, { v: 'closed', t: '已結束' }] },
    { id: 'publish', label: '發布狀態', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'draft', t: '尚未發布' }, { v: 'public', t: '公開單' }, { v: 'anon', t: '匿名單' }] },
    { id: 'customer_id', label: '開單者 Discord ID' },
    { id: 'from', label: '起始日', type: 'date' },
    { id: 'to', label: '結束日', type: 'date' }
  ];
  const exF = [
    { id: 'q', label: '關鍵字（暱稱／項目／分級）' },
    { id: 'status', label: '狀態', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'open', t: '進行中' }, { v: 'passed', t: '通過' }, { v: 'failed', t: '未通過' }, { v: 'closed', t: '已關閉' }] }
  ];

  const loadTk = async () => {
    const d = await GET('/tickets?' + new URLSearchParams({ ...tkBind.values(), limit: TK.limit, offset: TK.offset }));
    H.pager('tk', d.total, TK);
    document.getElementById('tt').innerHTML = H.table(
      ['#', '單號', '服務', '開單者', '客服', '狀態', '發布', '建立時間', '操作'],
      d.rows.map(t => `<tr><td>${t.id}</td><td>${t.seq ? `<code>${t.seq}</code>` : '—'}</td>
        <td>${UI.esc(t.service || t.subject || t.kind)}</td>
        <td>${H.user(t.customer_id)}</td><td>${H.user(t.cs_id)}</td><td>${H.statusTag(t.status)}</td>
        <td>${t.publish === 'anon' ? '<span class="tag warn">匿名</span>'
             : t.publish === 'public' ? '<span class="tag">公開</span>' : '<span class="tag err">未發布</span>'}</td>
        <td>${H.date(t.created_at)}</td>
        <td>${t.status !== 'closed' ? `<button class="btn danger sm" data-tc="${t.id}">結束</button>` : ''}</td></tr>`));
    document.querySelectorAll('[data-tc]').forEach(b => b.onclick = async () => {
      await POST(`/tickets/${b.dataset.tc}/close`); UI.ok('已結束'); loadTk();
    });
  };

  const loadEx = async () => {
    const d = await GET('/exams?' + new URLSearchParams({ paged: 1, ...exBind.values(), limit: EX.limit, offset: EX.offset }));
    H.pager('ex', d.total, EX);
    document.getElementById('et').innerHTML = H.table(
      ['#', '報名者', '考試項目', '分級', '性別', '狀態', '時間', '操作'],
      d.rows.map(e => `<tr><td>${e.id}</td><td>${H.user(e.user_id, e.nickname)}</td>
        <td>${UI.esc(e.subject || e.skills || '—')}</td><td>${UI.esc(e.grade || '—')}</td>
        <td>${UI.esc(e.gender || e.age || '—')}</td><td>${H.statusTag(e.status)}</td>
        <td>${H.date(e.created_at)}</td>
        <td><button class="btn ok sm" data-ep="${e.id}">通過</button>
            <button class="btn danger sm" data-ef="${e.id}">不通過</button></td></tr>`));
    document.querySelectorAll('[data-ep]').forEach(b => b.onclick = async () => {
      await PUT('/exams/' + b.dataset.ep, { status: 'passed' }); UI.ok('已標記通過'); loadEx();
    });
    document.querySelectorAll('[data-ef]').forEach(b => b.onclick = async () => {
      await PUT('/exams/' + b.dataset.ef, { status: 'failed' }); UI.ok('已標記不通過'); loadEx();
    });
  };

  view.innerHTML = `
    <div class="card"><h3>客服單 / 派單</h3></div>
    ${H.filters('tk', tkF)}
    <div class="card"><div id="tt"><div class="empty">載入中…</div></div></div>
    <div class="card"><h3>考核報名</h3></div>
    ${H.filters('ex', exF)}
    <div class="card"><div id="et"><div class="empty">載入中…</div></div></div>`;

  const tkBind = H.bindFilters('tk', tkF, () => loadTk(), TK);
  const exBind = H.bindFilters('ex', exF, () => loadEx(), EX);
  loadTk(); loadEx();
};

// ---------------- 投票與意見箱 ----------------
Pages.polls = async view => {
  const SG = { offset: 0, limit: 50 }, ST = { offset: 0, limit: 50 };
  const mk = kind => ([
    { id: 'q', label: '關鍵字（內容）' },
    { id: 'handled', label: '處理狀態', type: 'select',
      options: [{ v: '', t: '全部' }, { v: '0', t: '待處理' }, { v: '1', t: '已處理' }] },
    { id: 'from', label: '起始日', type: 'date' },
    { id: 'to', label: '結束日', type: 'date' }
  ]);
  const sgF = mk('public'), stF = mk('staff');

  const sugTable = rows => H.table(['時間', '填表人', '回饋內容', '狀態', '操作'],
    rows.map(s => `<tr><td>${H.date(s.created_at)}</td>
      <td>${s.name ? UI.esc(s.name) : '<span class="muted">匿名用戶</span>'}</td>
      <td style="white-space:normal;max-width:460px">${UI.esc(s.content)}</td>
      <td>${s.handled ? '<span class="tag ok">已處理</span>' : '<span class="tag warn">待處理</span>'}</td>
      <td><button class="btn sm" data-sh="${s.id}" data-v="${s.handled ? 0 : 1}">${s.handled ? '標記未處理' : '標記已處理'}</button></td></tr>`),
    '尚無投稿');

  const bindHandled = reload => document.querySelectorAll('[data-sh]').forEach(b => b.onclick = async () => {
    await PUT('/suggestions/' + b.dataset.sh, { handled: Number(b.dataset.v) }); reload();
  });

  const loadSug = async () => {
    const d = await GET('/suggestions?' + new URLSearchParams({ kind: 'public', ...sgBind.values(), limit: SG.limit, offset: SG.offset }));
    H.pager('sg', d.total, SG);
    document.getElementById('sg').innerHTML = sugTable(d.rows);
    bindHandled(loadSug);
  };
  const loadStaffSug = async () => {
    const d = await GET('/suggestions?' + new URLSearchParams({ kind: 'staff', ...stBind.values(), limit: ST.limit, offset: ST.offset }));
    H.pager('st', d.total, ST);
    document.getElementById('sgs').innerHTML = sugTable(d.rows);
    bindHandled(loadStaffSug);
  };

  const loadPolls = async () => {
    const ps = await GET('/polls');
    document.getElementById('pl').innerHTML = ps.length ? ps.map(p => {
      const total = Object.values(p.votes).reduce((a, b) => a + b, 0);
      return `<div class="card"><h3>${UI.esc(p.title)} ${p.closed ? '<span class="tag err">已結束</span>' : ''}</h3>
        ${p.options.map((o, i) => {
          const c = p.votes[i] || 0, pct = total ? Math.round(c / total * 100) : 0;
          return `<div style="margin:6px 0"><div style="display:flex;justify-content:space-between;font-size:14px">
            <span>${UI.esc(o)}</span><span class="muted">${c} 票（${pct}%）</span></div>
            <div style="height:8px;background:var(--panel-2);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--brand)"></div></div></div>`;
        }).join('')}
        <div class="muted" style="margin-top:8px">共 ${total} 票・${H.date(p.created_at)}
          ${p.closed ? '' : `<button class="btn danger sm" data-pc="${p.id}" style="margin-left:8px">結束投票</button>`}</div></div>`;
    }).join('') : '<div class="card"><div class="empty">尚無投票（可到「面板與公告」頁發布）</div></div>';
    document.querySelectorAll('[data-pc]').forEach(b => b.onclick = async () => {
      await POST(`/polls/${b.dataset.pc}/close`); UI.ok('已結束'); loadPolls();
    });
  };

  // ---- 喚雨星象：每日抽籤獎池 ----
  const prizeRow = p => `<tr data-lp="${p.id}">
    <td><input value="${UI.esc(p.emoji || '')}" data-f="emoji" style="width:46px"></td>
    <td><input value="${UI.esc(p.name)}" data-f="name" style="width:90px"></td>
    <td><select data-f="type">
      <option value="fortune" ${p.type === 'fortune' ? 'selected' : ''}>純籤詩</option>
      <option value="coupon" ${p.type === 'coupon' ? 'selected' : ''}>發折價券</option>
    </select></td>
    <td><input type="number" value="${p.value}" data-f="value" style="width:70px"></td>
    <td><input type="number" value="${p.percent}" data-f="percent" style="width:60px"></td>
    <td><input type="number" value="${p.min_spend}" data-f="min_spend" style="width:70px"></td>
    <td><input type="number" value="${p.expire_days}" data-f="expire_days" style="width:60px"></td>
    <td><input value="${UI.esc(p.text || '')}" data-f="text" style="width:260px"></td>
    <td><input type="number" value="${p.weight}" data-f="weight" style="width:60px"></td>
    <td class="num">${p.chance}%</td>
    <td><input type="checkbox" data-f="enabled" ${p.enabled ? 'checked' : ''}></td>
    <td><button class="btn sm" data-lps="${p.id}">儲存</button>
        <button class="btn danger sm" data-lpd="${p.id}">刪除</button></td></tr>`;

  const readRow = tr => {
    const o = {};
    tr.querySelectorAll('[data-f]').forEach(el => {
      o[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value;
    });
    return o;
  };

  const loadLottery = async () => {
    const d = await GET('/lottery/prizes');
    document.getElementById('lp').innerHTML =
      H.table(['圖示', '籤名', '類型', '折抵', '折扣%', '低消', '有效天', '籤詩', '權重', '機率', '啟用', '操作'],
              d.rows.map(prizeRow), '尚無獎項')
      + `<div class="muted" style="margin-top:8px">機率＝該項權重 ÷ 所有啟用項權重總和。「發折價券」才會用到折抵／折扣／低消／有效天；折抵與折扣二擇一。今日已抽 ${d.draws_today} 次。</div>`;
    document.querySelectorAll('[data-lps]').forEach(b => b.onclick = async () => {
      await PUT('/lottery/prizes/' + b.dataset.lps, readRow(b.closest('tr')));
      UI.ok('已儲存'); loadLottery();
    });
    document.querySelectorAll('[data-lpd]').forEach(b => b.onclick = async () => {
      if (!confirm('確定刪除這個獎項？')) return;
      await DEL('/lottery/prizes/' + b.dataset.lpd); UI.ok('已刪除'); loadLottery();
    });
  };

  view.innerHTML = `<div id="pl"></div>
    <div class="card"><h3>🔮 喚雨星象・每日抽籤獎池</h3>
      <div id="lp"><div class="empty">載入中…</div></div>
      <button class="btn sm" id="lpAdd" style="margin-top:10px">＋ 新增獎項</button></div>
    <div class="card"><h3>意見投訴與建議箱</h3></div>
    ${H.filters('sg', sgF)}
    <div class="card"><div id="sg"><div class="empty">載入中…</div></div></div>
    <div class="card"><h3>員工輔導室</h3></div>
    ${H.filters('st', stF)}
    <div class="card"><div id="sgs"><div class="empty">載入中…</div></div></div>`;

  document.getElementById('lpAdd').onclick = async () => {
    await POST('/lottery/prizes', { name: '新籤', emoji: '🔮', type: 'fortune', weight: 10, enabled: 1 });
    loadLottery();
  };

  const sgBind = H.bindFilters('sg', sgF, () => loadSug(), SG);
  const stBind = H.bindFilters('st', stF, () => loadStaffSug(), ST);
  loadPolls(); loadSug(); loadStaffSug(); loadLottery();
};

// ---------------- 報表與匯出 ----------------
Pages.reports = async view => {
  const load = async () => {
    const month = document.getElementById('rm').value || H.thisMonth();
    const from = document.getElementById('rf').value, to = document.getElementById('rt').value;
    const d = await GET('/reports/summary?' + new URLSearchParams({ month, from, to }));
    const f = d.finance;
    document.getElementById('rbody').innerHTML = `
      <div class="grid c4" style="margin-bottom:16px">
        ${H.stat('訂單原價合計', H.n(f.list_price))}
        ${H.stat('實收金額', H.n(f.revenue), { accent: true })}
        ${H.stat('折扣讓利', '-' + H.n(f.discount))}
        ${H.stat('陪玩抽成', '-' + H.n(f.staff_share))}
        ${H.stat('伺服器淨利', H.n(f.net), { accent: true })}
        ${H.stat('其中禮物營收', H.n(f.gift_revenue), { small: true })}
        ${H.stat('退單／撤銷', '-' + H.n(f.refund) + `（${f.refund_count}）`, { small: true })}
        ${H.stat('暫存中未核銷', H.n(f.pending) + `（${f.pending_count}）`, { small: true })}
        ${H.stat('本月已提領', H.n(f.withdrawn), { small: true })}
        ${H.stat('交易筆數', H.n(f.order_count), { small: true })}
      </div>
      <div class="grid c2">
        ${Chart.card('各交易類型佔比',
          Chart.donut(f.by_kind.map(k => ({ label: k.label, amount: k.a })), { height: 230 }), month)}
        ${Chart.card('金流組成', Chart.hbar([
          { label: '訂單原價', amount: f.list_price }, { label: '實收金額', amount: f.revenue },
          { label: '陪玩抽成', amount: f.staff_share }, { label: '伺服器淨利', amount: f.net },
          { label: '退單／撤銷', amount: f.refund }, { label: '已提領', amount: f.withdrawn }
        ], { color: 'var(--c1)' }), month)}
        ${Chart.card('陪玩業績排行',
          Chart.hbar(d.staff.filter(s => s.amount > 0).slice(0, 8)
            .map(s => ({ label: s.name || s.code, amount: s.amount })), { color: 'var(--c2)' }), month)}
        ${Chart.card('金主消費排行',
          Chart.hbar(d.spend.month.slice(0, 8)
            .map(c => ({ label: c.name || c.user_id, amount: c.amount })), { color: 'var(--c4)' }), month)}
      </div>
      <div class="card"><h3>各交易類型明細</h3>
        ${H.table(['交易類型', { label: '筆數', num: 1 }, { label: '實收金額', num: 1 },
                   { label: '伺服器淨利', num: 1 }, { label: '佔比', num: 1 }],
          f.by_kind.map(k => `<tr><td>${UI.esc(k.label)}</td><td class="num">${k.c}</td>
            <td class="num">${H.n(k.a)}</td><td class="num">${H.n(k.net)}</td>
            <td class="num">${f.revenue ? Math.round(k.a / f.revenue * 100) : 0}%</td></tr>`), '本月沒有交易')}
      </div>
      <div class="card"><h3>${UI.esc(month)} 陪玩業績結算</h3>
        ${H.table(['#', '代號', '藝名', { label: '業績', num: 1 }, { label: '單數', num: 1 },
                   { label: '抽成', num: 1 }, { label: '公司淨利', num: 1 },
                   { label: '可提領', num: 1 }, { label: '暫存', num: 1 }],
          d.staff.map((s, i) => `<tr><td>${i + 1}</td><td>${UI.esc(s.code)}</td><td>${UI.esc(s.name)}</td>
            <td class="num"><b>${H.n(s.amount)}</b></td><td class="num">${s.cnt}</td>
            <td class="num">${H.n(s.share)}</td><td class="num">${H.n(s.net)}</td>
            <td class="num">${H.n(s.income)}</td><td class="num">${H.n(s.pending_income)}</td></tr>`), '本月沒有業績')}
      </div>
      <div class="grid c2">
        <div class="card"><h3>歷史 VIP 總榜</h3>
          ${H.table(['#', '金主', { label: '歷史總消費', num: 1 }, 'VIP 等級'],
            d.spend.history.map((c, i) => `<tr><td>${i + 1}</td><td>${H.user(c.user_id, c.name)}</td>
              <td class="num">${H.n(c.total_spend)}</td><td><span class="tag">${UI.esc(c.vip_name)}</span></td></tr>`))}
        </div>
        <div class="card"><h3>本月消費大戶</h3>
          ${H.table(['#', '金主', { label: '本月消費', num: 1 }],
            d.spend.month.map((c, i) => `<tr><td>${i + 1}</td><td>${H.user(c.user_id, c.name)}</td>
              <td class="num">${H.n(c.amount)}</td></tr>`))}
        </div>
      </div>
      <div class="grid c2">
        <div class="card"><h3>客服接單傳票排行${from || to ? `（${from || '不限'} ~ ${to || '今天'}）` : ''}</h3>
          ${H.table(['#', '客服', { label: '接單數', num: 1 }],
            d.cs.tickets.map((c, i) => `<tr><td>${i + 1}</td><td>${H.user(c.cs_id)}</td>
              <td class="num">${c.cnt}</td></tr>`))}
          <button class="btn danger sm" id="csclr" style="margin-top:10px">清空客服業績紀錄</button>
        </div>
        <div class="card"><h3>客服經辦成交金額</h3>
          ${H.table(['#', '客服', { label: '筆數', num: 1 }, { label: '成交金額', num: 1 }],
            d.cs.orders.map((c, i) => `<tr><td>${i + 1}</td><td>${UI.esc(c.cs_name || c.cs_id)}</td>
              <td class="num">${c.cnt}</td><td class="num">${H.n(c.amount)}</td></tr>`))}
        </div>
      </div>`;
    document.getElementById('csclr').onclick = async () => {
      if (!await UI.confirm('確定要清空所有客服獨立業績紀錄嗎？此動作無法復原。')) return;
      const r = await DEL('/reports/cs'); UI.ok(`已清空 ${r.deleted} 筆`); load();
    };
  };

  // 每份報表都給 CSV / Excel / PDF 三顆按鈕
  const expGroup = (label, path) => `
    <div class="card" style="margin-bottom:10px">
      <div class="row" style="align-items:center">
        <div><b>${UI.esc(label)}</b></div>
        <div class="grow"></div>
        ${['csv', 'xlsx', 'pdf'].map(fmt => `<div class="fit">
          <button class="btn secondary sm" data-exp="${path}" data-fmt="${fmt}">
            ${{ csv: '📄 CSV', xlsx: '📊 Excel', pdf: '📕 PDF' }[fmt]}</button></div>`).join('')}
      </div>
    </div>`;

  view.innerHTML = `
    <div class="card"><div class="row">
      <label class="f"><span>報表月份</span><input id="rm" type="month" value="${H.thisMonth()}"></label>
      <label class="f"><span>客服業績起</span><input id="rf" type="date"></label>
      <label class="f"><span>客服業績迄</span><input id="rt" type="date"></label>
      <div class="fit"><button class="btn" id="rgo">查詢</button></div>
    </div></div>
    <div class="card"><h3>檔案匯出（依上方月份）</h3>
      ${expGroup('財務流水帳（全欄位交易明細）', 'ledger')}
      ${expGroup('金主消費總表（排名／歷史／本月／VIP）', 'patrons')}
      ${expGroup('陪玩業績結算表', 'staff')}
      ${expGroup('陪玩提領薪資明細', 'withdrawals')}
      <div class="muted">流水帳若要套用更細的篩選（客服、金主、金額區間…），請到「交易流水帳」頁匯出。</div>
    </div>
    <div id="rbody"><div class="empty">載入中…</div></div>`;

  view.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => {
    const month = document.getElementById('rm').value || H.thisMonth();
    location.href = `/api/exports/${b.dataset.exp}?` + new URLSearchParams({ month, format: b.dataset.fmt });
  });
  document.getElementById('rgo').onclick = load;
  load();
};

// ---------------- 面板指令表 ----------------
const PANEL_DOC = [
  ['⚙️ 面板建置（管理員，於目標頻道輸入）', [
    ['!sendrole', '召喚身分組領取面板（老闆／雨滴分組領取）'],
    ['!sendorder', '發送「喚雨下單前提醒」的靜態圖文說明面板'],
    ['!setup-ticket', '建立「開始下單」派單接待大廳面板'],
    ['!setup-report', '建立「自主報單系統」面板（一般通道）'],
    ['!setup-report-cross', '建立「跨伺服器報單系統 1 號」面板'],
    ['!setup-report-cross-2', '建立「唱歌單跨服報單」面板'],
    ['!setup-exam', '建立「開始考核」填表並建立專屬考場的面板'],
    ['!setup-bank', '建立「地下金庫餘額查詢」面板'],
    ['!setup-intimacy', '建立「愛戀藏館查詢」面板'],
    ['!setup-suggestion', '建立「意見投訴與建議箱」面板'],
    ['!setup-lottery', '建立「喚雨星象・每日抽籤」面板'],
    ['!setup-staff-suggestion', '建立「員工輔導室」面板（獨立通道，送至專屬後台）']
  ]],
  ['💰 查詢與統計（報表類）', [
    ['!消費查詢 [@目標(選填)]', '查詢老闆當月與歷史累計消費（所有人皆可用，不標記則查自己）'],
    ['!查點單 [@老闆]／!歷史點單 [@老闆]', '查詢某位老闆過往所有的歷史點單明細清單'],
    ['!消費榜／!金主榜', '查看全服歷史 VIP 總榜與本月消費大戶排行'],
    ['!匯出消費總表', '匯出全服金主的消費總表與 VIP 等級紀錄檔（CSV）'],
    ['!薪資查詢 [@陪玩(選填)]', '陪玩查詢自己的可提領與暫存薪水（管理層可標記他人查詢）'],
    ['!全服雨幣／!金庫總覽', '查看全服流通的雨幣總額度'],
    ['!雨幣查詢 [@目標]', '管理員或客服專用，查詢特定老闆的雨幣餘額'],
    ['!業績查詢', '查詢當月所有陪玩的業績結算總列表'],
    ['!匯出報表', '匯出本月財務流水帳紀錄檔（含所有訂單、退單、系統調整的 CSV）'],
    ['!匯出提領報表', '匯出本月所有陪玩的提領薪資紀錄明細檔（CSV）'],
    ['!財務報表', '產生本月財務淨利對帳單，並列出當月陪玩業績 Top 3'],
    ['!客服業績 [日期1(選填)] [日期2(選填)]', '查看客服接單排行榜（基於傳票紀錄，可指定區間）'],
    ['!清空客服業績', '清空上述的客服獨立業績紀錄']
  ]],
  ['📖 玩家手冊', [
    ['!手冊 / !玩家手冊 / !規則', '在 Discord 內貼出玩家手冊連結：https://meow.crownai.ink/rules'],
  ]],
  ['🔧 日常操作與管理', [
    ['!核銷 [訂單編號]', '客服專用。核銷成功後，將陪玩的「暫存薪水 PendingIncome」轉入「可提領 Income」'],
    ['!未銷', '列出前 25 筆尚未核銷的訂單列表'],
    ['!結單', '在訂單包廂裡＝結束這張單（歸檔、鎖發言、1 天後自動刪頻道）；在其他頻道＝發「今日已結單」公告'],
    ['!抽籤', '喚雨星象：每日一次運勢抽籤，抽中吉籤掉折價券（全員可用）'],
    ['!退單 [訂單編號] [原因]', '退還老闆全額雨幣並扣回陪玩分潤'],
    ['!儲值 [@老闆] [金額]', '為老闆儲值雨幣（客服／管理員）'],
    ['!扣款 [@老闆] [金額]', '扣除老闆雨幣（客服／管理員）'],
    ['!提領 [金額]', '陪玩自行申請提領，待管理員於後台撥款'],
    ['!離職 [名稱]', '從公司名單中開除該名員工，並永久刪除其相關資料庫紀錄'],
    ['!刷新人事', '手動更新機器人記憶體中的人事名單'],
    ['!指令', '在 Discord 內顯示指令總覽']
  ]],
  ['⌨️ 斜線指令', [
    ['/對帳 [客人] [陪玩]', '查詢特定老闆在特定陪玩身上的累計消費金額與次數'],
    ['/陪玩業績詳報 [陪玩]', '查詢特定陪玩師的金主分布結構與總業績（Top 10）'],
    ['/送禮 [送禮人] [對象] [禮物款式] [數量]', '發送禮物，自動扣款並計算雙倍親密度'],
    ['/愛戀查詢 [陪玩] [客人(選填)]', '查詢老闆與陪玩的親密羈絆點數與特權進度'],
    ['/親密調整 [客人] [陪玩] [點數]', '強制調整某對 CP 的親密度（歸零時同步清除歷史禮物紀錄）'],
    ['/vip等級 [老闆] [等級]', '手動強制設定老闆的 VIP 等級（0~7；填 -1 解除鎖定）'],
    ['/背包查詢 [客人(選填)]', '查詢老闆目前的專屬背包狀態與折價券明細'],
    ['/新增地盤 [老闆] [數值]', '新增老闆的地盤步數進度（超過 21 會自動歸 0）'],
    ['/發布投票 [標題] [選項]', '快速發布匿名的選擇題投票與賽前競猜箱'],
    ['/入職 [對象] [代號] [名稱] [網址]', '錄取陪玩並綁定對應的影音名片']
  ]]
];

Pages.panels = async view => {
  const [panels, res] = await Promise.all([GET('/panels/list'), GET('/discord/resources')]);
  const chOptions = res.channels.map(c => `<option value="${c.id}">#${UI.esc(c.name)}</option>`).join('');

  view.innerHTML = `
    <div class="card">
      <h3>一鍵發送面板</h3>
      <div class="muted" style="margin-bottom:10px">選好頻道後按「發送」，機器人會立刻在該頻道張貼面板，效果與在 Discord 輸入對應指令完全相同。</div>
      ${H.table(['面板', '對應指令', '發送到頻道', ''],
        panels.map(p => `<tr>
          <td>${UI.esc(p.label)}</td>
          <td><code>${UI.esc(p.command)}</code></td>
          <td><select data-ch="${p.key}" style="min-width:180px">${chOptions}</select></td>
          <td><button class="btn sm" data-send="${p.key}">發送</button></td>
        </tr>`))}
    </div>

    <div class="card">
      <h3>公告與訊息</h3>
      <div class="grid c2">
        <label class="f"><span>發送到頻道</span><select id="anCh">${chOptions}</select></label>
        <label class="f"><span>標題（純文字模式可留空）</span><input id="anTitle" placeholder="例：本週活動公告"></label>
      </div>
      <label class="f"><span>內容</span><textarea id="anBody" rows="5" placeholder="支援 Discord 的 **粗體** 與換行"></textarea></label>
      <div class="row">
        <label class="f"><span>樣式</span><select id="anColor">
          <option value="main">一般（紫）</option><option value="ok">成功（綠）</option>
          <option value="warn">提醒（黃）</option><option value="err">警告（紅）</option>
        </select></label>
        <label class="f"><span>格式</span><select id="anPlain">
          <option value="0">嵌入訊息</option><option value="1">純文字</option>
        </select></label>
        <label class="f"><span>標記全體</span><select id="anAll">
          <option value="0">否</option><option value="1">@everyone</option>
        </select></label>
      </div>
      <div class="row">
        <div class="fit"><button class="btn" id="anSend">發送公告</button></div>
        <div class="fit"><button class="btn danger" id="anClose">發送「今日已結單」公告</button></div>
      </div>
    </div>

    <div class="card">
      <h3>發布投票</h3>
      <div class="grid c2">
        <label class="f"><span>發送到頻道</span><select id="poCh">${chOptions}</select></label>
        <label class="f"><span>投票標題</span><input id="poTitle" placeholder="例：這週要開什麼活動？"></label>
      </div>
      <label class="f"><span>選項（用「、」或逗號分隔，最多 10 個）</span><input id="poOpts" placeholder="麻將大賽、歌回、電影夜"></label>
      <div class="row"><div class="fit"><button class="btn" id="poSend">發布投票</button></div></div>
    </div>

    <div class="card">
      <h3>私訊成員</h3>
      <div class="grid c2">
        <label class="f"><span>對象 Discord ID</span><input id="dmUser" placeholder="123456789012345678"></label>
        <label class="f"><span></span><button class="btn" id="dmSend">送出私訊</button></label>
      </div>
      <label class="f"><span>內容</span><textarea id="dmBody" rows="3"></textarea></label>
      <div class="muted">對方若關閉私訊會失敗，系統會告訴你。</div>
    </div>`;

  document.querySelectorAll('[data-send]').forEach(b => b.onclick = async () => {
    const key = b.dataset.send;
    const ch = document.querySelector(`[data-ch="${key}"]`).value;
    if (!await UI.confirm('確定要在該頻道發送這個面板嗎？')) return;
    b.disabled = true;
    try { const r = await POST('/panels/send', { key, channel_id: ch }); UI.ok(`已發送到 #${r.channel}`); }
    finally { b.disabled = false; }
  });

  document.getElementById('anSend').onclick = async () => {
    await POST('/announce', {
      channel_id: document.getElementById('anCh').value,
      title: document.getElementById('anTitle').value.trim(),
      content: document.getElementById('anBody').value,
      color: document.getElementById('anColor').value,
      plain: document.getElementById('anPlain').value === '1',
      mention_everyone: document.getElementById('anAll').value === '1'
    });
    UI.ok('公告已發送');
  };
  document.getElementById('anClose').onclick = async () => {
    if (!await UI.confirm('確定要發送「今日已結單」公告嗎？')) return;
    await POST('/announce/close-orders', { channel_id: document.getElementById('anCh').value });
    UI.ok('已發送結單公告');
  };
  document.getElementById('poSend').onclick = async () => {
    await POST('/polls', {
      channel_id: document.getElementById('poCh').value,
      title: document.getElementById('poTitle').value.trim(),
      options: document.getElementById('poOpts').value
    });
    UI.ok('投票已發布');
  };
  document.getElementById('dmSend').onclick = async () => {
    await POST('/dm', {
      user_id: document.getElementById('dmUser').value.trim(),
      content: document.getElementById('dmBody').value
    });
    UI.ok('私訊已送出');
  };
};

// ---------------- 系統設定 ----------------
Pages.settings = async view => {
  const [cfg, res, org] = await Promise.all([GET('/config'), GET('/discord/resources'), GET('/org')]);
  const v = cfg.values;
  const opts = (list, cur, none = '（未設定）') =>
    `<option value="">${none}</option>` +
    list.map(x => `<option value="${x.id}" ${x.id === cur ? 'selected' : ''}>${UI.esc(x.name)}</option>`).join('');

  view.innerHTML = `
    <div class="card"><h3>基本</h3>
      <div class="row">
        <label class="f"><span>品牌名稱</span><input name="brand_name" value="${UI.esc(v.brand_name || '喚雨')}"></label>
        <label class="f"><span>機器人狀態文字</span><input name="bot_activity" value="${UI.esc(v.bot_activity || '☔ 喚雨接單中')}"></label>
      </div>
      <div class="row">
        <label class="f"><span>陪玩分潤成數（%）</span><input name="staff_share_rate" type="number" min="0" max="100" value="${UI.esc(v.staff_share_rate)}"></label>
        <label class="f"><span>送禮分潤成數（%，陪玩實拿）</span><input name="gift_share_rate" type="number" min="0" max="100" value="${UI.esc(v.gift_share_rate || '70')}"></label>
        <label class="f"><span>VIP 門檻（Lv1~Lv7 累計消費，逗號分隔）</span><input name="vip_thresholds" value="${UI.esc(v.vip_thresholds)}"></label>
      </div>
      <label class="f"><span>VIP 等級名稱（Lv0~Lv7 共 8 個，逗號分隔；報表與匯出檔會用這組名稱）</span>
        <input name="vip_names" value="${UI.esc(v.vip_names || '')}"></label>
    </div>
    <div class="card"><h3>身分組</h3>
      <div class="grid c2">
        <label class="f"><span>管理員身分組</span><select name="role_admin">${opts(res.roles, v.role_admin)}</select></label>
        <label class="f"><span>客服身分組</span><select name="role_cs">${opts(res.roles, v.role_cs)}</select></label>
        <label class="f"><span>陪玩身分組</span><select name="role_player">${opts(res.roles, v.role_player)}</select></label>
        <label class="f"><span>老闆身分組（!sendrole 領取）</span><select name="role_boss">${opts(res.roles, v.role_boss)}</select></label>
        <label class="f"><span>雨滴通知身分組</span><select name="role_drop">${opts(res.roles, v.role_drop)}</select></label>
        <label class="f"><span>旅人身分組（身份大廳，未設用老闆身分組）</span><select name="role_traveler">${opts(res.roles, v.role_traveler)}</select></label>
        <label class="f"><span>寄宿貓貓身分組（身份大廳，未設用陪玩身分組）</span><select name="role_cat">${opts(res.roles, v.role_cat)}</select></label>
        <label class="f"><span>培訓員身分組（可看報單頻道）</span><select name="role_trainer">${opts(res.roles, v.role_trainer)}</select></label>
        <label class="f"><span>考官身分組（可多個，逗號分隔；留空自動抓名稱含「考官」的身分組）</span><input name="role_examiner" value="${UI.esc(v.role_examiner || '')}" placeholder="喚雨技術考官,喚雨娛樂考官,喚雨歌手考官"></label>
      </div>
    </div>
    <div class="card"><h3>頻道與分類</h3>
      <div class="grid c2">
        <label class="f"><span>下單頻道分類</span><select name="category_ticket">${opts(res.categories, v.category_ticket)}</select></label>
        <label class="f"><span>考場分類</span><select name="category_exam">${opts(res.categories, v.category_exam)}</select></label>
        <label class="f"><span>報單頻道分類</span><select name="category_report">${opts(res.categories, v.category_report)}</select></label>
        <label class="f"><span>訂單通知頻道</span><select name="channel_order_log">${opts(res.channels, v.channel_order_log)}</select></label>
        <label class="f"><span>意見箱接收頻道</span><select name="channel_suggestion">${opts(res.channels, v.channel_suggestion)}</select></label>
        <label class="f"><span>員工輔導室後台頻道</span><select name="channel_staff_box">${opts(res.channels, v.channel_staff_box)}</select></label>
        <label class="f"><span>已結單分類</span><select name="category_order_done">${opts(res.categories, v.category_order_done)}</select></label>
        <label class="f"><span>公開單分類</span><select name="category_order_public">${opts(res.categories, v.category_order_public)}</select></label>
        <label class="f"><span>匿名單分類</span><select name="category_order_anon">${opts(res.categories, v.category_order_anon)}</select></label>
        <label class="f"><span>結單後分類（按「關閉訂單」）</span><select name="category_order_closed">${opts(res.categories, v.category_order_closed)}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">播報</h4>
      <div class="grid c2">
        <label class="f"><span>VIP 升級播報</span><select name="channel_vip_announce">${opts(res.channels, v.channel_vip_announce)}</select></label>
        <label class="f"><span>甜蜜贈禮播報</span><select name="channel_gift_announce">${opts(res.channels, v.channel_gift_announce)}</select></label>
        <label class="f"><span>專屬冠名播報</span><select name="channel_title_announce">${opts(res.channels, v.channel_title_announce)}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">後台</h4>
      <div class="grid c2">
        <label class="f"><span>更新日誌</span><select name="channel_update_log">${opts(res.channels, v.channel_update_log)}</select></label>
        <label class="f"><span>Bug 回報</span><select name="channel_bug_report">${opts(res.channels, v.channel_bug_report)}</select></label>
        <label class="f"><span>後台結帳／財務</span><select name="channel_finance">${opts(res.channels, v.channel_finance)}</select></label>
        <label class="f"><span>匯出區（機密）</span><select name="channel_export">${opts(res.channels, v.channel_export)}</select></label>
        <label class="f"><span>指令操作紀錄</span><select name="channel_command_log">${opts(res.channels, v.channel_command_log)}</select></label>
        <label class="f"><span>金流紀錄（儲值／扣款／發薪）</span><select name="channel_money_log">${opts(res.channels, v.channel_money_log)}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">會員售後</h4>
      <div class="grid c2">
        <label class="f"><span>會員系統</span><select name="channel_member_system">${opts(res.channels, v.channel_member_system)}</select></label>
        <label class="f"><span>通報紀錄</span><select name="channel_notice_log">${opts(res.channels, v.channel_notice_log)}</select></label>
        <label class="f"><span>客服接待區</span><select name="channel_cs_lobby">${opts(res.channels, v.channel_cs_lobby)}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">入口</h4>
      <div class="grid c2">
        <label class="f"><span>點我下單頻道</span><select name="channel_order_entry">${opts(res.channels, v.channel_order_entry)}</select></label>
        <label class="f"><span>點我入職頻道</span><select name="channel_exam_entry">${opts(res.channels, v.channel_exam_entry)}</select></label>
        <label class="f"><span>陪陪介紹／評價頻道</span><select name="channel_intro">${opts(res.channels, v.channel_intro)}</select></label>
      </div>
      <h4 style="margin:14px 0 6px">自動語音房</h4>
      <div class="grid c2">
        <label class="f"><span>「創建語音房」大廳語音頻道</span><select name="channel_voice_hub">${opts(res.voices || [], v.channel_voice_hub)}</select></label>
        <label class="f"><span>語音房名稱格式（{name} 會換成使用者暱稱）</span><input name="voice_room_name" value="${UI.esc(v.voice_room_name || '')}" placeholder="{name} 老闆的專屬語音"></label>
        <label class="f"><span>語音房建立在哪個分類</span><select name="category_voice">${opts(res.categories, v.category_voice)}</select></label>
        <label class="f"><span>房間是否私人</span><select name="voice_room_private">
          <option value="1" ${v.voice_room_private !== '0' ? 'selected' : ''}>私人（只有老闆、客服與管理看得到，陪玩由客服人工拉入）</option>
          <option value="0" ${v.voice_room_private === '0' ? 'selected' : ''}>公開（所有人都看得到也進得去）</option>
        </select></label>
      </div>
      <h4 style="margin:14px 0 6px">下單選單選項（逗號分隔，留空用預設）</h4>
      <div class="grid c2">
        <label class="f"><span>偏好性別</span><input name="order_genders" value="${UI.esc(v.order_genders || '')}" placeholder="男女都可,女生陪玩,男生陪玩"></label>
        <label class="f"><span>服務類型</span><input name="order_services" value="${UI.esc(v.order_services || '')}" placeholder="雨幣儲值,特戰英豪,Steam 小遊戲,唱歌單曲,語聊"></label>
        <label class="f"><span>服務分類</span><input name="order_categories" value="${UI.esc(v.order_categories || '')}" placeholder="技術,娛樂"></label>
        <label class="f"><span>加購選項（名稱=加價）</span><input name="order_addons" value="${UI.esc(v.order_addons || '')}" placeholder="指定/甜蜜=50,聲優=50,無=0"></label>
        <label class="f"><span>單別名稱（服務=單別）</span><input name="order_type_labels" value="${UI.esc(v.order_type_labels || '')}" placeholder="特戰英豪=娛樂單,Steam 小遊戲=steam單"></label>
        <label class="f"><span>單號起始值</span><input name="ticket_seq_start" type="number" value="${UI.esc(v.ticket_seq_start || '1001')}"></label>
        <label class="f"><span>每人同時開單上限（0＝不限）</span><input name="order_max_open" type="number" value="${UI.esc(v.order_max_open || '5')}"></label>
        <label class="f"><span>開單冷卻秒數（0＝不限）</span><input name="order_cooldown_sec" type="number" value="${UI.esc(v.order_cooldown_sec || '30')}"></label>
        <label class="f"><span>結帳親密度成數（%）</span><input name="order_intimacy_rate" type="number" value="${UI.esc(v.order_intimacy_rate || '100')}"></label>
        <label class="f"><span>高薪陪玩門檻（!業績查詢）</span><input name="high_income_threshold" type="number" value="${UI.esc(v.high_income_threshold || '20000')}"></label>
        <label class="f"><span>要問指定定級的服務</span><input name="order_rank_services" value="${UI.esc(v.order_rank_services || '')}" placeholder="特戰英豪"></label>
        <label class="f"><span>指定定級選項（男／不限）</span><input name="order_want_ranks" value="${UI.esc(v.order_want_ranks || '')}" placeholder="頂尖賦能 (600分以上),賦能,神話,超凡"></label>
        <label class="f"><span>指定定級選項（限女生）</span><input name="order_want_ranks_female" value="${UI.esc(v.order_want_ranks_female || '')}" placeholder="賦能,神話,超凡"></label>
        <label class="f"><span>定級階梯（由低到高；指定某定級時，該定級以上的陪玩都看得到單）</span><input name="order_rank_ladder" value="${UI.esc(v.order_rank_ladder || '')}" placeholder="神話,超凡,賦能,頂尖賦能"></label>
        <label class="f"><span>結單後幾天刪頻道（0＝不刪）</span><input name="ticket_delete_days" type="number" value="${UI.esc(v.ticket_delete_days || '1')}"></label>
      </div>
      <label class="f"><span>陪玩身分組分流規則（一行一條：條件|條件=身分組,身分組；<code>*</code>＝不限、<code>!條件</code>＝排除；留空為自動依身分組名稱配對）</span>
        <textarea name="order_role_routes" rows="6" placeholder="唱歌單=喚雨歌手&#10;娛樂|!技術|限女生=喚雨娛樂女陪&#10;技術|限男生|賦能|!頂尖=VAL男頂尖賦能,VAL男賦能&#10;技術|限女生|神話=VAL女賦能,VAL女神話">${UI.esc(v.order_role_routes || '')}</textarea></label>
      ${res.roles.length ? '' : '<div class="muted">機器人目前離線或尚未加入伺服器，因此無法列出身分組與頻道。</div>'}
    </div>
    <div class="card"><button class="btn" id="save">儲存設定</button></div>

    <div class="card"><h3>集團綁定（跨群資料互通）</h3>
      <div class="muted" style="margin-bottom:10px">
        把「陪玩群」與「員工群」綁在同一個集團後，<b>訂單、接單、錢包、薪資、財務、客服業績、人事名單、親密度</b>
        全部共用同一份資料，兩邊查到的帳完全一致。<br>
        上方的身分組、頻道、分類設定仍然是<b>各群獨立</b>的——那本來就該不一樣。<br>
        目前集團代號：<code>${UI.esc(org.current_org)}</code>（共 ${org.members.length} 台伺服器）
      </div>
      ${H.table(['伺服器', 'Discord ID', '所屬集團', '標籤', '狀態', '操作'],
        org.guilds.map(g => `<tr><td>${UI.esc(g.name || g.guild_id)}</td><td><code>${g.guild_id}</code></td>
          <td><code>${UI.esc(g.org_id)}</code></td><td>${UI.esc(g.label || '—')}</td>
          <td>${g.linked ? '<span class="tag ok">同一集團</span>' : '<span class="tag">獨立</span>'}</td>
          <td>${g.guild_id === org.current_org
            ? '<span class="muted">主群</span>'
            : (g.linked
                ? `<button class="btn danger sm" data-unbind="${g.guild_id}">解除綁定</button>`
                : `<button class="btn sm" data-bind="${g.guild_id}" data-name="${UI.esc(g.name || g.guild_id)}">綁進本集團</button>`)}
          </td></tr>`), '目前只有一台伺服器')}
    </div>`;

  view.querySelectorAll('[data-bind]').forEach(b => b.onclick = () => UI.modal({
    title: `把「${b.dataset.name}」綁進本集團`,
    okText: '確定綁定',
    bodyHTML: `<label class="f"><span>標籤（例：員工群 / 陪玩群）</span><input name="label"></label>
      <div class="muted">綁定後，這台伺服器原本自己的訂單、錢包、薪資、人事等資料會<b>整批搬進本集團</b>，
      兩邊從此共用同一份帳。此動作可以再解除，但解除後資料會留在集團裡。</div>`,
    onOk: async back => {
      const r = await POST_ORG({ guild_id: b.dataset.bind, org_id: org.current_org, label: UI.val(back, 'label') });
      UI.ok(`已綁定，搬移 ${r.moved} 筆資料`);
      App.reload();
    }
  }));
  view.querySelectorAll('[data-unbind]').forEach(b => b.onclick = async () => {
    if (!await UI.confirm('解除綁定後，這台伺服器會變回獨立運作（既有資料仍留在原集團）。確定嗎？')) return;
    await POST_ORG({ guild_id: b.dataset.unbind, org_id: '' });
    UI.ok('已解除綁定'); App.reload();
  });

  document.getElementById('save').onclick = async () => {
    const body = {};
    cfg.keys.forEach(k => {
      const el = view.querySelector(`[name="${k}"]`);
      if (el) body[k] = el.value;
    });
    await PUT('/config', body);
    UI.ok('設定已儲存');
  };
};

// ---------------- 帳號權限 ----------------
Pages.users = async view => {
  const load = async () => {
    const rows = await GET('/users');
    const mods = App.me.all_modules;
    document.getElementById('ut').innerHTML = H.table(
      ['帳號', '姓名', '角色', '權限', '狀態', '操作'],
      rows.map(u => `<tr><td>${UI.esc(u.username)}</td><td>${UI.esc(u.name)}</td>
        <td>${u.role === 'admin' ? '<span class="tag">總管理員</span>' : '一般'}</td>
        <td style="white-space:normal;max-width:340px" class="muted">${u.role === 'admin' ? '全部' : UI.esc(u.permissions || '無')}</td>
        <td>${u.active ? '<span class="tag ok">啟用</span>' : '<span class="tag err">停用</span>'}</td>
        <td><button class="btn sm" data-ue='${UI.esc(JSON.stringify(u))}'>編輯</button>
            <button class="btn danger sm" data-ud="${u.id}">刪除</button></td></tr>`));

    const form = u => `
      <div class="row">
        <label class="f"><span>帳號</span><input name="username" value="${UI.esc(u?.username || '')}" ${u ? 'readonly' : ''}></label>
        <label class="f"><span>姓名</span><input name="name" value="${UI.esc(u?.name || '')}"></label>
      </div>
      <label class="f"><span>${u ? '新密碼（留空不改）' : '密碼（至少 8 碼）'}</span><input name="password" type="password"></label>
      <label class="f"><span>角色</span><select name="role">
        <option value="staff" ${u?.role !== 'admin' ? 'selected' : ''}>一般（依權限）</option>
        <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>總管理員（全開）</option></select></label>
      <div class="f"><span>功能權限</span>
        <div class="grid c3" style="gap:4px">${mods.map(m => `<label style="font-size:13.5px">
          <input type="checkbox" name="p_${m.key}" style="width:auto"
            ${(u?.permissions || '').split(',').includes(m.key) ? 'checked' : ''}> ${UI.esc(m.label)}</label>`).join('')}</div>
      </div>`;

    const collect = back => mods.map(m => m.key).filter(k => back.querySelector(`[name="p_${k}"]`).checked);

    document.getElementById('unew').onclick = () => UI.modal({
      title: '新增後台帳號', bodyHTML: form(null),
      onOk: async back => {
        await POST('/users', {
          username: UI.val(back, 'username'), password: UI.val(back, 'password'),
          name: UI.val(back, 'name'), role: UI.val(back, 'role'), permissions: collect(back)
        });
        UI.ok('已新增'); load();
      }
    });
    document.querySelectorAll('[data-ue]').forEach(b => b.onclick = () => {
      const u = JSON.parse(b.dataset.ue);
      UI.modal({
        title: '編輯帳號',
        bodyHTML: form(u) + `<label class="f"><input type="checkbox" name="active" ${u.active ? 'checked' : ''} style="width:auto"> 啟用</label>`,
        onOk: async back => {
          const body = {
            name: UI.val(back, 'name'), role: UI.val(back, 'role'),
            permissions: collect(back), active: UI.val(back, 'active')
          };
          const pw = UI.val(back, 'password');
          if (pw) body.password = pw;
          await PUT('/users/' + u.id, body);
          UI.ok('已更新'); load();
        }
      });
    });
    document.querySelectorAll('[data-ud]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('確定刪除這個後台帳號？')) return;
      await DEL('/users/' + b.dataset.ud); UI.ok('已刪除'); load();
    });
  };
  view.innerHTML = `<div class="card"><div class="row"><div class="grow"></div>
      <div class="fit"><button class="btn" id="unew">＋ 新增帳號</button></div></div></div>
    <div class="card" id="ut"><div class="empty">載入中…</div></div>`;
  load();
};

// ---------------- 冠名與身份組期限 ----------------
Pages.titles = async view => {
  const ST = { offset: 0, limit: 50 };
  const F = [
    { id: 'q', label: '關鍵字（名稱／對象／備註）' },
    { id: 'kind', label: '類別', type: 'select',
      options: [{ v: '', t: '全部' }, { v: 'title', t: '冠名' }, { v: 'role', t: '身份組' }] },
    { id: 'status', label: '狀態', type: 'select',
      options: [{ v: 'live', t: '進行中＋排隊中' }, { v: '', t: '全部（含已結束）' },
                { v: 'active', t: '只看進行中' }, { v: 'queued', t: '只看排隊中' },
                { v: 'ended', t: '只看已結束' }] }
  ];
  const KIND = { title: '冠名', role: '身份組' };
  const left = end => {
    const ms = new Date(end.replace(' ', 'T')) - new Date();
    if (ms <= 0) return '<span class="tag err">已到期</span>';
    const d = Math.floor(ms / 86400000), h = Math.floor(ms % 86400000 / 3600000);
    return `<span class="tag ${d < 1 ? 'warn' : 'ok'}">剩 ${d} 天 ${h} 小時</span>`;
  };

  const load = async () => {
    const d = await GET('/titles?' + new URLSearchParams({ ...bind.values(), limit: ST.limit, offset: ST.offset }));
    H.pager('ti', d.total, ST);
    document.getElementById('ttable').innerHTML = H.table(
      ['#', '類別', '名稱', '對象', { label: '天數', num: 1 }, '開始', '結束', '剩餘', '狀態', '備註', '操作'],
      d.rows.map(t => `<tr><td>${t.id}</td><td>${KIND[t.kind]}</td><td><b>${UI.esc(t.name)}</b></td>
        <td>${t.kind === 'role'
              ? UI.esc(t.target_name || t.target_id)
              : `${UI.esc(t.customer_name || t.customer_id)} → ${UI.esc(t.staff_name || t.staff_id)}`}</td>
        <td class="num">${t.days}</td><td>${H.date(t.start_at)}</td><td>${H.date(t.end_at)}</td>
        <td>${t.status === 'ended' ? '<span class="muted">—</span>' : left(t.end_at)}</td>
        <td>${t.status === 'queued' ? '<span class="tag warn">排隊中</span>'
             : t.status === 'ended' ? '<span class="tag">已結束</span>' : '<span class="tag ok">進行中</span>'}</td>
        <td>${UI.esc(t.note || '')}</td>
        <td><button class="btn sm" data-te='${UI.esc(JSON.stringify(t))}'>編輯</button>
            ${t.status !== 'ended' ? `<button class="btn secondary sm" data-tend="${t.id}">提前結束</button>` : ''}
            <button class="btn danger sm" data-tdel="${t.id}">刪除</button></td></tr>`),
      '沒有符合條件的紀錄');

    document.querySelectorAll('[data-te]').forEach(b => b.onclick = () => {
      const t = JSON.parse(b.dataset.te);
      UI.modal({ title: `編輯 #${t.id}`, bodyHTML: form(t), onOk: async back => {
        await PUT('/titles/' + t.id, vals(back));
        UI.ok('已更新'); load();
      } });
    });
    document.querySelectorAll('[data-tend]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('確定要提前結束這筆嗎？結束後不會再發到期提醒。')) return;
      await PUT('/titles/' + b.dataset.tend, { status: 'ended' }); UI.ok('已結束'); load();
    });
    document.querySelectorAll('[data-tdel]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('刪除後無法復原，確定嗎？')) return;
      await DEL('/titles/' + b.dataset.tdel); UI.ok('已刪除'); load();
    });
  };

  const form = t => `
    <div class="row">
      <label class="f"><span>類別</span><select name="kind" ${t ? 'disabled' : ''}>
        <option value="title" ${t?.kind !== 'role' ? 'selected' : ''}>冠名</option>
        <option value="role" ${t?.kind === 'role' ? 'selected' : ''}>身份組</option></select></label>
      <label class="f"><span>天數</span><input name="days" type="number" value="${t?.days || 30}"></label>
    </div>
    <label class="f"><span>名稱</span><input name="name" value="${UI.esc(t?.name || '')}"></label>
    <div class="row">
      <label class="f"><span>客人（冠名用）</span><input name="customer_name" value="${UI.esc(t?.customer_name || '')}"></label>
      <label class="f"><span>陪玩（冠名用）</span><input name="staff_name" value="${UI.esc(t?.staff_name || '')}"></label>
    </div>
    <label class="f"><span>身份組對象</span><input name="target_name" value="${UI.esc(t?.target_name || '')}"></label>
    <div class="row">
      <label class="f"><span>開始時間（留空＝現在）</span><input name="start_at" value="${UI.esc(t?.start_at || '')}" placeholder="2026-08-13 01:09"></label>
      <label class="f"><span>結束時間（留空＝依天數推算）</span><input name="end_at" value="${UI.esc(t?.end_at || '')}" placeholder="2026-09-13 01:09"></label>
    </div>
    <label class="f"><span>備註</span><input name="note" value="${UI.esc(t?.note || '')}"></label>
    ${t ? '' : `<label class="f"><input type="checkbox" name="queue_after" style="width:auto">
      接棒：排在該陪玩／對象目前最晚一筆之後開始</label>`}`;

  const vals = back => ({
    kind: UI.val(back, 'kind'), name: UI.val(back, 'name'), days: Number(UI.val(back, 'days')),
    customer_name: UI.val(back, 'customer_name'), staff_name: UI.val(back, 'staff_name'),
    target_name: UI.val(back, 'target_name'), start_at: UI.val(back, 'start_at'),
    end_at: UI.val(back, 'end_at'), note: UI.val(back, 'note'),
    queue_after: UI.val(back, 'queue_after')
  });

  view.innerHTML = `
    <div class="card"><div class="row"><div class="grow">
      <span class="muted">到期會自動發提醒到「專屬冠名播報」頻道（沒設就發到訂單通知頻道），每分鐘檢查一次。</span>
    </div><div class="fit"><button class="btn" id="tnew">＋ 新增</button></div></div></div>
    ${H.filters('ti', F)}
    <div class="card" id="ttable"><div class="empty">載入中…</div></div>`;

  document.getElementById('tnew').onclick = () => UI.modal({
    title: '新增冠名／身份組期限', bodyHTML: form(null),
    onOk: async back => { await POST('/titles', vals(back)); UI.ok('已建立'); load(); }
  });
  const bind = H.bindFilters('ti', F, () => load(), ST);
  load();
};
