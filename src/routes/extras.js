// 後台 API：禮物與親密度、背包、客服單／考核／意見箱、投票
const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const G = require('../util/gifts');

const router = express.Router();
router.use(requireAuth());

// ---------------- 禮物與親密度 ----------------
router.use(['/gifts', '/intimacy'], guardModule('gifts'));
router.get('/gifts', (req, res) => {
  res.json({
    catalog: db.prepare('SELECT * FROM gift_catalog WHERE guild_id=? ORDER BY sort, price').all(req.orgId),
    logs: db.prepare('SELECT * FROM gift_logs WHERE guild_id=? ORDER BY id DESC LIMIT 200').all(req.orgId)
  });
});
router.post('/gifts', (req, res) => {
  const { key, name, emoji = '🎁', price = 0, intimacy = 0, sort = 0 } = req.body || {};
  if (!key || !name) return res.status(400).json({ error: '請填寫代號與名稱' });
  db.prepare(`INSERT INTO gift_catalog (guild_id, key, name, emoji, price, intimacy, sort) VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(guild_id, key) DO UPDATE SET name=excluded.name, emoji=excluded.emoji,
                price=excluded.price, intimacy=excluded.intimacy, sort=excluded.sort, active=1`)
    .run(req.orgId, key, name, emoji, Math.round(price), Math.round(intimacy), Math.round(sort));
  audit(req.user.name, '設定禮物款式', name, req.orgId);
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
  res.json(db.prepare(`SELECT i.*, s.name staff_name, s.code staff_code, c.name customer_name
    FROM intimacy i
    LEFT JOIN staff s ON s.guild_id=i.guild_id AND s.user_id=i.staff_id
    LEFT JOIN customers c ON c.guild_id=i.guild_id AND c.user_id=i.customer_id
    WHERE i.guild_id=? ORDER BY i.points DESC LIMIT 200`).all(req.orgId));
});
router.post('/intimacy/adjust', (req, res) => {
  const { customer_id, staff_id, delta } = req.body || {};
  const pts = G.addIntimacy(req.orgId, String(customer_id), String(staff_id), Number(delta));
  audit(req.user.name, '親密度調整', `${customer_id}×${staff_id} ${delta}`, req.orgId);
  res.json({ points: pts, rank: G.rankOf(pts) });
});

// ---------------- 背包 ----------------
router.use('/backpack', guardModule('backpack'));
router.get('/backpack', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.user_id) { cond.push('user_id = ?'); args.push(req.query.user_id); }
  res.json(db.prepare(`SELECT * FROM backpack WHERE ${cond.join(' AND ')} ORDER BY user_id, id`).all(...args));
});
router.post('/backpack', (req, res) => {
  const { user_id, key, name, qty = 1, value = 0, expires = null } = req.body || {};
  if (!user_id || !key || !name) return res.status(400).json({ error: '請填寫對象、道具代號與名稱' });
  G.addItem(req.orgId, String(user_id), { key, name, qty, value, expires });
  audit(req.user.name, '發放道具', `${name}×${qty} → ${user_id}`, req.orgId);
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
  res.json(db.prepare(`SELECT * FROM tickets WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args));
});
router.post('/tickets/:id/close', (req, res) => {
  db.prepare("UPDATE tickets SET status='closed', closed_at=datetime('now','localtime') WHERE id=? AND guild_id=?")
    .run(req.params.id, req.orgId);
  res.json({ ok: true });
});
router.get('/exams', (req, res) =>
  res.json(db.prepare('SELECT * FROM exams WHERE guild_id=? ORDER BY id DESC LIMIT 200').all(req.orgId)));
router.put('/exams/:id', (req, res) => {
  const st = ['pending', 'passed', 'failed'].includes(req.body?.status) ? req.body.status : 'pending';
  db.prepare('UPDATE exams SET status=? WHERE id=? AND guild_id=?').run(st, req.params.id, req.orgId);
  audit(req.user.name, '考核審核', `#${req.params.id} ${st}`, req.orgId);
  res.json({ ok: true });
});
router.get('/suggestions', (req, res) => {
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (req.query.kind) { cond.push('kind = ?'); args.push(req.query.kind); }
  res.json(db.prepare(`SELECT * FROM suggestions WHERE ${cond.join(' AND ')} ORDER BY id DESC LIMIT 200`).all(...args));
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
