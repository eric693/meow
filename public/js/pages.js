// 頁面：總覽、訂單、金庫、薪資、老闆、人事
const Pages = {};

// ---------------- 總覽 ----------------
Pages.dashboard = async view => {
  const d = await GET('/dashboard');
  const c = d.charts;
  view.innerHTML = `
    <div class="grid c4" style="margin-bottom:16px">
      ${H.stat('本月營收', H.n(d.revenue), { accent: true })}
      ${H.stat('本月淨利', H.n(d.net), { accent: true })}
      ${H.stat('本月訂單', d.order_count)}
      ${H.stat('禮物營收', H.n(d.gift_revenue))}
      ${H.stat('流通雨幣', H.n(d.coins_total))}
      ${H.stat('陪玩可提領', H.n(d.staff_income))}
      ${H.stat('暫存薪水', H.n(d.staff_pending))}
      ${H.stat('待核銷訂單', d.unsettled)}
      ${H.stat('在職陪玩', d.staff_count)}
      ${H.stat('在職客服', d.cs_count)}
      ${H.stat('進行中客服單', d.open_tickets)}
      ${H.stat('待審提領', d.pending_withdrawals)}
    </div>
    ${Chart.card('近 12 個月營收與淨利',
      Chart.bars(c.monthly, [{ key: 'revenue', label: '營收' }, { key: 'net', label: '伺服器淨利' },
                             { key: 'share', label: '陪玩抽成' }], { height: 250 }))}
    <div class="grid c2">
      ${Chart.card('本月每日營收',
        Chart.bars(c.daily, [{ key: 'revenue', label: '營收' }], { height: 220, everyN: 5 }), c.month)}
      ${Chart.card('本月交易類型佔比', Chart.donut(c.by_kind, { height: 220 }), c.month)}
      ${Chart.card('本月陪玩業績排行', Chart.hbar(c.top_staff), c.month)}
      ${Chart.card('本月金主消費排行', Chart.hbar(c.top_customers), c.month)}
    </div>
    <div class="grid c2">
      <div class="card"><h3>本月陪玩業績 Top 3</h3>
        ${d.top3.length ? d.top3.map((s, i) => `<div style="display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid var(--line)">
          <span>${['🥇', '🥈', '🥉'][i]} ${UI.esc(s.name || s.code)}</span><b>${H.n(s.amount)}</b></div>`).join('')
          : '<div class="empty">本月還沒有業績</div>'}
      </div>
      <div class="card"><h3>最近操作紀錄</h3>
        ${d.logs.length ? d.logs.map(l => `<div style="padding:5px 0;font-size:13.5px;border-bottom:1px solid var(--line)">
          <span class="muted">${H.date(l.created_at)}</span> ${UI.esc(l.actor)} — ${UI.esc(l.action)} ${UI.esc(l.detail)}</div>`).join('')
          : '<div class="empty">尚無紀錄</div>'}
      </div>
    </div>
    <div class="card"><h3>最新訂單</h3>
      ${H.table(['訂單編號', '時間', '老闆', '陪玩', '項目', { label: '金額', num: 1 }, '狀態'],
        d.recent.map(o => `<tr><td>${o.order_no}</td><td>${H.date(o.created_at)}</td>
          <td>${H.user(o.customer_id)}</td><td>${H.user(o.staff_id)}</td><td>${UI.esc(o.item)}</td>
          <td class="num">${H.n(o.amount)}</td><td>${H.statusTag(o.status)}</td></tr>`))}
    </div>`;
};

// ---------------- 訂單（交易流水帳）：見 pages-ledger.js ----------------

