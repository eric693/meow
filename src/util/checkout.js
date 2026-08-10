// 結帳與撤銷的訊息樣板
// - checkoutMessage：發在頻道給老闆看的結帳明細
// - checkoutDetail：只給經辦客服看的機密版（多了餘額、分潤與親密度動態）
// - refundNotice：退單／撤銷通知
const { getSetting, getCustomer, orgOf } = require('../db');
const { emb, mention, brand, COLOR } = require('./embed');
const { vipName } = require('./reports');

const LINE = '━━━━━━━━━━━━━━━━━━';
const n = v => Number(v || 0).toLocaleString('en-US');

const introOf = guildId => {
  const id = getSetting('channel_intro', '', guildId);
  return id ? `<#${id}>` : '〈陪陪介紹〉';
};
const csOf = o => (o.cs_id ? mention(o.cs_id) : o.cs_name || '—');

/** 發在頻道、給老闆看的結帳完成通知 */
function checkoutMessage(guildId, o) {
  const c = getCustomer(orgOf(guildId), o.customer_id);
  const discount = Math.max(0, o.list_price - o.amount);

  const content = [
    `${mention(o.customer_id)} 老闆您好！`,
    `您與陪玩 ${mention(o.staff_id)} 的本次服務已結帳完畢，實付金額為：\`${o.amount}\` 元。`,
    `請享受接下來的時光~ 最後別忘了到 ⭐ ${introOf(guildId)} 留下評價呦!`,
    '',
    `🏷️ 本次訂單編號：\`${o.order_no}\` (供陪玩報單專用)`
  ].join('\n');

  const body = emb(guildId, {
    title: `🧾 ${brand(guildId)}｜本次結帳明細 (${o.order_no})`,
    color: COLOR.money,
    desc: [
      LINE,
      `👤 消費金主：${mention(o.customer_id)}`,
      `🏆 金主等級：${vipName(guildId, c.vip_level)}`,
      `🎀 服務陪玩：${mention(o.staff_id)}`,
      '',
      '📝 **訂單拆帳明細**',
      `▫️ 訂單原價：\`${o.list_price}\` 元`,
      `▫️ 手動/背包券：🎟️ \`${discount}\` 元`,
      `▫️ 支付方式：💸 ${o.pay_method || '雨幣扣款'}`,
      `▫️ 客人實付：\`${o.amount}\` 元`,
      '',
      LINE,
      `✅ 經辦客服：${csOf(o)}`
    ].join('\n')
  });

  return { content, embeds: [body] };
}

/** 只給經辦客服看的機密版：多了雨幣餘額、分潤拆解與親密度動態 */
function checkoutDetail(guildId, o) {
  const c = getCustomer(orgOf(guildId), o.customer_id);
  const discount = Math.max(0, o.list_price - o.amount);
  const rate = require('./money').shareRate(guildId);
  const points = require('./gifts').getIntimacy(guildId, o.customer_id, o.staff_id);
  const pending = o.status === 'settled' ? '已入可提領' : '暫存中';

  return emb(guildId, {
    title: `🧾 ${brand(guildId)}｜本次結帳明細 (${o.order_no})`,
    color: COLOR.money,
    desc: [
      LINE,
      `👤 消費金主：${mention(o.customer_id)}`,
      `🏆 金主等級：${vipName(guildId, c.vip_level)}（累計消費：\`${n(c.total_spend)}\`）`,
      `🎀 服務陪玩：${mention(o.staff_id)}`,
      '',
      '📝 **訂單折帳明細**',
      `▫️ 訂單原價：\`${o.list_price}\` 元`,
      `▫️ 手動/背包券：🎟️ \`${discount}\` 元`,
      `▫️ 支付方式：💸 ${o.pay_method || '雨幣扣款'}`,
      `▫️ 客人實付：\`${o.amount}\` 元`,
      `💰 雨幣餘額：\`${n(c.coins)}\` 雨幣`,
      '',
      '💰 **分潤結果**',
      `▫️ 陪玩所得 (${rate}%)：\`${n(o.staff_share)}\` 元 *(${pending})*`,
      `▫️ 伺服器利潤：\`${n(o.net)}\` 元`,
      '',
      '❤️ **親密度動態**',
      `▫️ 本次獲得：\`${n(o.intimacy)}\` 點`,
      `▫️ 目前總計：\`${n(points)}\` 點`,
      '',
      LINE,
      `✅ 經辦客服：${csOf(o)}`
    ].join('\n')
  });
}

/** 退單／撤銷通知 */
function refundNotice(guildId, o, { reason = '', refundCoins = true, operator = '' } = {}) {
  const kindLabel = require('./money').kindLabel(o.kind);
  return emb(guildId, {
    title: `🚫 撤銷通知（${kindLabel}）`,
    color: COLOR.err,
    desc: [
      `📋 訂單編號：\`${o.order_no}\``,
      `👤 金主：${o.customer_id ? mention(o.customer_id) : o.customer_name || '—'}`,
      `🎯 陪玩：${o.staff_id ? mention(o.staff_id) : o.staff_name || '—'}`,
      `📝 原因：${reason || '無註記'}`,
      '',
      '💳 **帳務回溯明細**',
      `▫️ 撤銷原價業績：\`${n(o.amount)}\` 元`,
      `▫️ 扣回陪玩薪資：\`${n(o.staff_share)}\` 元`,
      `▫️ 伺服器利潤撤銷：\`${n(o.net)}\` 元`,
      '',
      '💔 **親密羈絆回溯**',
      `▫️ 扣除點數：\`${n(o.intimacy)}\` 點`,
      '',
      '💰 **雨幣處理狀態**',
      refundCoins ? `✅ 已退還 \`${n(o.amount)}\` 雨幣` : '❌ 未退還雨幣',
      '',
      `經辦人：${operator || '—'}`
    ].join('\n')
  });
}

module.exports = { checkoutMessage, checkoutDetail, refundNotice };
