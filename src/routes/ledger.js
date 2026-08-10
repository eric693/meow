// 後台 API：交易流水帳（全欄位 CRUD、篩選、匯出 CSV/Excel/PDF、歷史 CSV 匯入）
const express = require('express');
const { db, monthPrefix, orgOf, getStaff, getCustomer, audit } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const M = require('../util/money');
const R = require('../util/reports');
const { sendExport } = require('../util/export');

const router = express.Router();
router.use(requireAuth());
router.use(['/ledger', '/exports'], guardModule('orders'));

const who = req => req.user.name || req.user.username;
const filtersFrom = q => ({
  month: q.month || '', from: q.from || '', to: q.to || '',
  kind: q.kind || '', status: q.status || '', source: q.source || '',
  cs: q.cs || '', customer: q.customer || '', staff: q.staff || '',
  min_amount: q.min_amount ?? '', max_amount: q.max_amount ?? '',
  q: q.q || '', sort: q.sort || '', dir: q.dir || ''
});

// ---------------- 查詢 ----------------
router.get('/ledger', (req, res) => {
  const f = filtersFrom(req.query);
  f.limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
  f.offset = Math.max(0, Number(req.query.offset) || 0);
  const r = R.ledgerQuery(req.orgId, f);
  res.json({
    ...r,
    kinds: Object.entries(M.KINDS).map(([k, v]) => ({ key: k, label: `${v.emoji} ${v.label}` })),
    statuses: Object.entries(M.STATUS).map(([k, v]) => ({ key: k, label: v }))
  });
});

// ---------------- 新增 ----------------
router.post('/ledger', (req, res) => {
  const b = req.body || {};
  const o = M.createOrder({
    guildId: req.orgId,
    customerId: String(b.customer_id || '').trim(),
    customerName: b.customer_name || '',
    staffId: String(b.staff_id || '').trim(),
    staffName: b.staff_name || '',
    csId: String(b.cs_id || '').trim(),
    csName: b.cs_name || '',
    kind: b.kind || 'order',
    item: b.item || '',
    qty: b.qty ?? 1,
    unitPrice: b.unit_price ?? 0,
    listPrice: b.list_price,
    amount: b.amount,
    staffShare: b.staff_share,
    source: b.source || 'manual',
    payMethod: b.pay_method || '雨幣扣款',
    status: ['pending', 'settled', 'refunded'].includes(b.status) ? b.status : 'pending',
    createdAt: b.created_at || null,
    note: b.note || '',
    operator: who(req)
  });
  res.json(o);
});

// ---------------- 編輯 / 刪除 / 核銷 / 退單 ----------------
router.put('/ledger/:no', (req, res) => res.json(M.updateOrder(req.orgId, req.params.no, req.body || {}, who(req))));
router.delete('/ledger/:no', (req, res) => res.json(M.deleteOrder(req.orgId, req.params.no, who(req))));
router.post('/ledger/:no/settle', (req, res) => res.json(M.settleOrder(req.orgId, req.params.no, who(req))));
router.post('/ledger/:no/refund', (req, res) =>
  res.json(M.refundOrder(req.orgId, req.params.no, who(req), req.body?.reason || '')));

// 批次核銷
router.post('/ledger/bulk/settle', (req, res) => {
  const list = Array.isArray(req.body?.order_nos) ? req.body.order_nos : [];
  const done = [], failed = [];
  for (const no of list) {
    try { M.settleOrder(req.orgId, no, who(req)); done.push(no); }
    catch (e) { failed.push({ order_no: no, error: e.message }); }
  }
  res.json({ done: done.length, failed });
});

// ---------------- 匯出：流水帳 / 金主榜 / 業績 / 提領 ----------------
const FORMATS = ['csv', 'xlsx', 'pdf'];
const fmt = req => (FORMATS.includes(req.query.format) ? req.query.format : 'csv');
const money = v => Number(v || 0).toLocaleString('en-US');

router.get('/exports/ledger', async (req, res) => {
  const f = filtersFrom(req.query);
  f.limit = 0;
  const { rows, summary } = R.ledgerQuery(req.orgId, f);
  const range = f.month || (f.from || f.to ? `${f.from || '起始'}~${f.to || '今天'}` : '全部');
  await sendExport(res, fmt(req), {
    columns: R.LEDGER_COLUMNS,
    rows,
    filename: `財務流水帳_${(f.month || 'all').replace('-', '')}`,
    title: '財務流水帳',
    summary: `區間 ${range}｜${summary.cnt} 筆｜原價 ${money(summary.list)}｜實收 ${money(summary.amount)}`
           + `｜抽成 ${money(summary.share)}｜淨利 ${money(summary.net)}`
  });
});