// ---------------- 地下金庫 ----------------
Pages.bank = async view => {
  const load = async (userId = '') => {
    const d = await GET('/bank?' + new URLSearchParams(userId ? { user_id: userId } : {}));
    document.getElementById('bstat').innerHTML = `
      ${H.stat('流通雨幣總額', H.n(d.summary.c), { accent: true })}
      ${H.stat('持有人數', d.summary.n)}
      ${H.stat('流水筆數', H.n(d.total))}`;
    document.getElementById('bcharts').innerHTML = `
      ${Chart.card('近 30 天雨幣流入 / 流出',
        Chart.bars(d.charts.flow, [{ key: 'inflow', label: '流入（儲值、退款）' },
                                   { key: 'outflow', label: '流出（消費、送禮）' }],
          { height: 230, unit: '雨幣', everyN: 3 }))}
      <div class="grid c2">
        ${Chart.card('雨幣持有排行', Chart.hbar(d.charts.holders, { color: 'var(--c1)' }))}
        ${Chart.card('近 30 天流量合計', Chart.donut([
          { label: '流入', amount: d.charts.flow.reduce((s, f) => s + f.inflow, 0) },
          { label: '流出', amount: d.charts.flow.reduce((s, f) => s + f.outflow, 0) }
        ], { height: 230, colors: ['var(--c2)', 'var(--c4)'] }))}
      </div>`;
    document.getElementById('btable').innerHTML = H.table(
      ['時間', '對象', { label: '異動', num: 1 }, { label: '餘額', num: 1 }, '事由', '關聯', '經手人'],
      d.rows.map(t => `<tr><td>${H.date(t.created_at)}</td><td>${H.user(t.user_id)}</td>
        <td class="num" style="color:${t.delta >= 0 ? 'var(--ok)' : 'var(--err)'}">${t.delta >= 0 ? '+' : ''}${H.n(t.delta)}</td>
        <td class="num">${H.n(t.balance)}</td><td>${UI.esc(t.reason)}</td>
        <td>${UI.esc(t.ref)}</td><td>${UI.esc(t.operator)}</td></tr>`));
  };

  view.innerHTML = `
    <div class="grid c3" id="bstat" style="margin-bottom:16px"></div>
    <div id="bcharts"></div>
    <div class="card"><div class="row">
      <label class="f"><span>只看某位老闆</span><input id="bu" placeholder="Discord ID，留空看全部"></label>
      <div class="fit"><button class="btn" id="badj">💰 儲值 / 扣款</button></div>
    </div></div>
    <div class="card" id="btable"><div class="empty">載入中…</div></div>`;

  document.getElementById('bu').oninput = (() => { let t; return e => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 350); }; })();
  document.getElementById('badj').onclick = () => UI.modal({
    title: '雨幣調整',
    bodyHTML: `<label class="f"><span>老闆 Discord ID</span><input name="user_id"></label>
      <label class="f"><span>異動金額（正數儲值、負數扣款）</span><input name="delta" type="number"></label>
      <label class="f"><span>事由</span><input name="reason" placeholder="例：現金儲值 500 元"></label>`,
    onOk: async back => {
      await POST('/bank/adjust', {
        user_id: UI.val(back, 'user_id'), delta: Number(UI.val(back, 'delta')), reason: UI.val(back, 'reason')
      });
      UI.ok('已調整'); load(document.getElementById('bu').value.trim());
    }
  });
  load();
};

