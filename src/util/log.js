// Discord 端操作紀錄：所有前綴指令、斜線指令、按鈕與表單都會經過這裡。
// 一律寫進 audit_logs，另外可鏡像一份到後台設定的「操作紀錄頻道」。
const { audit, getSetting } = require('../db');
const { emb, COLOR } = require('./embed');

const SOURCE_LABEL = {
  prefix: '前綴指令', slash: '斜線指令', button: '按鈕',
  modal: '表單', select: '選單', web: '後台', system: '系統'
};
const STATUS_ICON = { ok: '✅', fail: '⚠️', deny: '⛔' };
const STATUS_COLOR = { ok: COLOR.ok, fail: COLOR.err, deny: COLOR.warn };

// 參數裡可能夾雜密碼之類的東西，統一截斷並移除換行
const brief = v => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);

/**
 * 記一筆操作。
 * @param {object} o
 * @param {string} o.guildId    伺服器 ID
 * @param {string} o.source     prefix / slash / button / modal / select
 * @param {string} o.action     指令或互動名稱，例如「!核銷」「/結帳」「report:self」
 * @param {object} o.user       Discord user（取 tag 與 id）
 * @param {string} o.detail     參數或結果摘要
 * @param {string} o.status     ok / fail / deny
 * @param {string} o.channelId  發生的頻道
 */
function logAction({ guildId, source = 'system', action, user, detail = '', status = 'ok', channelId = '' }) {
  const actor = user ? (user.tag || user.username || user.id) : '系統';
  audit(actor, action, brief(detail), guildId,
    { actorId: user ? user.id : '', source, channelId, status });
  mirror({ guildId, source, action, actor, userId: user ? user.id : '', detail, status, channelId })
    .catch(() => {});   // 鏡像失敗不能影響指令本身
}

/** 把紀錄鏡像到 Discord 頻道（後台設定 channel_command_log；沒設定就跳過） */
async function mirror({ guildId, source, action, actor, userId, detail, status, channelId }) {
  const target = getSetting('channel_command_log', '', guildId);
  if (!target) return;
  const client = require('../bot').getClient();
  if (!client) return;
  const ch = await client.channels.fetch(target).catch(() => null);
  if (!ch || !ch.isTextBased?.()) return;
  // 避免紀錄頻道自己記自己造成無限迴圈
  if (channelId && channelId === target) return;

  await ch.send({
    embeds: [emb(guildId, {
      title: `${STATUS_ICON[status] || 'ℹ️'} ${action}`,
      color: STATUS_COLOR[status] || COLOR.main,
      fields: [
        { name: '操作者', value: userId ? `<@${userId}>\n\`${actor}\`` : actor, inline: true },
        { name: '來源', value: SOURCE_LABEL[source] || source, inline: true },
        { name: '頻道', value: channelId ? `<#${channelId}>` : '—', inline: true },
        ...(detail ? [{ name: '內容', value: `\`\`\`${brief(detail).slice(0, 900)}\`\`\`` }] : [])
      ]
    })]
  }).catch(() => {});
}

/** 把斜線指令的參數整理成「名稱=值」字串 */
const slashArgs = i => (i.options?.data || [])
  .map(o => `${o.name}=${o.user ? o.user.tag : o.value}`).join(' ');

/** 把表單欄位整理成「欄位=值」字串 */
const modalArgs = i => {
  try {
    return i.fields.fields.map(f => `${f.customId}=${f.value}`).join(' ');
  } catch { return ''; }
};

module.exports = { logAction, slashArgs, modalArgs, SOURCE_LABEL };