router.get('/exports/patrons', async (req, res) => {
  const month = req.query.month || monthPrefix();
  const rows = R.patronBoard(req.orgId, month);
  await sendExport(res, fmt(req), {
    columns: R.PATRON_COLUMNS, rows,
    filename: `金主消費總表_${month.replace('-', '')}`,
    title: '金主消費總表',
    summary: `本月 ${month}｜共 ${rows.length} 位金主｜歷史總消費 ${money(rows.reduce((a, r) => a + r.total_spend, 0))}`
  });
});

router.get('/exports/staff', async (req, res) => {
  const month = req.query.month || monthPrefix();
  const rows = R.staffRanking(req.orgId, month);
  await sendExport(res, fmt(req), {
    columns: R.STAFF_COLUMNS, rows,
    filename: `陪玩業績表_${month.replace('-', '')}`,
    title: '陪玩業績結算表',
    summary: `${month}｜共 ${rows.length} 位陪玩｜總業績 ${money(rows.reduce((a, r) => a + r.amount, 0))}`
  });
});

router.get('/exports/withdrawals', async (req, res) => {
  const month = req.query.month || monthPrefix();
  const rows = R.withdrawRows(req.orgId, { month, status: req.query.status || '' });
  await sendExport(res, fmt(req), {
    columns: R.WITHDRAW_COLUMNS, rows,
    filename: `提領明細_${month.replace('-', '')}`,
    title: '陪玩提領薪資明細',
    summary: `${month}｜共 ${rows.length} 筆｜合計 ${money(rows.reduce((a, r) => a + r.amount, 0))}`
  });
});

// ---------------- 匯入歷史 CSV ----------------
// 支援公司既有的匯出格式：訂單編號,交易時間,交易類型,經辦客服,金主名稱,陪玩名稱,
// 訂單原價,實收金額,陪玩抽成,伺服器淨利,狀態,備註
const KIND_BY_LABEL = { '一般訂單': 'order', '贈送禮物': 'gift', '身分組結帳': 'role', '系統調整': 'adjust' };
const STATUS_BY_LABEL = { '已核銷': 'settled', '已退單/撤銷': 'refunded', '已退單／撤銷': 'refunded', '暫存中': 'pending' };

function parseCSV(text) {
  const rows = [];
  let cur = [], val = '', quoted = false;
  const s = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') { if (s[i + 1] === '"') { val += '"'; i++; } else quoted = false; }
      else val += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { cur.push(val); val = ''; }
    else if (ch === '\n') { cur.push(val); rows.push(cur); cur = []; val = ''; }
    else if (ch !== '\r') val += ch;
  }
  if (val || cur.length) { cur.push(val); rows.push(cur); }
  return rows.filter(r => r.some(c => String(c).trim() !== ''));
}

// 2026/6/1 上午12:15:22 → 2026-06-01 00:15:22
function parseTime(raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  const m = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) {
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]} ${iso[4]}:${iso[5]}:${iso[6] || '00'}` : null;
  }
  let h = Number(m[5]);
  if (m[4] === '上午' && h === 12) h = 0;
  if (m[4] === '下午' && h < 12) h += 12;
  const p = n => String(n).padStart(2, '0');
  return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(h)}:${m[6]}:${m[7] || '00'}`;
}

