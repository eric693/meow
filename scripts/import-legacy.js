#!/usr/bin/env node
// 匯入舊系統匯出的 xlsx（playmates / intimacies / polls / dailycounters）
// 用法：node scripts/import-legacy.js <資料夾> [--guild <id>] [--apply]
//   不加 --apply 只做試算，不寫入資料庫。
const path = require('path');
const fs = require('fs');
const ExcelJS = require('exceljs');
const { db } = require('../src/db');

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--')) || '';
const APPLY = args.includes('--apply');
const ONLY = (() => { const i = args.indexOf('--only'); return i >= 0 ? args[i + 1].split(',') : null; })();
const want = name => !ONLY || ONLY.includes(name);
const GUILD = (() => { const i = args.indexOf('--guild'); return i >= 0 ? args[i + 1] : '1535904785084059718'; })();

if (!dir || !fs.existsSync(dir)) { console.error('請指定 xlsx 所在資料夾'); process.exit(1); }

const pick = re => {
  const f = fs.readdirSync(dir).find(n => re.test(n) && n.endsWith('.xlsx'));
  return f ? path.join(dir, f) : null;
};

async function rows(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const out = [];
  ws.eachRow((r, i) => { if (i > 1) out.push(r.values.slice(1)); });
  return out;
}

const S = v => (v === null || v === undefined ? '' : String(v).trim());
const N = v => { const n = Number(v); return Number.isFinite(n) ? Math.round(n) : 0; };
const stats = [];
const log = (t, n, note = '') => stats.push(`${t}：${n} 筆${note ? '（' + note + '）' : ''}`);

// ---------- daily_counters ----------
db.exec(`CREATE TABLE IF NOT EXISTS daily_counters (
  guild_id TEXT NOT NULL DEFAULT '',
  day      TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, day)
)`);

async function importDaily() {
  const f = pick(/dailycounters/i); if (!f) return;
  const rs = await rows(f);
  const st = db.prepare(`INSERT INTO daily_counters (guild_id, day, count) VALUES (?,?,?)
                         ON CONFLICT(guild_id, day) DO UPDATE SET count = excluded.count`);
  let n = 0;
  for (const r of rs) {
    const day = S(r[0]); if (!day) continue;
    if (APPLY) st.run(GUILD, day, N(r[1]));
    n++;
  }
  log('每日計數 daily_counters', n);
}

// ---------- playmates → staff ----------
async function importPlaymates() {
  const f = pick(/playmates/i); if (!f) return;
  const rs = await rows(f);
  const get = db.prepare('SELECT * FROM staff WHERE guild_id=? AND user_id=?');
  const byName = db.prepare("SELECT * FROM staff WHERE guild_id=? AND user_id LIKE 'name:%' AND (name=? OR code=?)");
  const ins = db.prepare(`INSERT INTO staff (guild_id,user_id,code,name,card_url,kind,income,pending_income,total_income)
                          VALUES (?,?,?,?,?, 'player', ?,?,?)`);
  const upd = db.prepare(`UPDATE staff SET code=?, name=?, card_url=?, income=?, pending_income=?, total_income=? WHERE id=?`);
  // 重跑匯入時，既有陪玩的餘額預設不覆蓋：試算表是某個時間點的快照，
  // 蓋回去會把匯入後新接的單、已核銷的錢一起抹掉（曾經因此讓人的暫存薪水歸零）。
  // 真的要用試算表重設餘額時，才加上 --overwrite-balance。
  const updProfile = db.prepare('UPDATE staff SET code=?, name=?, card_url=? WHERE id=?');
  const OVERWRITE = args.includes('--overwrite-balance');
  const relink = db.prepare('UPDATE staff SET user_id=? WHERE id=?');
  const del = db.prepare('DELETE FROM staff WHERE id=?');
  let added = 0, updated = 0, merged = 0, skipped = 0;
  for (const r of rs) {
    const code = S(r[0]), total = N(r[1]), card = S(r[2]);
    const income = N(r[4]), name = S(r[5]), uid = S(r[6]), pending = N(r[7]);
    if (!uid) { skipped++; continue; }
    const cur = get.get(GUILD, uid);
    const ph = byName.get(GUILD, name, code);
    if (cur) {
      if (ph && APPLY) del.run(ph.id);
      if (ph) merged++;
      if (APPLY) {
        if (OVERWRITE) upd.run(code, name, card, income, pending, total, cur.id);
        else updProfile.run(code, name, card, cur.id);
      }
      updated++;
    } else if (ph) {
      if (APPLY) { relink.run(uid, ph.id); upd.run(code, name, card, income, pending, total, ph.id); }
      merged++; updated++;
    } else {
      if (APPLY) ins.run(GUILD, uid, code, name, card, income, pending, total);
      added++;
    }
  }
  log('陪玩 staff', added + updated, `新增 ${added}、更新 ${updated}、其中併掉暫用帳 ${merged}、無 Discord ID 略過 ${skipped}`);
}

