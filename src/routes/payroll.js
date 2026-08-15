// 後台 API：記帳 · 未發放薪資（新增／編輯／刪除／篩選／標記發放／儀表板／匯出）
const express = require('express');
const { db, audit } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const { sendExport } = require('../util/export');

const router = express.Router();
router.use(requireAuth());
router.use('/payroll', guardModule('payroll'));

const CATEGORIES = {
  salary:  '💰 薪資',
  bonus:   '🎁 獎金',
  subsidy: '🧾 補貼',
  advance: '💳 代墊款',
  other:   '📌 其他'
};
const STATUS = { unpaid: '未發放', paid: '已發放' };

const S = v => String(v ?? '').trim();
const N = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const who = req => req.user.name || req.user.username;

/** 篩選條件 → WHERE 片段，列表／統計／匯出共用 */
function where(req, skip = []) {
  const q = { ...req.query };
  for (const k of skip) delete q[k];
  const cond = ['guild_id = ?'], args = [req.orgId];
  if (S(q.status) && STATUS[q.status]) { cond.push('status = ?'); args.push(q.status); }
  if (S(q.category) && CATEGORIES[q.category]) { cond.push('category = ?'); args.push(q.category); }
  if (S(q.period)) { cond.push('period = ?'); args.push(S(q.period)); }
  if (S(q.staff)) { cond.push('(staff_id = ? OR staff_name LIKE ?)'); args.push(S(q.staff), `%${S(q.staff)}%`); }
  if (S(q.from)) { cond.push('date(created_at) >= date(?)'); args.push(S(q.from)); }
  if (S(q.to)) { cond.push('date(created_at) <= date(?)'); args.push(S(q.to)); }
  if (S(q.min_amount)) { cond.push('amount >= ?'); args.push(N(q.min_amount)); }
  if (S(q.max_amount)) { cond.push('amount <= ?'); args.push(N(q.max_amount)); }
  if (S(q.overdue) === '1') cond.push("status = 'unpaid' AND due_date != '' AND date(due_date) < date('now','localtime')");
  if (S(q.q)) {
    cond.push('(staff_name LIKE ? OR staff_id LIKE ? OR note LIKE ?)');
    const k = `%${S(q.q)}%`; args.push(k, k, k);
  }
  return { sql: cond.join(' AND '), args };
}

const SORTABLE = ['created_at', 'due_date', 'amount', 'period', 'staff_name', 'status'];
const orderBy = req => {
  const col = SORTABLE.includes(S(req.query.sort)) ? S(req.query.sort) : 'created_at';
  return `${col} ${S(req.query.dir) === 'asc' ? 'ASC' : 'DESC'}`;
};

const rowsOf = req => {
  const w = where(req);
  return db.prepare(`SELECT * FROM payroll_entries WHERE ${w.sql} ORDER BY ${orderBy(req)}`).all(...w.args);
};

// ---------------- 列表（含合計） ----------------
router.get('/payroll', (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = rowsOf(req);
  const sum = key => rows.filter(r => r.status === key).reduce((a, r) => a + r.amount, 0);
  res.json({
    total: rows.length,
    rows: rows.slice(offset, offset + limit),
    summary: {
      cnt: rows.length,
      unpaid_cnt: rows.filter(r => r.status === 'unpaid').length,
      unpaid: sum('unpaid'),
      paid: sum('paid'),
      total: rows.reduce((a, r) => a + r.amount, 0),
      overdue: rows.filter(r => r.status === 'unpaid' && r.due_date
        && r.due_date < new Date().toLocaleDateString('sv-SE')).reduce((a, r) => a + r.amount, 0)
    },
    categories: Object.entries(CATEGORIES).map(([k, t]) => ({ key: k, label: t })),
    statuses: Object.entries(STATUS).map(([k, t]) => ({ key: k, label: t }))
  });
});