// ---------------- 薪資與提領 ----------------
Pages.salary = async view => {
  const load = async () => {
    const d = await GET('/salary');

    const paid = d.withdrawals.filter(w => w.status === 'done').reduce((s, w) => s + w.amount, 0);
    const waiting = d.withdrawals.filter(w => w.status === 'pending').reduce((s, w) => s + w.amount, 0);
    document.getElementById('scharts').innerHTML = `
      ${Chart.card('可提領金額 Top 8',
        Chart.hbar(d.staff.filter(s => s.income > 0).sort((a, b) => b.income - a.income).slice(0, 8)
          .map(s => ({ label: s.name || s.code, amount: s.income })), { color: 'var(--c2)' }))}
      ${Chart.card('薪資池組成', Chart.donut([
        { label: '可提領', amount: d.staff.reduce((s, x) => s + x.income, 0) },
        { label: '暫存薪水', amount: d.staff.reduce((s, x) => s + x.pending_income, 0) },
        { label: '待審提領', amount: waiting },
        { label: '已撥款', amount: paid }
      ], { height: 230 }))}`;

    document.getElementById('sstaff').innerHTML = H.table(
      ['代號', '藝名', '職務', { label: '可提領', num: 1 }, { label: '暫存薪水', num: 1 },
       { label: '歷史入帳', num: 1 }, '操作'],
      d.staff.map(s => `<tr><td>${UI.esc(s.code)}</td><td>${UI.esc(s.name)}</td>
        <td>${s.kind === 'cs' ? '客服' : '陪玩'}</td>
        <td class="num"><b>${H.n(s.income)}</b></td><td class="num">${H.n(s.pending_income)}</td>
        <td class="num">${H.n(s.total_income)}</td>
        <td><button class="btn sm" data-wd="${s.user_id}" data-max="${s.income}" data-name="${UI.esc(s.name)}">建立提領</button></td></tr>`));

    document.getElementById('swd').innerHTML = H.table(
      ['#', '陪玩', { label: '金額', num: 1 }, '狀態', '申請時間', '處理時間', '經手人', '操作'],
      d.withdrawals.map(w => `<tr><td>${w.id}</td><td>${UI.esc(w.name || w.staff_id)}</td>
        <td class="num">${H.n(w.amount)}</td><td>${H.statusTag(w.status)}</td>
        <td>${H.date(w.created_at)}</td><td>${H.date(w.done_at)}</td><td>${UI.esc(w.operator)}</td>
        <td>${w.status === 'pending' ? `<button class="btn ok sm" data-done="${w.id}">撥款</button>
             <button class="btn danger sm" data-rej="${w.id}">退回</button>` : ''}</td></tr>`));

    document.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => UI.modal({
      title: `${b.dataset.name} 建立提領`,
      bodyHTML: `<label class="f"><span>金額（可提領上限 ${H.n(b.dataset.max)}）</span>
        <input name="amount" type="number" value="${b.dataset.max}"></label>
        <label class="f"><span>備註</span><input name="note"></label>`,
      onOk: async back => {
        await POST('/salary/withdraw', {
          staff_id: b.dataset.wd, amount: Number(UI.val(back, 'amount')), note: UI.val(back, 'note')
        });
        UI.ok('提領已建立'); load();
      }
    }));
    document.querySelectorAll('[data-done]').forEach(b => b.onclick = async () => {
      await POST(`/salary/withdraw/${b.dataset.done}/done`); UI.ok('已標記撥款'); load();
    });
    document.querySelectorAll('[data-rej]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm('退回後金額會退還給該陪玩，確定嗎？')) return;
      await POST(`/salary/withdraw/${b.dataset.rej}/rejected`); UI.ok('已退回'); load();
    });
  };
  view.innerHTML = `<div class="grid c2" id="scharts"></div>
    <div class="card"><h3>員工薪資</h3><div id="sstaff"><div class="empty">載入中…</div></div></div>
    <div class="card"><h3>提領紀錄</h3><div id="swd"></div></div>`;
  load();
};