// ---------- intimacies → intimacy / backpack / gift_logs ----------
async function importIntimacies() {
  const f = pick(/intimacies/i); if (!f) return;
  const rs = await rows(f);
  const ins = db.prepare(`INSERT INTO intimacy (guild_id, customer_id, staff_id, points) VALUES (?,?,?,?)
                          ON CONFLICT(guild_id, customer_id, staff_id) DO UPDATE SET points = excluded.points`);
  const cat = new Map(db.prepare('SELECT key,name,price,intimacy FROM gift_catalog WHERE guild_id=?').all(GUILD).map(g => [g.key, g]));
  const gins = db.prepare(`INSERT INTO gift_logs (guild_id, customer_id, staff_id, gift_key, gift_name, qty, amount, intimacy)
                           VALUES (?,?,?,?,?,1,?,?)`);
  const coupons = new Map();
  let n = 0, gifts = 0;
  for (const r of rs) {
    const cust = S(r[0]), staff = S(r[1]), pts = N(r[2]);
    if (!cust || !staff) continue;
    if (APPLY) ins.run(GUILD, cust, staff, pts);
    n++;
    let hist = []; try { hist = JSON.parse(S(r[3]) || '[]'); } catch (_) { hist = []; }
    for (const key of hist) {
      const g = cat.get(key) || cat.get(String(key).replace(/^gift_/, ''));
      if (APPLY) gins.run(GUILD, cust, staff, key, g ? g.name : String(key), g ? g.price : 0, g ? g.intimacy : 0);
      gifts++;
    }
    const cp = N(r[4]);
    if (cp > 0) coupons.set(cust, (coupons.get(cust) || 0) + cp);
  }
  const bins = db.prepare(`INSERT INTO backpack (guild_id, user_id, item_key, name, qty, value) VALUES (?,?,?,?,1,?)
                           ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET value = excluded.value`);
  for (const [uid, val] of coupons) if (APPLY) bins.run(GUILD, uid, 'coupon_legacy', '🎫 舊系統折價券', val);
  log('親密度 intimacy', n);
  log('收禮紀錄 gift_logs', gifts, '舊禮物代號在禮物表找不到者金額記 0');
  log('折價券 backpack', coupons.size, '同一位老闆的餘額已合併成一張');
}

// ---------- polls ----------
async function importPolls() {
  const f = pick(/polls/i); if (!f) return;
  const rs = await rows(f);
  const find = db.prepare('SELECT id FROM polls WHERE guild_id=? AND message_id=?');
  const ins = db.prepare(`INSERT INTO polls (guild_id, channel_id, message_id, title, options, closed) VALUES (?,?,?,?,?,?)`);
  const vins = db.prepare(`INSERT INTO poll_votes (poll_id, user_id, choice) VALUES (?,?,?)
                           ON CONFLICT(poll_id, user_id) DO UPDATE SET choice = excluded.choice`);
  let n = 0, votes = 0;
  for (const r of rs) {
    const msg = S(r[0]), ch = S(r[1]), gid = S(r[2]) || GUILD, title = S(r[3]);
    let opts = []; try { opts = JSON.parse(S(r[4]) || '[]'); } catch (_) { }
    let voters = {}; try { voters = JSON.parse(S(r[5]) || '{}'); } catch (_) { }
    const closed = S(r[6]) === 'active' ? 0 : 1;
    if (!title || !opts.length) continue;
    const idx = new Map(opts.map((o, i) => [o.id || String(i), i]));
    const labels = opts.map(o => (o.label !== undefined ? o.label : String(o)));
    if (find.get(gid, msg)) { continue; }
    let pid = 0;
    if (APPLY) pid = ins.run(gid, ch, msg, title, JSON.stringify(labels), closed).lastInsertRowid;
    n++;
    for (const [uid, oid] of Object.entries(voters)) {
      const c = idx.get(oid); if (c === undefined) continue;
      if (APPLY) vins.run(pid, uid, c);
      votes++;
    }
  }
  log('投票 polls', n);
  log('投票紀錄 poll_votes', votes);
}