// ---------------- 儀表板：月份長條圖／對象排行／類別佔比 ----------------
router.get('/payroll/stats', (req, res) => {
  const w = where(req);
  const months = Number(req.query.months) || 12;

  const list = [];
  const d = new Date();
  d.setDate(1);
  for (let i = months - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1);
    list.push(x.toLocaleDateString('sv-SE').slice(0, 7));
  }
  // 月份趨勢固定看全區間，不受「歸屬月份」篩選影響，否則只會剩一根柱子
  const wm = where(req, ['period']);
  const byPeriod = db.prepare(`
    SELECT period,
           SUM(CASE WHEN status='unpaid' THEN amount ELSE 0 END) unpaid,
           SUM(CASE WHEN status='paid'   THEN amount ELSE 0 END) paid,
           COUNT(*) cnt
      FROM payroll_entries WHERE ${wm.sql} AND period != '' GROUP BY period`).all(...wm.args);
  const map = new Map(byPeriod.map(r => [r.period, r]));
  const monthly = list.map(p => {
    const r = map.get(p) || {};
    return { label: p.slice(2), period: p, unpaid: r.unpaid || 0, paid: r.paid || 0, cnt: r.cnt || 0 };
  });

  const byStaff = db.prepare(`
    SELECT staff_id, staff_name, SUM(amount) amount, COUNT(*) cnt
      FROM payroll_entries WHERE ${w.sql} AND status='unpaid'
     GROUP BY staff_id, staff_name ORDER BY amount DESC LIMIT 10`).all(...w.args);

  const byCategory = db.prepare(`
    SELECT category, SUM(amount) amount FROM payroll_entries
     WHERE ${w.sql} AND status='unpaid' GROUP BY category ORDER BY amount DESC`).all(...w.args);

  res.json({
    monthly,
    top_staff: byStaff.map(r => ({ label: r.staff_name || r.staff_id || '（未填）', amount: r.amount, cnt: r.cnt })),
    by_category: byCategory.map(r => ({ label: CATEGORIES[r.category] || r.category, amount: r.amount }))
  });
});

// ---------------- 新增 ----------------
function payload(b) {
  const category = CATEGORIES[b.category] ? b.category : 'salary';
  const status = STATUS[b.status] ? b.status : 'unpaid';
  return {
    staff_id: S(b.staff_id),
    staff_name: S(b.staff_name),
    category,
    period: S(b.period) || new Date().toLocaleDateString('sv-SE').slice(0, 7),
    amount: N(b.amount),
    status,
    due_date: S(b.due_date),
    note: S(b.note)
  };
}

router.post('/payroll', (req, res) => {
  const f = payload(req.body || {});
  if (!f.staff_name && !f.staff_id) return res.status(400).json({ error: '請填寫對象名稱或 Discord ID' });
  if (f.amount === 0) return res.status(400).json({ error: '金額不能是 0' });
  const r = db.prepare(`INSERT INTO payroll_entries
      (guild_id, staff_id, staff_name, category, period, amount, status, due_date, paid_at, note, operator)
      VALUES (@guild_id, @staff_id, @staff_name, @category, @period, @amount, @status, @due_date, @paid_at, @note, @operator)`)
    .run({
      ...f, guild_id: req.orgId, operator: who(req),
      paid_at: f.status === 'paid' ? new Date().toLocaleString('sv-SE') : null
    });
  audit(who(req), '新增未發薪資', `${f.staff_name || f.staff_id}：${f.amount}`, req.orgId, { source: 'web' });
  res.json({ ok: true, id: r.lastInsertRowid });
});

