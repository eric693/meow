#!/usr/bin/env node
// 補回舊系統的可提領餘額：匯入時 income 被填成「當月收益」，這裡改成「累積收益」
// 差額 = 累積收益 − 當月收益，加到現在的 income 上（匯入後新接的單不受影響）
// 用法：node scripts/restore-legacy-income.js [檔案.xlsx] [--guild <id>] [--apply]
//   不加 --apply 只試算。舊系統沒有提領紀錄可對，所以一律以「累積收益＝可提領」還原。
const fs = require('fs');
const ExcelJS = require('exceljs');
const { db } = require('../src/db');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const arg = (k, d = '') => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const GUILD = arg('--guild', '1535904785084059718');
const FILE = args.find(a => !a.startsWith('--') && a.endsWith('.xlsx')) || 'data/legacy-playmates.xlsx';

if (!fs.existsSync(FILE)) { console.error(`找不到 ${FILE}`); process.exit(1); }

const N = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const S = v => (v === null || v === undefined ? '' : String(v).trim());

(async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(FILE);
  const ws = wb.worksheets[0];

  const get = db.prepare('SELECT * FROM staff WHERE guild_id=? AND user_id=?');
  const plan = [];
  const missing = [];
  ws.eachRow((r, i) => {
    if (i < 2) return;
    const v = r.values.slice(1);
    const code = S(v[0]), total = N(v[1]), month = N(v[4]), name = S(v[5]), uid = S(v[6]);
    if (!uid) return;
    const s = get.get(GUILD, uid);
    if (!s) { missing.push({ code, name, total }); return; }
    const diff = total - month;              // 舊系統少算進可提領的部分
    if (diff === 0) return;
    plan.push({ s, code, name, total, month, diff, before: s.income, after: s.income + diff });
  });

  if (APPLY) {
    db.transaction(() => {
      for (const p of plan) db.prepare('UPDATE staff SET income = income + ? WHERE id=?').run(p.diff, p.s.id);
    })();
  }

  const sum = plan.reduce((a, p) => a + p.diff, 0);
  console.log(`${APPLY ? '✅ 已寫入' : '🔍 試算（未寫入，加 --apply 才會寫）'}　來源 ${FILE}`);
  console.log(` - 需要補回 ${plan.length} 位，可提領餘額共補 ${sum.toLocaleString('en-US')} 元`);
  console.log(` - 舊系統有、但新資料庫沒有 staff 資料的 ${missing.length} 位（未處理）：`
    + missing.slice(0, 10).map(m => `${m.code} ${m.name}`).join('、') + (missing.length > 10 ? ' …' : ''));
  console.log(' - 補最多的前 10 位：');
  [...plan].sort((a, b) => b.diff - a.diff).slice(0, 10)
    .forEach(p => console.log(`   ${p.code} ${p.name}：${p.before.toLocaleString('en-US')} → ${p.after.toLocaleString('en-US')}（+${p.diff.toLocaleString('en-US')}）`));
})();
