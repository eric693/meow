// 收款對帳：把「錢不在系統裡」的兩種紀錄攤在同一頁
// 1) 現金／轉帳單：系統收不到款，開單時一律卡「待確認收款」，抽成不入帳、不可核銷
// 2) 人工儲值：一定要留匯款憑證（後五碼／時間），沒留的在這裡標紅

Pages.reconcile = async view => {
  const today = () => new Date().toLocaleDateString('sv-SE');
  const ST = { date: today() };

  const load = async () => {
    const d = await GET('/reconcile?date=' + encodeURIComponent(ST.date));
    const s = d.summary;

    document.getElementById('rsum').innerHTML = `
      ${H.stat('待確認收款', H.n(s.pending_count) + ' 筆', { accent: s.pending_count > 0 })}
      ${H.stat('待確認金額', H.n(s.pending_amount))}
      ${H.stat('未付出的抽成', H.n(s.pending_share), { small: true })}
      ${H.stat('當日現金單', `${H.n(s.cash_count)} 筆 / ${H.n(s.cash_amount)}`)}
      ${H.stat('當日儲值', `${H.n(s.topup_count)} 筆 / ${H.n(s.topup_amount)}`, { accent: true })}
      ${H.stat('儲值缺憑證', H.n(s.topup_noproof) + ' 筆', { accent: s.topup_noproof > 0 })}`;

    // ---- 待確認收款（不分日期，全部列出來，這是真正的曝險）----
    document.getElementById('rpending').innerHTML = `
      <h3>⚠️ 待確認收款的現金／轉帳單（全部）</h3>
      <p class="muted">錢還沒確認進來，陪玩抽成不會入帳、也不能核銷。收到款後按「已收到款」才轉正。</p>
      ${d.pending.length ? `<div class="table-wrap"><table>
        <thead><tr><th>交易時間</th><th>訂單編號</th><th>金主</th><th>陪玩</th>
          <th class="num">實收</th><th class="num">陪玩抽成</th><th>經辦客服</th><th>操作</th></tr></thead>
        <tbody>${d.pending.map(o => `<tr>
          <td>${H.esc(o.created_at)}</td>
          <td><code>${UI.esc(o.order_no)}</code></td>
          <td title="${UI.esc(o.customer_id)}">${UI.esc(o.customer_name || o.customer_id)}</td>
          <td title="${UI.esc(o.staff_id)}">${UI.esc(o.staff_name || o.staff_id)}</td>
          <td class="num"><b>${H.n(o.amount)}</b></td>
          <td class="num">${H.n(o.staff_share)}</td>
          <td>${UI.esc(o.cs_name || '')}</td>
          <td><button class="btn ok sm" data-confirm="${UI.esc(o.order_no)}"
                data-amount="${o.amount}">已收到款</button></td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">沒有待確認的現金單 👍</div>'}`;

    view.querySelectorAll('[data-confirm]').forEach(b => b.onclick = () => UI.modal({
      title: `確認收到款項 ${b.dataset.confirm}`,
      okText: '確定已收到款', okClass: 'btn ok',
      bodyHTML: `<div class="muted">金額：<b>${H.n(b.dataset.amount)}</b></div>
        <label class="f"><span>匯款憑證（選填但建議填）</span>
          <input name="proof" placeholder="例：帳號後五碼 12345，或匯款時間 14:30"></label>
        <div class="muted">確認後陪玩抽成才會入帳、這張單才能核銷。</div>`,
      onOk: async back => {
        await POST(`/reconcile/${encodeURIComponent(b.dataset.confirm)}/confirm`,
          { proof: UI.val(back, 'proof') });
        UI.ok('已確認收款'); load();
      }
    }));

    // ---- 當日現金單 ----
    document.getElementById('rcash').innerHTML = `
      <h3>💵 ${UI.esc(d.date)} 的現金／轉帳單</h3>
      ${d.cash.length ? `<div class="table-wrap"><table>
        <thead><tr><th>時間</th><th>訂單編號</th><th>金主</th><th class="num">實收</th>
          <th>收款狀態</th><th>憑證</th><th>經辦客服</th></tr></thead>
        <tbody>${d.cash.map(o => `<tr>
          <td>${H.esc(o.created_at).slice(11)}</td>
          <td><code>${UI.esc(o.order_no)}</code></td>
          <td>${UI.esc(o.customer_name || o.customer_id)}</td>
          <td class="num"><b>${H.n(o.amount)}</b></td>
          <td>${o.status === 'refunded' ? '<span class="tag err">已退單</span>'
              : (Number(o.cash_confirmed) ? '<span class="tag ok">已收款</span>'
                                          : '<span class="tag warn">待確認</span>')}</td>
          <td>${UI.esc(o.cash_proof || '') || '<span class="muted">—</span>'}</td>
          <td>${UI.esc(o.cs_name || '')}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">這天沒有現金／轉帳單</div>'}`;

    // ---- 當日人工儲值 ----
    document.getElementById('rtopup').innerHTML = `
      <h3>🪙 ${UI.esc(d.date)} 的儲值紀錄</h3>
      <p class="muted">拿這張表直接對銀行帳單：每一筆都該找得到對應的入帳。</p>
      ${d.topups.length ? `<div class="table-wrap"><table>
        <thead><tr><th>時間</th><th>老闆</th><th class="num">金額</th>
          <th>匯款憑證</th><th>事由</th><th>經辦</th></tr></thead>
        <tbody>${d.topups.map(t => `<tr>
          <td>${H.esc(t.created_at).slice(11)}</td>
          <td><span title="${UI.esc(t.user_id)}">${UI.esc(t.user_id)}</span></td>
          <td class="num"><b>${H.n(t.delta)}</b></td>
          <td>${String(t.proof || '').trim()
              ? UI.esc(t.proof) : '<span class="tag err">未留憑證</span>'}</td>
          <td>${UI.esc(t.reason || '')}</td>
          <td>${UI.esc(t.operator || '') || '<span class="muted">系統</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="empty">這天沒有儲值紀錄</div>'}`;
  };

  view.innerHTML = `
    <div class="grid c3" id="rsum" style="margin-bottom:16px"></div>
    <div class="card"><div class="row">
      <label class="f"><span>對帳日期</span><input type="date" id="rdate" value="${ST.date}"></label>
      <div class="fit" style="align-self:flex-end"><button class="btn" id="rgo">🔍 查詢</button></div>
      <div class="fit" style="align-self:flex-end"><button class="btn secondary" id="rtoday">今天</button></div>
    </div></div>
    <div class="card" id="rpending"><div class="empty">載入中…</div></div>
    <div class="card" id="rcash"></div>
    <div class="card" id="rtopup"></div>`;

  document.getElementById('rgo').onclick = () => {
    ST.date = document.getElementById('rdate').value || today();
    load();
  };
  document.getElementById('rtoday').onclick = () => {
    ST.date = today();
    document.getElementById('rdate').value = ST.date;
    load();
  };
  load();
};
