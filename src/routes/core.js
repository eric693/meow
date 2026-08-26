// 後台 API：總覽、訂單、金庫、薪資、老闆、人事
const express = require('express');
const { db, monthPrefix, addCoins, getCustomer, refreshVip, audit } = require('../db');
const { requireAuth, guardModule, requireModule } = require('../auth');
const { sendExport } = require('../util/export');
const M = require('../util/money');
const R = require('../util/reports');

const router = express.Router();
router.use(requireAuth());

const page = req => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
};
/** 只允許白名單內的欄位排序，避免把使用者輸入直接接進 SQL */
const orderBy = (req, allowed, fallback) => {
  const col = allowed.includes(req.query.sort) ? req.query.sort : fallback;
  return `${col} ${req.query.dir === 'asc' ? 'ASC' : 'DESC'}`;
};
const num = v => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf'];
const exportFormat = req => (EXPORT_FORMATS.includes(req.query.format) ? req.query.format : 'csv');

// ---------------- 總覽 ----------------
router.get('/dashboard', requireModule('dashboard'), (req, res) => {
  const g = req.orgId;
  const f = R.financeReport(g);
  const coins = R.totalCoins(g);
  const pend = db.prepare('SELECT COALESCE(SUM(pending_income),0) p, COALESCE(SUM(income),0) i FROM staff WHERE guild_id=?').get(g);
  res.json({
    month: f.month,
    revenue: f.revenue, order_count: f.order_count, gift_revenue: f.gift_revenue,
    staff_share: f.staff_share, refund: f.refund, net: f.net, top3: f.top3,
    coins_total: coins.c, customer_count: coins.n,
    staff_income: pend.i, staff_pending: pend.p,
    unsettled: db.prepare("SELECT COUNT(*) c FROM orders WHERE guild_id=? AND status='pending'").get(g).c,
    staff_count: db.prepare("SELECT COUNT(*) c FROM staff WHERE guild_id=? AND active=1 AND kind='player'").get(g).c,
    cs_count: db.prepare("SELECT COUNT(*) c FROM staff WHERE guild_id=? AND active=1 AND kind='cs'").get(g).c,
    open_tickets: db.prepare("SELECT COUNT(*) c FROM tickets WHERE guild_id=? AND status!='closed'").get(g).c,
    pending_withdrawals: db.prepare("SELECT COUNT(*) c FROM withdrawals WHERE guild_id=? AND status='pending'").get(g).c,
    // 全期累計：原本掛在「交易流水帳」頁上方，但那頁之後要開給客服看訂單，
    // 財務數字不能讓他們看到，所以搬到只有管理層進得來的總覽。
    lifetime: db.prepare(`SELECT COUNT(*) cnt, COALESCE(SUM(list_price),0) list,
         COALESCE(SUM(amount),0) amount, COALESCE(SUM(staff_share),0) share,
         COALESCE(SUM(net),0) net
       FROM orders WHERE guild_id=? AND status<>'refunded'`).get(g),
    charts: R.dashboardCharts(g, f.month),
    recent: db.prepare('SELECT * FROM orders WHERE guild_id=? ORDER BY id DESC LIMIT 10').all(g),
    logs: db.prepare("SELECT * FROM audit_logs WHERE guild_id IN (?, '') ORDER BY id DESC LIMIT 15").all(g)
  });
});

