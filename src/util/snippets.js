// 小工作台：客服自己在後台新增的簡易指令（回應模板）。
//
// 這些指令不寫在程式裡，而是存在資料庫，隨時可以增修——客服要多一句「!售後」不必等工程師。
// 顯示方式兩種：
//   self   只有自己看得到（斜線指令用 ephemeral；前綴指令改用私訊，因為 Discord 的
//          一般訊息沒有「只給一個人看」這種東西）
//   public 直接發到頻道，適合公告型的罐頭回覆
const { db, orgOf, audit } = require('../db');

const clean = s => String(s || '').trim().replace(/^!/, '');

/** 這台伺服器（含集團）有哪些自訂指令 */
function list(guildId, { activeOnly = true } = {}) {
  return db.prepare(`SELECT * FROM snippets WHERE guild_id = ?
                     ${activeOnly ? 'AND active = 1' : ''} ORDER BY sort, key`).all(orgOf(guildId));
}

function find(guildId, key) {
  return db.prepare('SELECT * FROM snippets WHERE guild_id = ? AND key = ? AND active = 1')
    .get(orgOf(guildId), clean(key));
}

function save(guildId, { id = null, key, title = '', content = '', visible = 'self', cs_only = 1, sort = 0, active = 1 }, operator = '') {
  const org = orgOf(guildId);
  const k = clean(key);
  if (!k) throw new Error('請填寫指令名稱');
  if (/\s/.test(k)) throw new Error('指令名稱不能有空白');
  if (!content.trim()) throw new Error('請填寫回覆內容');
  const vis = visible === 'public' ? 'public' : 'self';
  if (id) {
    db.prepare(`UPDATE snippets SET key=?, title=?, content=?, visible=?, cs_only=?, sort=?, active=?
                WHERE id=? AND guild_id=?`)
      .run(k, title, content, vis, cs_only ? 1 : 0, Number(sort) || 0, active ? 1 : 0, id, org);
  } else {
    if (find(org, k)) throw new Error(`指令 !${k} 已經存在`);
    db.prepare(`INSERT INTO snippets (guild_id, key, title, content, visible, cs_only, sort, active)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(org, k, title, content, vis, cs_only ? 1 : 0, Number(sort) || 0, active ? 1 : 0);
  }
  audit(operator, id ? '修改自訂指令' : '新增自訂指令', `!${k}`, org, { source: 'web' });
  return db.prepare('SELECT * FROM snippets WHERE guild_id=? AND key=?').get(org, k);
}

function remove(guildId, id, operator = '') {
  const org = orgOf(guildId);
  const s = db.prepare('SELECT * FROM snippets WHERE id=? AND guild_id=?').get(id, org);
  if (!s) throw new Error('查無此自訂指令');
  db.prepare('DELETE FROM snippets WHERE id=?').run(id);
  audit(operator, '刪除自訂指令', `!${s.key}`, org, { source: 'web' });
  return s;
}

const bump = id => db.prepare('UPDATE snippets SET used = used + 1 WHERE id = ?').run(id);

/**
 * 模板的輸出內容。
 *
 * 刻意用「一般訊息」而不是 embed：手機版 Discord 沒辦法選取 embed 裡的文字，
 * 而模板存在的目的就是要複製貼給客人，選不起來等於白做。
 * 回傳陣列是因為一般訊息有 2000 字上限，太長要拆成幾則送。
 */
function renderChunks(s) {
  const text = (s.title ? `**${s.title}**\n` : '') + s.content;
  const chunks = [];
  let buf = '';
  for (const line of text.split('\n')) {
    if ((buf + line).length > 1900) { chunks.push(buf); buf = ''; }
    buf += (buf ? '\n' : '') + line;
  }
  if (buf) chunks.push(buf);
  return chunks;
}

module.exports = { list, find, save, remove, bump, clean, renderChunks };