const clean = v => String(v || '').replace(/\uFEFF/g, '').replace(/^="?|"?$/g, '').trim();
const num = v => {
  const n = Number(clean(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/** 名稱 → Discord ID：先查現有資料，查不到就用「name:xxx」當代理 ID 並自動建檔 */
function resolveStaffByName(orgId, name) {
  const n = clean(name);
  if (!n) return null;
  const s = db.prepare('SELECT * FROM staff WHERE guild_id=? AND (name=? OR code=? OR user_id=?)')
    .get(orgId, n, n, n);
  if (s) return s;
  const proxyId = `name:${n}`;
  db.prepare(`INSERT INTO staff (guild_id, user_id, code, name, kind, active) VALUES (?,?,?,?,'player',1)
              ON CONFLICT(guild_id, user_id) DO NOTHING`).run(orgId, proxyId, n, n);
  return getStaff(orgId, proxyId);
}
function resolveCustomerByName(orgId, name) {
  const n = clean(name);
  if (!n) return null;
  const c = db.prepare('SELECT * FROM customers WHERE guild_id=? AND (name=? OR user_id=?)').get(orgId, n, n);
  if (c) return c;
  return getCustomer(orgId, `name:${n}`, n);
}

router.post('/ledger/import', express.text({ type: '*/*', limit: '32mb' }), (req, res) => {
  const orgId = req.orgId;
  const rows = parseCSV(typeof req.body === 'string' ? req.body : String(req.body?.csv || ''));
  if (rows.length < 2) return res.status(400).json({ error: 'CSV 內容為空或格式不正確' });

  const header = rows[0].map(h => clean(h));
  const idx = name => header.findIndex(h => h === name);
  const col = {
    no: idx('訂單編號'), time: idx('交易時間'), kind: idx('交易類型'), cs: idx('經辦客服'),
    customer: idx('金主名稱'), staff: idx('陪玩名稱'), list: idx('訂單原價'), amount: idx('實收金額'),
    share: idx('陪玩抽成'), net: idx('伺服器淨利'), status: idx('狀態'), note: idx('備註'),
    pay: idx('支付方式')
  };
  if (col.amount < 0 || col.staff < 0)
    return res.status(400).json({ error: '找不到「實收金額」或「陪玩名稱」欄位，請確認是流水帳格式的 CSV' });

  const dryRun = req.query.dry === '1';
  let ok = 0, skipped = 0;
  const errors = [];

  const run = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const at = col.time >= 0 ? parseTime(r[col.time]) : null;
      const amount = num(r[col.amount]);
      const staffCell = clean(r[col.staff]);
      // 分隔列（整列都是「-」）直接略過；金額 0 的免費贈禮仍要保留紀錄
      if (!staffCell || staffCell === '-') { skipped++; continue; }
      const staff = resolveStaffByName(orgId, staffCell);
      if (!staff) { skipped++; errors.push(`第 ${i + 1} 列：缺少陪玩名稱`); continue; }
      const cust = resolveCustomerByName(orgId, col.customer >= 0 ? r[col.customer] : '');
      if (!cust) { skipped++; errors.push(`第 ${i + 1} 列：缺少金主名稱`); continue; }

      const rawNo = clean(col.no >= 0 ? r[col.no] : '');
      const orderNo = (!rawNo || rawNo === '無')
        ? `IMP-${String(Date.now()).slice(-8)}-${i}`
        : rawNo;
      if (db.prepare('SELECT 1 FROM orders WHERE order_no=?').get(orderNo)) { skipped++; continue; }

      const kindLabelRaw = clean(col.kind >= 0 ? r[col.kind] : '').replace(/^[^\p{L}]+/u, '');
      const statusLabel = clean(col.status >= 0 ? r[col.status] : '');
      const share = col.share >= 0 ? num(r[col.share]) : null;

      if (dryRun) { ok++; continue; }
      try {
        M.createOrder({
          guildId: orgId,
          orderNo,
          customerId: cust.user_id, customerName: cust.name,
          staffId: staff.user_id, staffName: staff.name,
          csId: '', csName: clean(col.cs >= 0 ? r[col.cs] : ''),
          kind: KIND_BY_LABEL[kindLabelRaw] || 'order',
          item: kindLabelRaw || '匯入',
          qty: 1, unitPrice: amount,
          listPrice: col.list >= 0 ? num(r[col.list]) : amount,
          amount, staffShare: share,
          source: 'import',
          payMethod: clean(col.pay >= 0 ? r[col.pay] : '') || '雨幣扣款',
          status: STATUS_BY_LABEL[statusLabel] || 'settled',
          createdAt: at,
          note: clean(col.note >= 0 ? r[col.note] : ''),
          operator: who(req),
          skipWallet: true      // 歷史資料不動現在的錢包餘額
        });
        ok++;
      } catch (e) { skipped++; errors.push(`第 ${i + 1} 列：${e.message}`); }
    }
  });
  run();

  if (!dryRun) audit(who(req), '匯入流水帳', `成功 ${ok} 筆、略過 ${skipped} 筆`, orgId, { source: 'web' });
  res.json({ ok, skipped, dry_run: dryRun, total: rows.length - 1, errors: errors.slice(0, 20) });
});

module.exports = router;
