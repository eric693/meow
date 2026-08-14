// 互動式送禮：選折價券 → 結帳預覽 → 選付款方式 → 成立禮物單（GFT-）
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getCustomer, orgOf } = require('../db');
const { emb, COLOR, mention } = require('./embed');
const G = require('./gifts');
const S = require('./session');
const { giftMessage, giftDetail } = require('./checkout');

/** 送禮確認：金額拆解 + 客人餘額 + 付款方式 */
function preview(sid, sess) {
  const coupon = sess.couponKey
    ? G.usableCoupons(sess.guildId, sess.customerId, sess.list).find(c => c.item_key === sess.couponKey)
    : null;
  const discount = G.couponDiscount(coupon, sess.list);
  const payable = Math.max(0, sess.list - discount);
  const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
  const enough = coins >= payable;

  return {
    content: '',
    embeds: [emb(sess.guildId, {
      title: '🎁 送禮確認',
      color: COLOR.main,
      desc: [
        '**結帳預覽**',
        `　▫️ 訂單原價：\`${sess.list}\` 元`,
        `　▫️ 代金/背包券折抵：\`${discount}\` 元${coupon ? `（${coupon.name}）` : ''}`,
        `　▫️ 實際應付：\`${payable}\` 元`,
        '',
        `💰 客戶目前雨幣餘額：\`${coins}\``,
        enough ? '' : `⚠️ 雨幣餘額不足 **${payable - coins}**，只能選現金／轉帳結帳。`,
        '',
        '請選擇支付方式：'
      ].filter(x => x !== '').join('\n')
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gf:pay:${sid}:cash`).setLabel('現金 / 轉帳結帳')
        .setStyle(ButtonStyle.Success).setEmoji('💵'),
      new ButtonBuilder().setCustomId(`gf:pay:${sid}:coin`).setLabel('雨幣餘額扣款')
        .setStyle(ButtonStyle.Primary).setEmoji('🪙').setDisabled(!enough),
      new ButtonBuilder().setCustomId(`gf:cancel:${sid}`).setLabel('取消')
        .setStyle(ButtonStyle.Danger).setEmoji('❌')
    )]
  };
}

/** 折價券選單：不使用 + 背包裡可用的券（送禮沒有手動折扣） */
function couponPayload(sid, sess) {
  const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
  const list = G.usableCoupons(sess.guildId, sess.customerId, sess.list).slice(0, 24);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`gf:pick:${sid}`)
    .setPlaceholder('🏷️ 請在此選單中選擇代金券或折價券')
    .addOptions(
      { label: '💵 不使用折價券', value: 'none' },
      ...list.map(c => {
        const o = G.couponOption(c, sess.list);
        return { label: o.label.slice(0, 100), value: c.item_key, description: o.description.slice(0, 100) };
      })
    );
  return {
    content: `🎁 正在為 ${mention(sess.customerId)} 準備送給 ${/^\d{15,25}$/.test(String(sess.staffId || '')) ? mention(sess.staffId) : (sess.staffName || sess.staffId)}`
           + ` 的禮物，總額：\`${sess.list}\` 元。\n💰 客戶目前雨幣餘額：\`${coins}\` 雨幣`,
    embeds: [],
    components: [new ActionRowBuilder().addComponents(menu)]
  };
}

/** 沒有任何可用券就直接進付款預覽，有券才多問一步 */
function start(sess) {
  const sid = S.put(sess);
  const has = G.usableCoupons(sess.guildId, sess.customerId, sess.list).length;
  return { sid, payload: has ? couponPayload(sid, sess) : preview(sid, sess) };
}

/** 成立禮物單 */
function finish(sid, pay) {
  const sess = S.get(sid);
  if (!sess) throw new Error('這次送禮已逾時（超過 15 分鐘），請重新執行 /送禮。');

  let coupon = null;
  if (sess.couponKey) {
    coupon = G.usableCoupons(sess.guildId, sess.customerId, sess.list)
      .find(c => c.item_key === sess.couponKey);
    if (!coupon) throw new Error('選用的折價券已失效或不在背包裡，請重新送禮。');
  }
  const discount = G.couponDiscount(coupon, sess.list);
  const payable = Math.max(0, sess.list - discount);
  if (payable === 0) throw new Error('折抵後實付為 0 元，請改用其他方式處理。');

  const cash = pay === 'cash';
  if (!cash) {
    const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
    if (coins < payable) throw new Error(`雨幣餘額不足：目前 ${coins}，需要 ${payable}`);
  }
  if (coupon) G.useCoupon(sess.guildId, sess.customerId, coupon.item_key);

  const r = G.sendGift({
    guildId: sess.guildId, customerId: sess.customerId, customerName: sess.customerName,
    staffId: sess.staffId, giftKey: sess.giftKey, qty: sess.qty,
    csId: sess.csId, csName: sess.csName, operator: sess.csName,
    discount, payMethod: cash ? '現金 / 轉帳' : '雨幣扣款', skipWallet: cash
  });

  S.drop(sid);
  return {
    ...r, cash, coupon,
    message: giftMessage(sess.guildId, r),
    detail: giftDetail(sess.guildId, r)
  };
}

module.exports = { start, preview, couponPayload, finish };
