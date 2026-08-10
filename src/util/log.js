// Discord 端操作紀錄：所有前綴指令、斜線指令、按鈕與表單都會經過這裡。
// 一律寫進 audit_logs，另外可鏡像一份到後台設定的「操作紀錄頻道」。
const { audit, getSetting } = require('../db');
const { emb, COLOR } = require('./embed');

const SOURCE_LABEL = {
  prefix: '前綴指令', slash: '斜線指令', button: '按鈕',
  modal: '表單', select: '選單', web: '後台', system: '系統'
};
const STATUS_ICON = { ok: '✅', fail: '⚠️', deny: '⛔' };

// 互動 customId → 人看得懂的動作名稱（去掉 session 亂碼與流水號）
const ACTION_LABEL = {
  'role:boss': '領取身分組-老闆', 'role:drop': '領取身分組-雨滴',
  'role:traveler': '身份大廳-旅人', 'role:cat': '身份大廳-寄宿貓貓',
  'order:start': '下單-開始', 'ord:service': '下單-選服務類型', 'ord:gender': '下單-選性別',
  'ord:final': '下單-送出需求單',
  'tk:addon': '訂單-選加購', 'tk:clear': '訂單-清空加購', 'tk:public': '訂單-發布公開單',
  'tk:anon': '訂單-發布匿名單', 'tk:cancel': '訂單-取消', 'tk:card': '訂單-遞交名片',
  'tk:end': '訂單-結束', 'tk:closecard': '訂單-關閉名片專區',
  'ticket:order': '傳票-開啟下單頻道', 'ticket:claim': '傳票-客服接單', 'ticket:close': '傳票-關閉頻道',
  'checkout:start': '結帳台-開啟表單', 'checkoutm': '結帳台-送出表單',
  'co:pick': '結帳-選折價券', 'co:manual': '結帳-輸入手動折扣',
  'co:pay': '結帳-選付款方式', 'co:cancel': '結帳-取消',
  'gf:pay': '送禮-選付款方式', 'gf:cancel': '送禮-取消',
  'report:self': '報單-自主', 'report:cross': '報單-跨服', 'report:cross2': '報單-唱歌跨服',
  'reportch': '報單-建立頻道', 'reportform': '報單-開啟表單', 'reportm': '報單-送出',
  'exam:start': '考核-開始', 'exammodal': '考核-送出資料', 'exam:close': '考核-關閉',
  'mb:coins': '會員-查餘額', 'mb:bag': '會員-查背包', 'mb:orders': '會員-查點單紀錄',
  'bank:me': '地下金庫-查詢', 'intimacy:query': '愛戀藏館-查詢', 'intimacym': '愛戀藏館-送出',
  'sug:public': '意見箱-開啟', 'sug:staff': '員工輔導室-開啟',
  'sugm': '意見箱-送出', 'un': '未核銷-翻頁', 'poll': '投票-作答'
};

/** 把 customId 正規化成可讀動作，例如 co:pay:ab12cd:cash → 結帳-選付款方式 */
function friendly(action) {
  if (!action || action.startsWith('/') || action.startsWith('!')) return action;
  const p = action.split(':');
  for (const key of [p.slice(0, 2).join(':'), p[0]]) {
    if (ACTION_LABEL[key]) return ACTION_LABEL[key];
  }
  return p.slice(0, 2).join(':');   // 未知的至少去掉 session 亂碼
}
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
  action = friendly(action);
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

module.exports = { logAction, slashArgs, modalArgs, friendly, SOURCE_LABEL, ACTION_LABEL };
