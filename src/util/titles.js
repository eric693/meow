// 冠名／身份組期限：新增、查詢、到期提醒（含接棒排隊）
const { db, now, orgOf, getSetting, audit } = require('../db');

const KINDS = { title: '冠名', role: '身份組' };
const kindOf = s => (String(s).includes('身') ? 'role' : 'title');

const pad = n => String(n).padStart(2, '0');
const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} `
               + `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/** 支援 2026/08/13 01:09、2026-08-13 01:09、2026-08-13 三種寫法 */
function parseTime(s) {
  const t = String(s || '').trim().replace(/\//g, '-');
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return Number.isNaN(d.getTime()) ? null : fmt(d);
}
const addDays = (from, days) => {
  const d = new Date(from.replace(' ', 'T'));
  d.setDate(d.getDate() + Number(days));
  return fmt(d);
};

/**
 * 新增一筆期限。給了 startAt 就照用，沒給則從現在起算；
 * queueAfter 為 true 時排在同一對象最晚的一筆之後（接棒）。
 */
function addTitle(guildId, {
  kind = 'title', name, days = 0, startAt = null, endAt = null,
  customerId = '', customerName = '', staffId = '', staffName = '',
  targetId = '', targetName = '', note = '', operator = '', queueAfter = false, srcGuild = ''
}) {
  const org = orgOf(guildId);
  if (!name) throw new Error('請給冠名／身份組名稱');
  const k = kind === 'role' ? 'role' : 'title';

  let start = startAt ? parseTime(startAt) : null;
  if (queueAfter && !start) {
    // 接棒：接在同一位陪玩（或同一對象）目前最晚的結束時間之後
    const key = k === 'role' ? 'target_id' : 'staff_id';
    const val = k === 'role' ? targetId : staffId;
    const last = val && db.prepare(
      `SELECT MAX(end_at) e FROM titles WHERE guild_id=? AND kind=? AND ${key}=? AND status!='ended'`
    ).get(org, k, val)?.e;
    start = last || now();
  }
  start = start || now();

  const end = endAt ? parseTime(endAt) : (days > 0 ? addDays(start, days) : null);
  if (!end) throw new Error('請給天數或結束時間');
  const realDays = days > 0 ? Math.round(days)
    : Math.max(0, Math.round((new Date(end.replace(' ', 'T')) - new Date(start.replace(' ', 'T'))) / 86400000));

  const status = start > now() ? 'queued' : 'active';
  const info = db.prepare(`INSERT INTO titles
      (guild_id, src_guild, kind, name, customer_id, customer_name, staff_id, staff_name,
       target_id, target_name, days, start_at, end_at, note, status, notified_start, operator)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(org, srcGuild || String(guildId), k, name, customerId, customerName, staffId, staffName,
         targetId, targetName, realDays, start, end, note, status, status === 'active' ? 1 : 0, operator);
  audit(operator, `新增${KINDS[k]}`, `${name}（${start} ~ ${end}）`, org, { source: 'titles' });
  return db.prepare('SELECT * FROM titles WHERE id=?').get(info.lastInsertRowid);
}

/** 查詢清單，預設只看還沒結束的 */
function listTitles(guildId, { kind = '', status = 'live', q = '', limit = 200, offset = 0 } = {}) {
  const cond = ['guild_id = ?'], args = [orgOf(guildId)];
  if (kind) { cond.push('kind = ?'); args.push(kind); }
  if (status === 'live') cond.push("status != 'ended'");
  else if (status) { cond.push('status = ?'); args.push(status); }
  if (q) {
    cond.push('(name LIKE ? OR customer_name LIKE ? OR staff_name LIKE ? OR target_name LIKE ? OR note LIKE ?)');
    for (let i = 0; i < 5; i++) args.push(`%${q}%`);
  }
  const where = cond.join(' AND ');
  return {
    total: db.prepare(`SELECT COUNT(*) c FROM titles WHERE ${where}`).get(...args).c,
    rows: db.prepare(`SELECT * FROM titles WHERE ${where} ORDER BY end_at LIMIT ? OFFSET ?`)
      .all(...args, limit, offset)
  };
}

function endTitle(guildId, id, operator = '') {
  const org = orgOf(guildId);
  const t = db.prepare('SELECT * FROM titles WHERE id=? AND guild_id=?').get(id, org);
  if (!t) throw new Error(`查無編號 ${id} 的紀錄`);
  db.prepare("UPDATE titles SET status='ended', notified_end=1 WHERE id=?").run(id);
  audit(operator, `結束${KINDS[t.kind]}`, `#${id} ${t.name}`, org, { source: 'titles' });
  return t;
}

// 直接標出本人的 Discord，客服不用再另外查是誰；
// 後台手動建立的紀錄可能只有名字沒有 ID，這時退回顯示純文字姓名。
const mention = (id, name) => (id ? `<@${id}>` : (name || '—'));

const who = t => (t.kind === 'role'
  ? `🎯 對象：${mention(t.target_id, t.target_name)}`
  : `👤 老闆：${mention(t.customer_id, t.customer_name)}\n🎮 陪玩：${mention(t.staff_id, t.staff_name)}`);

/** 一筆紀錄的顯示區塊，格式沿用舊系統的排版 */
function titleBlock(t) {
  return [
    `🏷️ 類別：${KINDS[t.kind]}　編號：#${t.id}　天數：${t.days}`,
    `📌 名稱：${t.name}`,
    who(t),
    t.status === 'queued' ? '🔄 接棒：等待開始提醒' : '',
    `🟢 開始：${t.start_at}`,
    `⏰ 結束：${t.end_at}`,
    t.note ? `📝 備註：${t.note}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * 掃描到期與該開始的紀錄，回傳要發出的提醒。
 * 由排程每分鐘呼叫；已提醒過的不會重複。
 */
function dueReminders(orgId) {
  const t = now();
  const started = db.prepare(
    "SELECT * FROM titles WHERE guild_id=? AND status='queued' AND notified_start=0 AND start_at <= ? ORDER BY start_at"
  ).all(orgId, t);
  const ended = db.prepare(
    "SELECT * FROM titles WHERE guild_id=? AND status!='ended' AND notified_end=0 AND end_at <= ? ORDER BY end_at"
  ).all(orgId, t);
  return { started, ended };
}
const markStarted = id =>
  db.prepare("UPDATE titles SET status='active', notified_start=1 WHERE id=?").run(id);
const markEnded = id =>
  db.prepare("UPDATE titles SET status='ended', notified_end=1 WHERE id=?").run(id);

/** 提醒要發到哪個頻道：專屬冠名播報頻道，沒設就退回訂單通知頻道 */
const announceChannel = guildId =>
  getSetting('channel_title_announce', '', guildId) || getSetting('channel_order_log', '', guildId);

module.exports = {
  KINDS, kindOf, parseTime, addDays, addTitle, listTitles, endTitle,
  titleBlock, dueReminders, markStarted, markEnded, announceChannel
};
