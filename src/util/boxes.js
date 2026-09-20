// 自訂意見箱／答題箱：標題、內文、按鈕文案、表單問題都由建立者自己填。
// 投稿一律寫進 suggestions（kind='box'、box_id 指向這個箱子），後台看得到。
const { db, orgOf, getSetting, audit } = require('../db');

const CAP = { title: 256, body: 4000, label: 80, emoji: 32, question: 45, ph: 100 };
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

/** 建立一個箱子，回傳完整資料列 */
function create(guildId, {
  title, body = '', buttonLabel = '填寫', buttonEmoji = '📝',
  formTitle = '', question = '內容', placeholder = '', askName = true,
  channelId = '', panelChannel = '', operator = ''
}) {
  const org = orgOf(guildId);
  if (!clip(title, CAP.title)) throw new Error('請給標題');
  const info = db.prepare(`INSERT INTO boxes
      (guild_id, src_guild, title, body, button_label, button_emoji,
       form_title, question, placeholder, ask_name, channel_id, panel_channel, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(org, String(guildId), clip(title, CAP.title), clip(body, CAP.body),
         clip(buttonLabel, CAP.label) || '填寫', clip(buttonEmoji, CAP.emoji),
         clip(formTitle, CAP.title), clip(question, CAP.question) || '內容',
         clip(placeholder, CAP.ph), askName ? 1 : 0, String(channelId || ''),
         String(panelChannel || ''), operator);
  const box = get(guildId, info.lastInsertRowid);
  audit(operator, '建立意見箱', `#${box.id} ${box.title}`, org, { source: 'settings' });
  return box;
}

const get = (guildId, id) =>
  db.prepare('SELECT * FROM boxes WHERE guild_id=? AND id=?').get(orgOf(guildId), Number(id));

const list = (guildId, { all = false } = {}) =>
  db.prepare(`SELECT * FROM boxes WHERE guild_id=? ${all ? '' : 'AND active=1'} ORDER BY id DESC`)
    .all(orgOf(guildId));

function setActive(guildId, id, active, operator = '') {
  const org = orgOf(guildId);
  const box = get(org, id);
  if (!box) throw new Error(`查無意見箱 #${id}`);
  db.prepare('UPDATE boxes SET active=? WHERE guild_id=? AND id=?').run(active ? 1 : 0, org, box.id);
  audit(operator, active ? '啟用意見箱' : '停用意見箱', `#${box.id} ${box.title}`, org, { source: 'settings' });
  return get(org, box.id);
}

/** 投稿收到哪個頻道：箱子自己設的優先，沒設就用後台的意見箱接收頻道 */
const inboxOf = (guildId, box) =>
  box.channel_id || getSetting('channel_suggestion', '', guildId);

/** 這個箱子的投稿（後台與統計用） */
const replies = (guildId, id, limit = 100) =>
  db.prepare(`SELECT * FROM suggestions WHERE guild_id=? AND kind='box' AND box_id=?
              ORDER BY id DESC LIMIT ?`).all(orgOf(guildId), Number(id), limit);

const countReplies = (guildId, id) =>
  db.prepare("SELECT COUNT(*) c FROM suggestions WHERE guild_id=? AND kind='box' AND box_id=?")
    .get(orgOf(guildId), Number(id)).c;

module.exports = { create, get, list, setActive, inboxOf, replies, countReplies, CAP };
