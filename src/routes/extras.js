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
  try { G.assertPercent(percent); } catch (e) { return res.status(400).json({ error: e.message }); }
  G.addItem(req.orgId, String(user_id), { key, name, qty, value, percent, minSpend: min_spend, expires });
  audit(req.user.name, '發放道具', `${name}×${qty} → ${user_id}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.delete('/backpack/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM backpack WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: '找不到這筆道具' });
  db.prepare('DELETE FROM backpack WHERE id=?').run(cur.id);
  audit(req.user.name, '刪除道具', `${cur.name}×${cur.qty} ← ${cur.user_id}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
// 批次刪除：一次收掉多列
router.post('/backpack/delete-batch', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: '沒有選取任何道具' });
  const get = db.prepare('SELECT * FROM backpack WHERE id=? AND guild_id=?');
  const del = db.prepare('DELETE FROM backpack WHERE id=?');
  const tx = db.transaction(() => {
    let n = 0, qty = 0;
    for (const id of ids) {
      const cur = get.get(id, req.orgId);
      if (!cur) continue;
      del.run(cur.id); n++; qty += cur.qty;
    }
    return { n, qty };
  });
  const r = tx();
  audit(req.user.name, '批次刪除道具', `${r.n} 列、共 ${r.qty} 張`, req.orgId, { source: 'web' });
  res.json({ ok: true, deleted: r.n, qty: r.qty });
});
// 改數量：扣到 0（或填 0）就整列刪掉
router.put('/backpack/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM backpack WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: '找不到這筆道具' });
  const b = req.body || {};
  const qty = b.minus != null
    ? cur.qty - Math.max(0, Math.round(Number(b.minus) || 0))
    : Math.max(0, Math.round(Number(b.qty) || 0));
  if (qty <= 0) {
    db.prepare('DELETE FROM backpack WHERE id=?').run(cur.id);
    audit(req.user.name, '扣除道具', `${cur.name} 扣光（原 ${cur.qty} 張）← ${cur.user_id}`, req.orgId, { source: 'web' });
    return res.json({ ok: true, qty: 0, removed: true });
  }
  db.prepare('UPDATE backpack SET qty=? WHERE id=?').run(qty, cur.id);
  audit(req.user.name, '調整道具數量', `${cur.name} ${cur.qty} → ${qty} ← ${cur.user_id}`, req.orgId, { source: 'web' });
  res.json({ ok: true, qty });
});