// ---------- territories → customers.territory ----------
async function importTerritories() {
  const f = pick(/territories/i); if (!f) return;
  const rs = await rows(f);
  const ins = db.prepare(`INSERT INTO customers (guild_id, user_id, territory) VALUES (?,?,?)
                          ON CONFLICT(guild_id, user_id) DO UPDATE SET territory = excluded.territory`);
  let n = 0, created = 0;
  for (const r of rs) {
    const uid = S(r[0]); if (!uid) continue;
    const step = Math.max(0, Math.min(21, N(r[1])));
    const had = db.prepare('SELECT 1 FROM customers WHERE guild_id=? AND user_id=?').get(GUILD, uid);
    if (!had) created++;
    if (APPLY) ins.run(GUILD, uid, step);
    n++;
  }
  log('地盤 customers.territory', n, `其中新建老闆資料 ${created}`);
}

// ---------- stamps ----------
async function importStamps() {
  const f = pick(/stamps/i); if (!f) return;
  db.exec(`CREATE TABLE IF NOT EXISTS stamps (
    guild_id TEXT NOT NULL DEFAULT '',
    user_id  TEXT NOT NULL,
    points   INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (guild_id, user_id)
  )`);
  const rs = await rows(f);
  const ins = db.prepare(`INSERT INTO stamps (guild_id, user_id, points) VALUES (?,?,?)
                          ON CONFLICT(guild_id, user_id) DO UPDATE SET points = excluded.points`);
  let n = 0;
  for (const r of rs) {
    const uid = S(r[0]); if (!uid) continue;
    if (APPLY) ins.run(GUILD, uid, N(r[1]));
    n++;
  }
  log('集章 stamps', n);
}

// ---------- systemconfigs → settings ----------
async function importConfigs() {
  const f = pick(/systemconfigs/i); if (!f) return;
  const rs = await rows(f);
  const ins = db.prepare(`INSERT INTO settings (guild_id, key, value) VALUES (?,?,?)
                          ON CONFLICT(guild_id, key) DO UPDATE SET value = excluded.value`);
  let n = 0;
  for (const r of rs) {
    const key = S(r[0]); if (!key) continue;
    let val = r[1];
    if (val instanceof Date) val = val.toISOString();
    else val = S(val);
    if (APPLY) ins.run(GUILD, 'legacy_' + key, val);
    n++;
  }
  log('系統設定 settings', n, '鍵名前面加了 legacy_ 前綴避免蓋到現有設定');
}

// ---------- users → customers + backpack ----------
async function importUsers() {
  const f = pick(/users/i); if (!f) return;
  const rs = await rows(f);
  const ins = db.prepare(`INSERT INTO customers (guild_id, user_id, coins, total_spend, vip_level) VALUES (?,?,?,?,?)
                          ON CONFLICT(guild_id, user_id) DO UPDATE SET
                            coins = excluded.coins, total_spend = excluded.total_spend, vip_level = excluded.vip_level`);
  const bins = db.prepare(`INSERT INTO backpack (guild_id, user_id, item_key, name, qty, value, percent) VALUES (?,?,?,?,?,?,?)
                           ON CONFLICT(guild_id, user_id, item_key) DO UPDATE SET
                             name = excluded.name, qty = excluded.qty, value = excluded.value, percent = excluded.percent`);
  let n = 0, items = 0;
  for (const r of rs) {
    const uid = S(r[0]); if (!uid) continue;
    if (APPLY) ins.run(GUILD, uid, N(r[1]), N(r[2]), Math.max(0, N(r[5])));
    n++;
    let bag = []; try { bag = JSON.parse(S(r[7]) || '[]'); } catch (_) { }
    for (const it of bag) {
      const key = S(it.id) || ('legacy_' + items);
      const isPct = S(it.type) === 'percent';
      if (APPLY) bins.run(GUILD, uid, key, S(it.name), Math.max(1, N(it.quantity)), isPct ? 0 : N(it.discount), isPct ? N(it.discount) : 0);
      items++;
    }
  }
  log('老闆 customers', n, '雨幣餘額／歷史消費／VIP 等級（-1 視為 0，未鎖定）');
  log('背包道具 backpack', items);
}