// ---------------- 老闆與 VIP ----------------
Pages.customers = async view => {
  const load = async (q = '') => {
    const d = await GET('/customers?' + new URLSearchParams(q ? { q } : {}));
    document.getElementById('ctable').innerHTML = H.table(
      ['Discord ID', '名稱', { label: '雨幣', num: 1 }, { label: '累計消費', num: 1 }, 'VIP', '地盤', '操作'],
      d.rows.map(c => `<tr><td><code>${c.user_id}</code></td><td>${UI.esc(c.name)}</td>
        <td class="num">${H.n(c.coins)}</td><td class="num">${H.n(c.total_spend)}</td>
        <td><span class="tag">Lv.${c.vip_level}${c.vip_locked ? ' 🔒' : ''}</span></td>
        <td>${c.territory}/21</td>
        <td><button class="btn secondary sm" data-view="${c.user_id}">明細</button>
            <button class="btn sm" data-edit="${c.user_id}" data-json='${UI.esc(JSON.stringify(c))}'>編輯</button></td></tr>`))
      + `<div class="muted" style="margin-top:10px">共 ${d.total} 位</div>`;

    document.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => {
      const d2 = await GET('/customers/' + b.dataset.view);
      UI.modal({
        title: `老闆明細 ${d2.customer.name || d2.customer.user_id}`, okText: '關閉', onOk: () => {},
        bodyHTML: `
          <div class="grid c2" style="margin-bottom:12px">
            ${H.stat('雨幣餘額', H.n(d2.customer.coins), { small: true })}
            ${H.stat('累計消費', H.n(d2.spend.total_spend), { small: true })}
            ${H.stat('本月消費', H.n(d2.spend.month), { small: true })}
            ${H.stat('禮物累計', H.n(d2.spend.gift_total), { small: true })}
          </div>
          <h3>最近點單</h3>
          ${H.table(['編號', '陪玩', { label: '金額', num: 1 }, '狀態'],
            d2.orders.slice(0, 15).map(o => `<tr><td>${o.order_no}</td><td>${H.user(o.staff_id)}</td>
              <td class="num">${H.n(o.amount)}</td><td>${H.statusTag(o.status)}</td></tr>`), '沒有點單')}
          <h3 style="margin-top:14px">最近雨幣異動</h3>
          ${H.table(['時間', { label: '異動', num: 1 }, '事由'],
            d2.coins.slice(0, 15).map(t => `<tr><td>${H.date(t.created_at)}</td>
              <td class="num">${t.delta >= 0 ? '+' : ''}${H.n(t.delta)}</td><td>${UI.esc(t.reason)}</td></tr>`), '沒有紀錄')}`
      });
    });
    document.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => {
      const c = JSON.parse(b.dataset.json);
      UI.modal({
        title: '編輯老闆資料',
        bodyHTML: `<label class="f"><span>名稱</span><input name="name" value="${UI.esc(c.name)}"></label>
          <div class="row">
            <label class="f"><span>VIP 等級（0~7）</span><input name="vip_level" type="number" min="0" max="7" value="${c.vip_level}"></label>
            <label class="f"><span>地盤步數</span><input name="territory" type="number" min="0" max="21" value="${c.territory}"></label>
          </div>
          <label class="f"><input type="checkbox" name="vip_locked" ${c.vip_locked ? 'checked' : ''} style="width:auto">
            鎖定 VIP 等級（不再依消費自動升降）</label>`,
        onOk: async back => {
          await PUT('/customers/' + c.user_id, {
            name: UI.val(back, 'name'), vip_level: Number(UI.val(back, 'vip_level')),
            territory: Number(UI.val(back, 'territory')), vip_locked: UI.val(back, 'vip_locked')
          });
          UI.ok('已更新'); load(document.getElementById('cq').value.trim());
        }
      });
    });
  };
  view.innerHTML = `<div class="card"><label class="f"><span>搜尋</span><input id="cq" placeholder="Discord ID 或名稱"></label></div>
    <div class="card" id="ctable"><div class="empty">載入中…</div></div>`;
  document.getElementById('cq').oninput = (() => { let t; return e => { clearTimeout(t); t = setTimeout(() => load(e.target.value.trim()), 350); }; })();
  load();
};