// ---------------- 編輯 ----------------
router.put('/payroll/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM payroll_entries WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: '找不到這筆紀錄' });
  const f = payload({ ...cur, ...(req.body || {}) });
  db.prepare(`UPDATE payroll_entries SET staff_id=@staff_id, staff_name=@staff_name, category=@category,
                period=@period, amount=@amount, status=@status, due_date=@due_date, paid_at=@paid_at, note=@note
              WHERE id=@id AND guild_id=@guild_id`)
    .run({
      ...f, id: cur.id, guild_id: req.orgId,
      // 從未發放改成已發放才蓋發放時間，其餘沿用原值
      paid_at: f.status === 'paid' ? (cur.paid_at || new Date().toLocaleString('sv-SE')) : null
    });
  audit(who(req), '修改未發薪資', `#${cur.id} ${f.staff_name || f.staff_id}：${f.amount}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});

// ---------------- 標記已發放／改回未發放 ----------------
router.post('/payroll/:id/pay', (req, res) => {
  const cur = db.prepare('SELECT * FROM payroll_entries WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: '找不到這筆紀錄' });
  const paid = cur.status !== 'paid';
  db.prepare('UPDATE payroll_entries SET status=?, paid_at=? WHERE id=?')
    .run(paid ? 'paid' : 'unpaid', paid ? new Date().toLocaleString('sv-SE') : null, cur.id);
  audit(who(req), paid ? '標記薪資已發放' : '薪資改回未發放',
    `#${cur.id} ${cur.staff_name || cur.staff_id}：${cur.amount}`, req.orgId, { source: 'web' });
  res.json({ ok: true, status: paid ? 'paid' : 'unpaid' });
});

// 批次標記已發放
router.post('/payroll/pay-batch', (req, res) => {
  const ids = (req.body?.ids || []).map(Number).filter(Boolean);
  if (!ids.length) return res.status(400).json({ error: '沒有選取任何紀錄' });
  const at = new Date().toLocaleString('sv-SE');
  const st = db.prepare("UPDATE payroll_entries SET status='paid', paid_at=? WHERE id=? AND guild_id=? AND status='unpaid'");
  const tx = db.transaction(() => ids.reduce((n, id) => n + st.run(at, id, req.orgId).changes, 0));
  const n = tx();
  audit(who(req), '批次發放薪資', `${n} 筆`, req.orgId, { source: 'web' });
  res.json({ ok: true, updated: n });
});

// ---------------- 刪除 ----------------
router.delete('/payroll/:id', (req, res) => {
  const cur = db.prepare('SELECT * FROM payroll_entries WHERE id=? AND guild_id=?').get(req.params.id, req.orgId);
  if (!cur) return res.status(404).json({ error: '找不到這筆紀錄' });
  db.prepare('DELETE FROM payroll_entries WHERE id=?').run(cur.id);
  audit(who(req), '刪除未發薪資', `#${cur.id} ${cur.staff_name || cur.staff_id}：${cur.amount}`, req.orgId, { source: 'web' });
  res.json({ ok: true });
});

// ---------------- 匯出（帶著目前的篩選條件） ----------------
router.get('/exports/payroll', guardModule('payroll'), async (req, res) => {
  const rows = rowsOf(req);
  await sendExport(res, ['csv', 'xlsx', 'pdf'].includes(req.query.format) ? req.query.format : 'csv', {
    columns: [
      { key: 'period', label: '歸屬月份', width: 12 },
      { key: 'staff_name', label: '對象', width: 16 },
      { key: 'staff_id', label: 'Discord ID', width: 22 },
      { key: 'category', label: '項目', width: 10, map: v => (CATEGORIES[v] || v).replace(/^\S+\s/, '') },
      { key: 'amount', label: '金額', width: 12, num: 1 },
      { key: 'status', label: '狀態', width: 10, map: v => STATUS[v] || v },
      { key: 'due_date', label: '預計發放日', width: 14 },
      { key: 'paid_at', label: '實際發放時間', width: 20 },
      { key: 'note', label: '備註', width: 28 },
      { key: 'operator', label: '登錄人', width: 12 },
      { key: 'created_at', label: '建立時間', width: 20 }
    ],
    rows,
    filename: `未發放薪資_${new Date().toISOString().slice(0, 10)}`,
    title: '記帳 · 未發放薪資',
    summary: `共 ${rows.length} 筆｜未發放合計 ${rows.filter(r => r.status === 'unpaid')
      .reduce((a, r) => a + r.amount, 0).toLocaleString('en-US')}`
      + `｜已發放合計 ${rows.filter(r => r.status === 'paid').reduce((a, r) => a + r.amount, 0).toLocaleString('en-US')}`
  });
});

module.exports = router;