// ---------------- 冠名／身份組期限 ----------------
router.use('/titles', guardModule('titles'));
router.get('/titles', (req, res) => {
  const T = require('../util/titles');
  const q = req.query;
  res.json(T.listTitles(req.orgId, {
    kind: q.kind || '', status: q.status ?? 'live', q: q.q || '',
    ...page(req)
  }));
});
router.post('/titles', (req, res) => {
  const T = require('../util/titles');
  const b = req.body || {};
  try {
    const t = T.addTitle(req.orgId, {
      kind: b.kind, name: b.name, days: Number(b.days) || 0,
      startAt: b.start_at || null, endAt: b.end_at || null,
      customerId: b.customer_id || '', customerName: b.customer_name || '',
      staffId: b.staff_id || '', staffName: b.staff_name || '',
      targetId: b.target_id || '', targetName: b.target_name || '',
      note: b.note || '', queueAfter: !!b.queue_after,
      operator: req.user.name || req.user.username, srcGuild: req.guildId
    });
    res.json(t);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
router.put('/titles/:id', (req, res) => {
  const b = req.body || {};
  const T = require('../util/titles');
  const t = db.prepare('SELECT * FROM titles WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!t) return res.status(404).json({ error: '查無這筆紀錄' });
  const start = b.start_at ? T.parseTime(b.start_at) : t.start_at;
  const end = b.end_at ? T.parseTime(b.end_at)
            : (b.days ? T.addDays(start, Number(b.days)) : t.end_at);
  if (!start || !end) return res.status(400).json({ error: '時間格式不正確' });
  db.prepare(`UPDATE titles SET name=?, customer_name=?, staff_name=?, target_name=?,
              days=?, start_at=?, end_at=?, note=?, status=?,
              notified_end=CASE WHEN ?>end_at THEN 0 ELSE notified_end END WHERE id=?`)
    .run(b.name ?? t.name, b.customer_name ?? t.customer_name, b.staff_name ?? t.staff_name,
         b.target_name ?? t.target_name, Number(b.days) || t.days, start, end,
         b.note ?? t.note, b.status || t.status, end, t.id);
  audit(req.user.name, '修改冠名／身份組', `#${t.id} ${b.name || t.name}`, req.orgId, { source: 'web' });
  res.json(db.prepare('SELECT * FROM titles WHERE id=?').get(t.id));
});
router.delete('/titles/:id', (req, res) => {
  db.prepare('DELETE FROM titles WHERE id=? AND guild_id=?').run(req.params.id, req.orgId);
  audit(req.user.name, '刪除冠名／身份組', `#${req.params.id}`, req.orgId, { source: 'web' });
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
  if (req.query.q) {
    cond.push('(content LIKE ? OR name LIKE ?)');
    args.push(`%${req.query.q}%`, `%${req.query.q}%`);
  }
  const where = cond.join(' AND ');
  res.json(listed(`SELECT * FROM suggestions WHERE ${where} ORDER BY id DESC`,
                  `SELECT COUNT(*) c FROM suggestions WHERE ${where}`, args, req));
});
router.put('/suggestions/:id', (req, res) => {
  db.prepare('UPDATE suggestions SET handled=? WHERE id=? AND guild_id=?')
    .run(req.body?.handled ? 1 : 0, req.params.id, req.orgId);
  res.json({ ok: true });
});

// ---------------- 喚雨星象：每日抽籤獎池 ----------------
router.use('/lottery', guardModule('polls'));
router.get('/lottery/prizes', (req, res) => {
  const L = require('../util/lottery');
  L.seed(req.orgId);
  const rows = db.prepare('SELECT * FROM lottery_prizes WHERE guild_id=? ORDER BY sort, id').all(req.orgId);
  const total = rows.filter(r => r.enabled && r.weight > 0).reduce((a, b) => a + b.weight, 0) || 1;
  res.json({
    rows: rows.map(r => ({ ...r, chance: r.enabled && r.weight > 0 ? +(r.weight / total * 100).toFixed(1) : 0 })),
    draws_today: db.prepare('SELECT COUNT(*) c FROM lottery_draws WHERE guild_id=? AND day=?')
      .get(req.orgId, L.today()).c
  });
});
const prizeFields = b => ({
  name: String(b.name || '').slice(0, 40),
  emoji: String(b.emoji || '').slice(0, 8),
  type: b.type === 'coupon' ? 'coupon' : 'fortune',
  value: Math.max(0, Math.round(Number(b.value) || 0)),
  percent: Math.min(100, Math.max(0, Math.round(Number(b.percent) || 0))),
  min_spend: Math.max(0, Math.round(Number(b.min_spend) || 0)),
  expire_days: Math.max(0, Math.round(Number(b.expire_days) || 0)),
  text: String(b.text || '').slice(0, 300),
  weight: Math.max(0, Math.round(Number(b.weight) || 0)),
  sort: Math.round(Number(b.sort) || 0),
  enabled: b.enabled ? 1 : 0
});
router.post('/lottery/prizes', (req, res) => {
  const f = prizeFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '請填籤名' });
  try { G.assertPercent(f.percent); } catch (e) { return res.status(400).json({ error: e.message }); }
  const r = db.prepare(`INSERT INTO lottery_prizes
    (guild_id,name,emoji,type,value,percent,min_spend,expire_days,text,weight,sort,enabled)
    VALUES (@guild_id,@name,@emoji,@type,@value,@percent,@min_spend,@expire_days,@text,@weight,@sort,@enabled)`)
    .run({ ...f, guild_id: req.orgId });
  audit(req.user.name, '新增抽籤獎項', f.name, req.orgId, { source: 'web' });
  res.json({ ok: true, id: r.lastInsertRowid });
});
router.put('/lottery/prizes/:id', (req, res) => {
  const f = prizeFields(req.body || {});
  if (!f.name) return res.status(400).json({ error: '請填籤名' });
  try { G.assertPercent(f.percent); } catch (e) { return res.status(400).json({ error: e.message }); }
  db.prepare(`UPDATE lottery_prizes SET name=@name, emoji=@emoji, type=@type, value=@value,
              percent=@percent, min_spend=@min_spend, expire_days=@expire_days, text=@text,
              weight=@weight, sort=@sort, enabled=@enabled
              WHERE id=@id AND guild_id=@guild_id`)
    .run({ ...f, id: Number(req.params.id), guild_id: req.orgId });
  audit(req.user.name, '修改抽籤獎項', f.name, req.orgId, { source: 'web' });
  res.json({ ok: true });
});
router.delete('/lottery/prizes/:id', (req, res) => {
  db.prepare('DELETE FROM lottery_prizes WHERE id=? AND guild_id=?').run(req.params.id, req.orgId);
  audit(req.user.name, '刪除抽籤獎項', `#${req.params.id}`, req.orgId, { source: 'web' });
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

// ---------------- 小工作台：自訂指令 ----------------
router.use('/snippets', guardModule('snippets'));
router.get('/snippets', (req, res) => {
  const SN = require('../util/snippets');
  res.json(SN.list(req.guildId, { activeOnly: false }));
});
router.post('/snippets', (req, res) => {
  const SN = require('../util/snippets');
  res.json(SN.save(req.guildId, req.body || {}, req.user.name));
});
router.put('/snippets/:id', (req, res) => {
  const SN = require('../util/snippets');
  res.json(SN.save(req.guildId, { ...(req.body || {}), id: Number(req.params.id) }, req.user.name));
});
router.delete('/snippets/:id', (req, res) => {
  const SN = require('../util/snippets');
  res.json(SN.remove(req.guildId, Number(req.params.id), req.user.name));
});

module.exports = router;
