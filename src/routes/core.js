// 後台 API：總覽、訂單、金庫、薪資、老闆、人事
const express = require('express');
const { db, monthPrefix, addCoins, getCustomer, refreshVip, audit } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const M = require('../util/money');
const R = require('../util/reports');

const router = express.Router();
router.use(requireAuth());

const page = req => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  return { limit, offset };
};

// ---------------- 總覽 ----------------
router.get('/dashboard', (req, res) => {
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
router.get('/bank', (req, res) => {
  const { limit, offset } = page(req);
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.user_id) { cond.push('user_id = ?'); args.push(req.query.user_id); }
  const where = cond.join(' AND ');
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
  const { user_id, delta, reason } = req.body || {};
  const bal = addCoins(req.orgId, String(user_id), Number(delta), reason || '後台調整',
    { operator: req.user.name || req.user.username, allowNegative: !!req.body.force });
  res.json({ ok: true, balance: bal });
});

// ---------------- 薪資與提領 ----------------
router.use('/salary', guardModule('salary'));
router.get('/salary', (req, res) => {
  res.json({
    staff: db.prepare(`SELECT * FROM staff WHERE guild_id=? AND active=1 ORDER BY income DESC`).all(req.orgId),
    withdrawals: db.prepare(`SELECT w.*, s.name, s.code FROM withdrawals w
      LEFT JOIN staff s ON s.guild_id=w.guild_id AND s.user_id=w.staff_id
      WHERE w.guild_id=? ORDER BY w.id DESC LIMIT 200`).all(req.orgId)
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
router.get('/customers', (req, res) => {
  const { limit, offset } = page(req);
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.q) { cond.push('(user_id LIKE ? OR name LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json({
    total: db.prepare(`SELECT COUNT(*) c FROM customers WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY total_spend DESC LIMIT ? OFFSET ?`)
      .all(...args, limit, offset)
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
router.get('/staff', (req, res) => {
  res.json(db.prepare(`SELECT * FROM staff WHERE guild_id=? ORDER BY active DESC, kind, code`).all(req.orgId));
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