// ---------------- 訂單 ----------------
router.use('/orders', guardModule('orders'));
router.get('/orders', (req, res) => {
  const { limit, offset } = page(req);
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.status) { cond.push('status = ?'); args.push(req.query.status); }
  if (req.query.source) { cond.push('source = ?'); args.push(req.query.source); }
  if (req.query.month) { cond.push('created_at LIKE ?'); args.push(req.query.month + '%'); }
  if (req.query.q) {
    cond.push('(order_no LIKE ? OR customer_id LIKE ? OR staff_id LIKE ? OR item LIKE ?)');
    const q = `%${req.query.q}%`; args.push(q, q, q, q);
  }
  const where = cond.join(' AND ');
  res.json({
    total: db.prepare(`SELECT COUNT(*) c FROM orders WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM orders WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset)
  });
});

router.post('/orders', (req, res) => {
  const o = M.createOrder({ ...req.body, guildId: req.orgId, operator: req.user.name || req.user.username });
  res.json(o);
});
router.post('/orders/:no/settle', (req, res) =>
  res.json(M.settleOrder(req.orgId, req.params.no, req.user.name || req.user.username)));
router.post('/orders/:no/refund', (req, res) =>
  res.json(M.refundOrder(req.orgId, req.params.no, req.user.name || req.user.username, req.body?.reason || '')));

// ---------------- 地下金庫（雨幣）----------------
router.use('/bank', guardModule('bank'));
/** 雨幣流水的查詢條件，列表與匯出共用 */
function bankWhere(req) {
  const q = req.query;
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (q.user_id) { cond.push('user_id = ?'); args.push(q.user_id); }
  if (q.q) { cond.push('(reason LIKE ? OR ref LIKE ? OR operator LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.dir_ === 'in') cond.push('delta > 0');
  if (q.dir_ === 'out') cond.push('delta < 0');
  if (q.from) { cond.push('created_at >= ?'); args.push(q.from); }
  if (q.to) { cond.push('created_at <= ?'); args.push(q.to + ' 23:59:59'); }
  if (num(q.min_amount) != null) { cond.push('ABS(delta) >= ?'); args.push(num(q.min_amount)); }
  return { where: cond.join(' AND '), args };
}
// 依目前的篩選條件匯出
router.get('/bank/export', async (req, res) => {
  const { where, args } = bankWhere(req);
  const rows = db.prepare(`SELECT * FROM coin_tx WHERE ${where} ORDER BY id DESC`).all(...args);
  const io = rows.reduce((a, r) => (r.delta > 0 ? { ...a, in: a.in + r.delta } : { ...a, out: a.out - r.delta }),
                         { in: 0, out: 0 });
  await sendExport(res, exportFormat(req), {
    columns: [
      { key: 'created_at', label: '時間', width: 18 },
      { key: 'user_id', label: '對象', width: 22 },
      { key: 'delta', label: '異動', width: 12, num: 1 },
      { key: 'balance', label: '異動後餘額', width: 14, num: 1 },
      { key: 'reason', label: '事由', width: 28 },
      { key: 'ref', label: '關聯單號', width: 18 },
      { key: 'operator', label: '經手人', width: 16 }
    ],
    rows,
    filename: `雨幣流水_${new Date().toISOString().slice(0, 10)}`,
    title: '雨幣流水帳',
    summary: `共 ${rows.length} 筆｜流入 ${io.in.toLocaleString('en-US')}｜流出 ${io.out.toLocaleString('en-US')}`
  });
});
router.get('/bank', (req, res) => {
  const { limit, offset } = page(req);
  const { where, args } = bankWhere(req);
  // 近 30 天雨幣流入／流出，與持有排行
  const flow = db.prepare(`SELECT substr(created_at,6,5) d,
                                  COALESCE(SUM(CASE WHEN delta > 0 THEN delta END),0) inflow,
                                  COALESCE(SUM(CASE WHEN delta < 0 THEN -delta END),0) outflow
                           FROM coin_tx WHERE guild_id=? AND created_at >= date('now','-29 days')
                           GROUP BY d ORDER BY d`).all(req.orgId)
    .map(r => ({ label: r.d, inflow: r.inflow, outflow: r.outflow }));
  const holders = db.prepare(`SELECT name, user_id, coins FROM customers
                              WHERE guild_id=? AND coins > 0 ORDER BY coins DESC LIMIT 8`).all(req.orgId)
    .map(c => ({ label: c.name || c.user_id, amount: c.coins }));

  res.json({
    summary: R.totalCoins(req.orgId),
    charts: { flow, holders },
    total: db.prepare(`SELECT COUNT(*) c FROM coin_tx WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM coin_tx WHERE ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset)
  });
});
router.post('/bank/adjust', (req, res) => {
  const { user_id, delta, reason, proof } = req.body || {};
  // 加幣（＝儲值）一定要留匯款憑證；扣款不用
  M.checkTopupProof(delta, proof);
  const bal = addCoins(req.orgId, String(user_id), Number(delta), reason || '後台調整',
    { operator: req.user.name || req.user.username, allowNegative: !!req.body.force, proof });
  res.json({ ok: true, balance: bal });
});

