// 主群「結帳明細」訊息：客服結完帳後通知老闆，並附上供陪玩報單用的訂單編號
const { getSetting, getCustomer, orgOf } = require('../db');
const { emb, mention, brand, COLOR } = require('./embed');

const LINE = '━━━━━━━━━━━━━━━━━━';

/** 產生 { content, embeds }，可直接丟給 channel.send() */
function checkoutMessage(guildId, o) {
  const vip = getCustomer(orgOf(guildId), o.customer_id).vip_level;
  const discount = Math.max(0, o.list_price - o.amount);
  const introId = getSetting('channel_intro', '', guildId);
  const intro = introId ? `<#${introId}>` : '〈陪陪介紹〉';

  const content = [
    `🔔 ${mention(o.customer_id)} 老闆您好！`,
    `您與陪玩 ${mention(o.staff_id)} 的本次服務已結帳完畢，實付金額為 \`${o.amount}\` 元。`,
    `請享受接下來的時光~ 最後別忘了到 🌊⭐ ${intro} 留下評價唷!`,
    '',
    `👉 **本次訂單編號：** \`${o.order_no}\`（供陪玩報單專用）`
  ].join('\n');

  const body = emb(guildId, {
    title: `📋 ${brand(guildId)}｜本次結帳明細（${o.order_no}）`,
    color: COLOR.money,
    desc: [
      LINE,
      `👤 消費金主：${mention(o.customer_id)}`,
      `👑 金主等級：VIP ${vip}`,
      `🎀 服務陪玩：${mention(o.staff_id)}`,
      '',
      '📝 **訂單折帳明細**',
      `　• 訂單原價：　${o.list_price} 元`,
      `　• 手動/背包券：💠 ${discount} 元`,
      `　• 支付方式：　🪙 ${o.pay_method || '雨幣扣款'}`,
      `　• 客人實付：　${o.amount} 元`,
      '',
      LINE,
      `✅ 經辦客服：${o.cs_id ? mention(o.cs_id) : o.cs_name || '—'}`
    ].join('\n')
  });

  return { content, embeds: [body] };
}

module.exports = { checkoutMessage };