// ---------- transactions → coin_tx + orders ----------
async function importTransactions() {
  const f = pick(/transactions/i); if (!f) return;
  const rs = await rows(f);
  const SYS = v => /^SYSTEM_/.test(v);
  const when = v => {
    if (v instanceof Date) return v.toISOString().slice(0, 19).replace('T', ' ');
    const s = S(v);
    const m = s.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})\s*(上午|下午)?(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return s;
    let h = Number(m[5]);
    if (m[4] === '下午' && h < 12) h += 12;
    if (m[4] === '上午' && h === 12) h = 0;
    const p = x => String(x).padStart(2, '0');
    return `${m[1]}-${p(m[2])}-${p(m[3])} ${p(h)}:${m[6]}:${m[7]}`;
  };
  const TYPE = { order: '下單', normal: '下單', rolepay: '下單', gift: '送禮', withdraw: '提領' };

  // --- 訂單：有 ORD- 編號且資料庫還沒有的才補
  const hasOrd = db.prepare('SELECT 1 FROM orders WHERE order_no=?');
  const oins = db.prepare(`INSERT INTO orders (order_no, guild_id, customer_id, staff_id, cs_id, item, qty,
                             unit_price, amount, staff_share, list_price, net, source, status, note, kind, created_at)
                           VALUES (?,?,?,?,?, '一般訂單', 1, ?,?,?,?,?, 'legacy', ?,?, 'order', ?)`);
  const seen = new Set();
  let added = 0, exists = 0;
  if (want('orders'))
  for (const r of rs) {
    const no = S(r[7]); if (!no.startsWith('ORD-')) continue;
    if (seen.has(no)) continue; seen.add(no);
    if (hasOrd.get(no)) { exists++; continue; }
    const cust = S(r[0]), staff = S(r[1]);
    if (!cust || !staff || SYS(cust)) continue;
    const list = N(r[2]), amount = N(r[3]), share = N(r[8]);
    const st = S(r[9]);
    const status = st === 'cancelled' ? 'refunded' : st === 'pending' ? 'pending' : 'settled';
    if (APPLY) oins.run(no, GUILD, cust, staff, S(r[5]), amount, amount, share, list, amount - share, status, S(r[10]), when(r[4]));
    added++;
  }
  if (want('orders')) log('訂單 orders', added, `補上缺的；已存在跳過 ${exists}`);

  // --- 雨幣流水：全部寫入，餘額用累加推算
  if (want('cointx')) {
  const byUser = new Map();
  let skipped = 0;
  for (const r of rs) {
    const type = S(r[6]) || 'order';
    const isW = type === 'withdraw';
    const uid = isW ? S(r[1]) : S(r[0]);
    if (!uid || SYS(uid)) { skipped++; continue; }
    const amt = N(r[3]) || N(r[2]);
    const ref = S(r[7]);
    const row = {
      uid, delta: -amt, at: when(r[4]),
      reason: (TYPE[type] || type) + (ref ? ' ' + ref : '') + (S(r[9]) === 'cancelled' ? '（已取消）' : ''),
      ref, operator: S(r[5])
    };
    if (!byUser.has(uid)) byUser.set(uid, []);
    byUser.get(uid).push(row);
  }
  const target = new Map(db.prepare('SELECT user_id, coins FROM customers WHERE guild_id=?').all(GUILD).map(c => [c.user_id, c.coins]));
  const tins = db.prepare(`INSERT INTO coin_tx (guild_id, user_id, delta, balance, reason, ref, operator, created_at)
                           VALUES (?,?,?,?,?,?,?,?)`);
  let n = 0;
  for (const [uid, list] of byUser) {
    list.sort((a, b) => a.at.localeCompare(b.at));
    let run = 0;
    for (const r of list) { run += r.delta; r.balance = run; }
    const offset = (target.has(uid) ? target.get(uid) : 0) - run;   // 讓最後一筆對上現在的餘額
    for (const r of list) {
      if (APPLY) tins.run(GUILD, uid, r.delta, r.balance + offset, r.reason, r.ref, r.operator, r.at);
      n++;
    }
  }
  log('雨幣流水 coin_tx', n, `SYSTEM_* 系統列略過 ${skipped}；餘額由現有餘額往回推算`);
  }

  // --- 提領：WTH- 編號的列
  if (want('withdrawals')) {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawals_note ON withdrawals (guild_id, note) WHERE note LIKE 'WTH-%'`);
  const wins = db.prepare(`INSERT INTO withdrawals (guild_id, staff_id, amount, status, operator, note, created_at, done_at)
                           VALUES (?,?,?,?,?,?,?,?)
                           ON CONFLICT DO NOTHING`);
  let w = 0;
  for (const r of rs) {
    const no = S(r[7]); if (!no.startsWith('WTH-')) continue;
    const staff = S(r[1]); if (!staff || SYS(staff)) continue;
    const st = S(r[9]);
    const status = st === 'cancelled' ? 'rejected' : st === 'pending' ? 'pending' : 'done';
    const at = when(r[4]);
    if (APPLY) wins.run(GUILD, staff, N(r[3]) || N(r[2]), status, S(r[5]), no, at, status === 'done' ? at : null);
    w++;
  }
  log('提領 withdrawals', w);
  }

  // --- 送禮：gift 類型的列，用金額回推禮物品項
  if (!want('gifts')) return;
  const cat = db.prepare('SELECT key,name,price,intimacy FROM gift_catalog WHERE guild_id=? AND price>0 ORDER BY price DESC').all(GUILD);
  const byPrice = new Map(cat.map(g => [g.price, g]));
  const match = amt => {
    if (byPrice.has(amt)) return { g: byPrice.get(amt), qty: 1 };
    for (const g of cat) {                      // 198 = 99×2 這種整數倍
      if (amt % g.price === 0) { const q = amt / g.price; if (q >= 1 && q <= 20) return { g, qty: q }; }
    }
    return null;
  };
  if (APPLY) db.prepare("DELETE FROM gift_logs WHERE guild_id=? AND gift_key LIKE 'gift_%'").run(GUILD);
  const gins2 = db.prepare(`INSERT INTO gift_logs (guild_id, customer_id, staff_id, gift_key, gift_name, qty, amount, intimacy, created_at)
                            VALUES (?,?,?,?,?,?,?,?,?)`);
  let gn = 0, unknown = 0;
  for (const r of rs) {
    if (S(r[6]) !== 'gift') continue;
    const cust = S(r[0]), staff = S(r[1]);
    if (!cust || !staff || SYS(cust)) continue;
    const amt = N(r[3]) || N(r[2]);
    const m = amt > 0 ? match(amt) : null;
    if (!m) unknown++;
    if (APPLY) gins2.run(GUILD, cust, staff, m ? m.g.key : 'legacy_gift', m ? m.g.name : '舊系統禮物',
      m ? m.qty : 1, amt, m ? m.g.intimacy * m.qty : 0, when(r[4]));
    gn++;
  }
  log('送禮 gift_logs', gn, `由金額對回禮物品項，對不到的 ${unknown} 筆記為「舊系統禮物」；舊的 39 筆無金額紀錄已被取代`);
}

(async () => {
  await importDaily();
  await importUsers();
  await importTransactions();
  await importTerritories();
  await importStamps();
  await importConfigs();
  await importPlaymates();
  await importIntimacies();
  await importPolls();
  console.log((APPLY ? '✅ 已寫入' : '🔍 試算（未寫入，加 --apply 才會寫）') + `　伺服器 ${GUILD}`);
  stats.forEach(s => console.log(' - ' + s));
})();