// ---------------- 薪資與提領 ----------------
router.use('/salary', guardModule('salary'));
router.get('/salary', (req, res) => {
  const { limit, offset } = page(req);
  const sc = ['guild_id = ?', 'active = 1'], sa = [req.orgId];
  if (req.query.q) { sc.push('(name LIKE ? OR code LIKE ? OR user_id LIKE ?)');
    sa.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  if (req.query.owed === '1') sc.push('(income > 0 OR pending_income > 0)');
  const wc = ['w.guild_id = ?'], wa = [req.orgId];
  if (req.query.status) { wc.push('w.status = ?'); wa.push(req.query.status); }
  if (req.query.month) { wc.push("strftime('%Y-%m', w.created_at) = ?"); wa.push(req.query.month); }
  if (req.query.q) { wc.push('(s.name LIKE ? OR s.code LIKE ?)'); wa.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const ww = wc.join(' AND ');
  res.json({
    staff: db.prepare(`SELECT * FROM staff WHERE ${sc.join(' AND ')} ORDER BY income DESC`).all(...sa),
    total: db.prepare(`SELECT COUNT(*) c FROM withdrawals w
      LEFT JOIN staff s ON s.guild_id=w.guild_id AND s.user_id=w.staff_id WHERE ${ww}`).get(...wa).c,
    withdrawals: db.prepare(`SELECT w.*, s.name, s.code FROM withdrawals w
      LEFT JOIN staff s ON s.guild_id=w.guild_id AND s.user_id=w.staff_id
      WHERE ${ww} ORDER BY w.id DESC LIMIT ? OFFSET ?`).all(...wa, limit, offset)
  });
});
router.post('/salary/withdraw', (req, res) =>
  res.json(M.requestWithdraw(req.orgId, String(req.body.staff_id), req.body.amount,
    req.user.name || req.user.username, req.body.note || '')));
router.post('/salary/withdraw/:id/:status', (req, res) => {
  const st = req.params.status === 'done' ? 'done' : 'rejected';
  res.json(M.reviewWithdraw(req.orgId, Number(req.params.id), st, req.user.name || req.user.username));
});

// ---------------- 老闆與 VIP ----------------
router.use('/customers', guardModule('customers'));
/** 老闆列表的查詢條件，列表與匯出共用 */
function customerQuery(req) {
  const q = req.query;
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (q.q) { cond.push('(user_id LIKE ? OR name LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`); }
  if (num(q.vip) != null) { cond.push('vip_level = ?'); args.push(num(q.vip)); }
  if (num(q.min_coins) != null) { cond.push('coins >= ?'); args.push(num(q.min_coins)); }
  if (num(q.max_coins) != null) { cond.push('coins <= ?'); args.push(num(q.max_coins)); }
  if (num(q.min_spend) != null) { cond.push('total_spend >= ?'); args.push(num(q.min_spend)); }
  if (q.locked === '1') cond.push('vip_locked = 1');
  if (q.locked === '0') cond.push('vip_locked = 0');
  return {
    where: cond.join(' AND '), args,
    order: orderBy(req, ['total_spend', 'coins', 'vip_level', 'territory', 'name'], 'total_spend')
  };
}
router.get('/customers', (req, res) => {
  const { limit, offset } = page(req);
  const { where, args, order } = customerQuery(req);
  res.json({
    total: db.prepare(`SELECT COUNT(*) c FROM customers WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
      .all(...args, limit, offset)
  });
});
// 依目前的篩選條件匯出（不分頁，全部撈）
router.get('/customers/export', async (req, res) => {
  const { where, args, order } = customerQuery(req);
  const rows = db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY ${order}`).all(...args);
  await sendExport(res, exportFormat(req), {
    columns: [
      { key: 'user_id', label: 'Discord ID', width: 22 },
      { key: 'name', label: '名稱', width: 18 },
      { key: 'coins', label: '雨幣餘額', width: 12, num: 1 },
      { key: 'total_spend', label: '累計消費', width: 14, num: 1 },
      { key: 'vip_level', label: 'VIP 等級', width: 10, map: v => `Lv.${v}` },
      { key: 'vip_locked', label: 'VIP 鎖定', width: 10, map: v => (v ? '是' : '') },
      { key: 'territory', label: '地盤', width: 8 }
    ],
    rows,
    filename: `老闆名單_${new Date().toISOString().slice(0, 10)}`,
    title: '老闆名單',
    summary: `共 ${rows.length} 位｜雨幣合計 ${rows.reduce((a, r) => a + r.coins, 0).toLocaleString('en-US')}`
           + `｜累計消費 ${rows.reduce((a, r) => a + r.total_spend, 0).toLocaleString('en-US')}`
  });
});
router.get('/customers/:id', (req, res) => {
  const g = req.orgId, id = req.params.id;
  res.json({
    customer: getCustomer(g, id),
    spend: R.customerSpend(g, id),
    orders: R.customerOrders(g, id, 50),
    gifts: db.prepare('SELECT * FROM gift_logs WHERE guild_id=? AND customer_id=? ORDER BY id DESC LIMIT 50').all(g, id),
    backpack: db.prepare('SELECT * FROM backpack WHERE guild_id=? AND user_id=?').all(g, id),
    coins: db.prepare('SELECT * FROM coin_tx WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 50').all(g, id)
  });
});
router.put('/customers/:id', (req, res) => {
  const { name, vip_level, vip_locked, territory } = req.body || {};
  const c = getCustomer(req.orgId, req.params.id);
  db.prepare('UPDATE customers SET name=?, vip_level=?, vip_locked=?, territory=? WHERE id=?')
    .run(name ?? c.name, vip_level ?? c.vip_level, vip_locked ? 1 : 0,
         Math.max(0, Math.min(21, territory ?? c.territory)), c.id);
  if (!vip_locked) refreshVip(req.orgId, req.params.id);
  audit(req.user.name, '更新老闆資料', req.params.id, req.orgId, { source: 'web' });
  res.json({ ok: true });
});

// ---------------- 人事 ----------------
router.use('/staff', guardModule('hr'));
/** 員工列表的查詢條件，列表與匯出共用 */
function staffRows(req) {
  const q = req.query;
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (q.q) { cond.push('(code LIKE ? OR name LIKE ? OR user_id LIKE ?)'); args.push(`%${q.q}%`, `%${q.q}%`, `%${q.q}%`); }
  if (q.kind === 'cs' || q.kind === 'player') { cond.push('kind = ?'); args.push(q.kind); }
  if (q.active === '1' || q.active === '0') { cond.push('active = ?'); args.push(Number(q.active)); }
  if (q.card === '1') cond.push("card_url != ''");
  if (q.card === '0') cond.push("card_url = ''");
  if (num(q.min_income) != null) { cond.push('income >= ?'); args.push(num(q.min_income)); }
  const order = q.sort
    ? orderBy(req, ['income', 'pending_income', 'joined_at', 'code', 'name'], 'income')
    : 'active DESC, kind, code';
  return db.prepare(`SELECT * FROM staff WHERE ${cond.join(' AND ')} ORDER BY ${order}`).all(...args);
}
// 舊版回傳純陣列，前端還在用；帶 paged=1 時才回 { total, rows }
router.get('/staff', (req, res) => {
  const rows = staffRows(req);
  if (!req.query.paged) return res.json(rows);
  const { limit, offset } = page(req);
  res.json({ total: rows.length, rows: rows.slice(offset, offset + limit) });
});
// 依目前的篩選條件匯出
router.get('/staff/export', async (req, res) => {
  const rows = staffRows(req);
  await sendExport(res, exportFormat(req), {
    columns: [
      { key: 'code', label: '代號', width: 12 },
      { key: 'name', label: '藝名', width: 16 },
      { key: 'user_id', label: 'Discord ID', width: 22 },
      { key: 'kind', label: '職務', width: 8, map: v => (v === 'cs' ? '客服' : '陪玩') },
      { key: 'active', label: '狀態', width: 8, map: v => (v ? '在職' : '離職') },
      { key: 'income', label: '可提領', width: 12, num: 1 },
      { key: 'pending_income', label: '暫存薪水', width: 12, num: 1 },
      { key: 'total_income', label: '歷史入帳', width: 14, num: 1 },
      { key: 'card_url', label: '影音名片', width: 30 },
      { key: 'joined_at', label: '入職日', width: 18 }
    ],
    rows,
    filename: `員工名單_${new Date().toISOString().slice(0, 10)}`,
    title: '員工名單',
    summary: `共 ${rows.length} 位｜可提領合計 ${rows.reduce((a, r) => a + r.income, 0).toLocaleString('en-US')}`
           + `｜暫存薪水合計 ${rows.reduce((a, r) => a + r.pending_income, 0).toLocaleString('en-US')}`
  });
});
router.post('/staff', (req, res) => {
  const { user_id, code, name, card_url = '', kind = 'player' } = req.body || {};
  if (!user_id || !code || !name) return res.status(400).json({ error: '請填寫 Discord ID、代號與藝名' });
  db.prepare(`INSERT INTO staff (guild_id, user_id, code, name, card_url, kind) VALUES (?,?,?,?,?,?)
              ON CONFLICT(guild_id, user_id) DO UPDATE SET code=excluded.code, name=excluded.name,
                card_url=excluded.card_url, kind=excluded.kind, active=1`)
    .run(req.orgId, String(user_id), code, name, card_url, kind === 'cs' ? 'cs' : 'player');
  audit(req.user.name, '新增／更新員工', `${name}(${code})`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.put('/staff/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: '查無員工' });
  const b = req.body || {};
  db.prepare('UPDATE staff SET code=?, name=?, card_url=?, kind=?, active=? WHERE id=?')
    .run(b.code ?? s.code, b.name ?? s.name, b.card_url ?? s.card_url,
         b.kind ?? s.kind, b.active == null ? s.active : (b.active ? 1 : 0), s.id);
  audit(req.user.name, '編輯員工', s.name, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.delete('/staff/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: '查無員工' });
  db.transaction(() => {
    db.prepare('DELETE FROM staff WHERE id=?').run(s.id);
    db.prepare('DELETE FROM intimacy WHERE guild_id=? AND staff_id=?').run(req.orgId, s.user_id);
    db.prepare('DELETE FROM gift_logs WHERE guild_id=? AND staff_id=?').run(req.orgId, s.user_id);
  })();
  audit(req.user.name, '員工離職', `${s.name}(${s.code})`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.get('/staff/:id/detail', (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!s) return res.status(404).json({ error: '查無員工' });
  res.json({ staff: s, detail: R.staffDetail(req.orgId, s.user_id, 10) });
});

module.exports = router;