// ---------------- 人事 ----------------
Pages.hr = async view => {
  const load = async () => {
    const rows = await GET('/staff');
    document.getElementById('htable').innerHTML = H.table(
      ['代號', '藝名', 'Discord ID', '職務', '影音名片', '狀態', { label: '可提領', num: 1 }, '入職日', '操作'],
      rows.map(s => `<tr><td>${UI.esc(s.code)}</td><td>${UI.esc(s.name)}</td>
        <td><code>${s.user_id}</code></td><td>${s.kind === 'cs' ? '客服' : '陪玩'}</td>
        <td>${s.card_url ? `<a href="${UI.esc(s.card_url)}" target="_blank" rel="noopener">開啟</a>` : '<span class="muted">—</span>'}</td>
        <td>${s.active ? '<span class="tag ok">在職</span>' : '<span class="tag err">離職</span>'}</td>
        <td class="num">${H.n(s.income)}</td><td>${H.date(s.joined_at)}</td>
        <td><button class="btn sm" data-e="${s.id}" data-json='${UI.esc(JSON.stringify(s))}'>編輯</button>
            <button class="btn secondary sm" data-d="${s.id}">業績</button>
            <button class="btn danger sm" data-x="${s.id}" data-name="${UI.esc(s.name)}">離職</button></td></tr>`));

    const form = json => `
      <div class="row">
        <label class="f"><span>代號</span><input name="code" value="${UI.esc(json?.code || '')}"></label>
        <label class="f"><span>藝名</span><input name="name" value="${UI.esc(json?.name || '')}"></label>
      </div>
      <label class="f"><span>Discord ID</span><input name="user_id" value="${UI.esc(json?.user_id || '')}" ${json ? 'readonly' : ''}></label>
      <label class="f"><span>影音名片網址</span><input name="card_url" value="${UI.esc(json?.card_url || '')}"></label>
      <label class="f"><span>職務</span><select name="kind">
        <option value="player" ${json?.kind !== 'cs' ? 'selected' : ''}>陪玩</option>
        <option value="cs" ${json?.kind === 'cs' ? 'selected' : ''}>客服</option></select></label>`;

    document.querySelectorAll('[data-e]').forEach(b => b.onclick = () => {
      const s = JSON.parse(b.dataset.json);
      UI.modal({
        title: '編輯員工',
        bodyHTML: form(s) + `<label class="f"><input type="checkbox" name="active" ${s.active ? 'checked' : ''} style="width:auto"> 在職中</label>`,
        onOk: async back => {
          await PUT('/staff/' + s.id, {
            code: UI.val(back, 'code'), name: UI.val(back, 'name'), card_url: UI.val(back, 'card_url'),
            kind: UI.val(back, 'kind'), active: UI.val(back, 'active')
          });
          UI.ok('已更新'); load();
        }
      });
    });
    document.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => {
      const d = await GET(`/staff/${b.dataset.d}/detail`);
      UI.modal({
        title: `${d.staff.name} 業績詳報`, okText: '關閉', onOk: () => {},
        bodyHTML: `<div class="grid c2" style="margin-bottom:12px">
            ${H.stat('本月業績', H.n(d.detail.month), { small: true })}
            ${H.stat('歷史總業績', H.n(d.detail.total), { small: true })}
            ${H.stat('禮物收入', H.n(d.detail.gifts), { small: true })}
            ${H.stat('可提領', H.n(d.staff.income), { small: true })}
          </div>
          <h3>金主分布 Top 10</h3>
          ${H.table(['老闆', { label: '金額', num: 1 }, { label: '次數', num: 1 }],
            d.detail.patrons.map(p => `<tr><td><code>${p.customer_id}</code></td>
              <td class="num">${H.n(p.amount)}</td><td class="num">${p.cnt}</td></tr>`), '尚無金主紀錄')}`
      });
    });
    document.querySelectorAll('[data-x]').forEach(b => b.onclick = async () => {
      if (!await UI.confirm(`確定要讓「${b.dataset.name}」離職嗎？相關親密度與禮物紀錄會永久刪除。`)) return;
      await DEL('/staff/' + b.dataset.x); UI.ok('已辦理離職'); load();
    });

    document.getElementById('hnew').onclick = () => UI.modal({
      title: '新增員工（入職）',
      bodyHTML: form(null),
      onOk: async back => {
        await POST('/staff', {
          code: UI.val(back, 'code'), name: UI.val(back, 'name'), user_id: UI.val(back, 'user_id'),
          card_url: UI.val(back, 'card_url'), kind: UI.val(back, 'kind')
        });
        UI.ok('已建檔'); load();
      }
    });
  };
  view.innerHTML = `<div class="card"><div class="row"><div class="grow"></div>
      <div class="fit"><button class="btn" id="hnew">＋ 新增員工</button></div></div></div>
    <div class="card" id="htable"><div class="empty">載入中…</div></div>`;
  load();
};
