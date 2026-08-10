// 後台 API：禮物與親密度、背包、客服單／考核／意見箱、投票
const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const G = require('../util/gifts');

const router = express.Router();

// 統一的分頁與關鍵字篩選（避免資料量大時一次撈爆）
const page = req => ({
  limit: Math.min(500, Math.max(1, Number(req.query.limit) || 50)),
  offset: Math.max(0, Number(req.query.offset) || 0)
});
const listed = (sql, countSql, args, req) => {
  const { limit, offset } = page(req);
  return {
    total: db.prepare(countSql).get(...args).c,
    rows: db.prepare(sql + ' LIMIT ? OFFSET ?').all(...args, limit, offset)
  };
};
router.use(requireAuth());

// ---------------- 禮物與親密度 ----------------
router.use(['/gifts', '/intimacy'], guardModule('gifts'));
router.get('/gifts', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.customer_id) { cond.push('customer_id = ?'); args.push(req.query.customer_id); }
  if (req.query.staff_id) { cond.push('staff_id = ?'); args.push(req.query.staff_id); }
  if (req.query.from) { cond.push('date(created_at) >= date(?)'); args.push(req.query.from); }
  if (req.query.to) { cond.push('date(created_at) <= date(?)'); args.push(req.query.to); }
  if (req.query.q) { cond.push('(gift_name LIKE ? OR order_no LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json({
    catalog: db.prepare('SELECT * FROM gift_catalog WHERE guild_id=? ORDER BY sort, price').all(req.orgId),
    ...listed(`SELECT * FROM gift_logs WHERE ${where} ORDER BY id DESC`,
              `SELECT COUNT(*) c FROM gift_logs WHERE ${where}`, args, req)
  });
});
router.post('/gifts', (req, res) => {
  const { key, name, emoji = '🎁', price = 0, intimacy = 0, sort = 0 } = req.body || {};
  if (!key || !name) return res.status(400).json({ error: '請填寫代號與名稱' });
  db.prepare(`INSERT INTO gift_catalog (guild_id, key, name, emoji, price, intimacy, sort) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(guild_id, key) DO UPDATE SET name=excluded.name, emoji=excluded.emoji,
                price=excluded.price, intimacy=excluded.intimacy, sort=excluded.sort, active=1`)
    .run(req.orgId, key, name, emoji, Math.round(price), Math.round(intimacy), Math.round(sort));
  audit(req.user.name, '設定禮物款式', name, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.delete('/gifts/:key', (req, res) => {
  db.prepare('UPDATE gift_catalog SET active=0 WHERE guild_id=? AND key=?').run(req.orgId, req.params.key);
  res.json({ ok: true });
});
router.post('/gifts/send', (req, res) => {
  res.json(G.sendGift({ guildId: req.orgId, ...req.body, operator: req.user.name || req.user.username }));
});

router.get('/intimacy', (req, res) => {
  const cond = ['i.guild_id = ?'], args = [req.orgId];
  if (req.query.customer_id) { cond.push('i.customer_id = ?'); args.push(req.query.customer_id); }
  if (req.query.staff_id) { cond.push('i.staff_id = ?'); args.push(req.query.staff_id); }
  if (req.query.min) { cond.push('i.points >= ?'); args.push(Number(req.query.min) || 0); }
  if (req.query.q) { cond.push('(s.name LIKE ? OR s.code LIKE ? OR c.name LIKE ?)');
    args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  const base = `FROM intimacy i
    LEFT JOIN staff s ON s.guild_id=i.guild_id AND s.user_id=i.staff_id
    LEFT JOIN customers c ON c.guild_id=i.guild_id AND c.user_id=i.customer_id
    WHERE ${where}`;
  res.json(listed(`SELECT i.*, s.name staff_name, s.code staff_code, c.name customer_name ${base} ORDER BY i.points DESC`,
                  `SELECT COUNT(*) c ${base}`, args, req));
});
router.post('/intimacy/adjust', (req, res) => {
  const { customer_id, staff_id, delta } = req.body || {};
  const pts = G.addIntimacy(req.orgId, String(customer_id), String(staff_id), Number(delta));
  audit(req.user.name, '親密度調整', `${customer_id}×${staff_id} ${delta}`, req.orgId, { source: 'web' });
  res.json({ points: pts, rank: G.rankOf(pts) });
});

// ---------------- 背包 ----------------
router.use('/backpack', guardModule('backpack'));
router.get('/backpack', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.user_id) { cond.push('user_id = ?'); args.push(req.query.user_id); }
  if (req.query.type === 'coupon') cond.push('(value > 0 OR percent > 0)');
  if (req.query.type === 'item') cond.push('(value = 0 AND percent = 0)');
  if (req.query.expiring) cond.push("(expires IS NOT NULL AND expires <> '' AND date(expires) <= date('now','+7 days'))");
  if (req.query.q) { cond.push('(name LIKE ? OR item_key LIKE ?)'); args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json(listed(`SELECT * FROM backpack WHERE ${where} ORDER BY user_id, id`,
                  `SELECT COUNT(*) c FROM backpack WHERE ${where}`, args, req));
});
router.post('/backpack', (req, res) => {
  const { user_id, key, name, qty = 1, value = 0, percent = 0, min_spend = 0, expires = null } = req.body || {};
  if (!user_id || !key || !name) return res.status(400).json({ error: '請填寫對象、道具代號與名稱' });
  G.addItem(req.orgId, String(user_id), { key, name, qty, value, percent, minSpend: min_spend, expires });
  audit(req.user.name, '發放道具', `${name}×${qty} → ${user_id}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.delete('/backpack/:id', (req, res) => {
  db.prepare('DELETE FROM backpack WHERE id=? AND guild_id=?').run(req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---------------- 客服單 / 考核 / 意見箱 ----------------
router.use(['/tickets', '/exams', '/suggestions'], guardModule('tickets'));
router.get('/tickets', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.status) { cond.push('status = ?'); args.push(req.query.status); }
  if (req.query.kind) { cond.push('kind = ?'); args.push(req.query.kind); }
  if (req.query.publish) { cond.push('publish = ?'); args.push(req.query.publish); }
  if (req.query.customer_id) { cond.push('customer_id = ?'); args.push(req.query.customer_id); }
  if (req.query.from) { cond.push('date(created_at) >= date(?)'); args.push(req.query.from); }
  if (req.query.to) { cond.push('date(created_at) <= date(?)'); args.push(req.query.to); }
  if (req.query.q) { cond.push('(subject LIKE ? OR service LIKE ? OR CAST(seq AS TEXT) LIKE ?)');
    args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json(listed(`SELECT * FROM tickets WHERE ${where} ORDER BY id DESC`,
                  `SELECT COUNT(*) c FROM tickets WHERE ${where}`, args, req));
});
router.post('/tickets/:id/close', (req, res) => {
  db.prepare("UPDATE tickets SET status='closed', closed_at=datetime('now','localtime') WHERE id=? AND guild_id=?")
    .run(req.params.id, req.orgId);
  res.json({ ok: true });
});
router.get('/exams', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.status) { cond.push('status = ?'); args.push(req.query.status); }
  if (req.query.q) { cond.push('(nickname LIKE ? OR subject LIKE ? OR grade LIKE ?)');
    args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json(listed(`SELECT * FROM exams WHERE ${where} ORDER BY id DESC`,
                  `SELECT COUNT(*) c FROM exams WHERE ${where}`, args, req));
});
router.put('/exams/:id', (req, res) => {
  const st = ['pending', 'passed', 'failed'].includes(req.body?.status) ? req.body.status : 'pending';
  db.prepare('UPDATE exams SET status=? WHERE id=? AND guild_id=?').run(st, req.params.id, req.orgId);
  audit(req.user.name, '考核審核', `#${req.params.id} ${st}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.get('/suggestions', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.kind) { cond.push('kind = ?'); args.push(req.query.kind); }
  if (req.query.handled !== undefined && req.query.handled !== '') {
    cond.push('handled = ?'); args.push(req.query.handled === '1' ? 1 : 0);
  }
  if (req.query.from) { cond.push('date(created_at) >= date(?)'); args.push(req.query.from); }
  if (req.query.to) { cond.push('date(created_at) <= date(?)'); args.push(req.query.to); }
  if (req.query.q) { cond.push('content LIKE ?'); args.push(`%${req.query.q}%`); }
  const where = cond.join(' AND ');
  res.json(listed(`SELECT * FROM suggestions WHERE ${where} ORDER BY id DESC`,
                  `SELECT COUNT(*) c FROM suggestions WHERE ${where}`, args, req));
});
router.put('/suggestions/:id', (req, res) => {
  db.prepare('UPDATE suggestions SET handled=? WHERE id=? AND guild_id=?')
    .run(req.body?.handled ? 1 : 0, req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---------------- 投票 ----------------
router.use('/polls', guardModule('polls'));
router.get('/polls', (req, res) => {
  const rows = db.prepare('SELECT * FROM polls WHERE guild_id=? ORDER BY id DESC LIMIT 100').all(req.guildId);
  const counts = db.prepare('SELECT poll_id, choice, COUNT(*) c FROM poll_votes GROUP BY poll_id, choice').all();
  res.json(rows.map(p => ({
    ...p,
    options: JSON.parse(p.options),
    votes: counts.filter(c => c.poll_id === p.id).reduce((a, c) => (a[c.choice] = c.c, a), {})
  })));
});
router.post('/polls/:id/close', (req, res) => {
  db.prepare('UPDATE polls SET closed=1 WHERE id=? AND guild_id=?').run(req.params.id, req.guildId);
  res.json({ ok: true });
});

module.exports = router;
