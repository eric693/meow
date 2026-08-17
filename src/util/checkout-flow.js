// 互動式結帳：選折價券 → 結帳預覽 → 選付款方式 → 成立訂單
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');
const { getCustomer, orgOf } = require('../db');
const { emb, COLOR, mention } = require('./embed');
const G = require('./gifts');
const M = require('./money');
const S = require('./session');
const { checkoutMessage, checkoutDetail } = require('./checkout');

const PAY_CASH = '現金 / 轉帳';
const PAY_COIN = '雨幣扣款';

/** 折價券選單：手動折扣 + 不使用 + 背包裡可用的券 */
function couponRow(sid, sess) {
  const list = G.usableCoupons(sess.guildId, sess.customerId, sess.list).slice(0, 23);
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`co:pick:${sid}`)
    .setPlaceholder('🎟️ 請在此選單中選擇代金券或折價券')
    .addOptions(
      { label: '✍️ 手動輸入額外折扣金額', value: 'manual', description: '點擊後將彈出輸入框' },
      { label: `💵 無使用額外代金券 (${sess.manualDiscount || 0})`, value: 'none' },
      ...list.map(c => {
        const o = G.couponOption(c, sess.list);
        return { label: o.label.slice(0, 100), value: c.item_key, description: o.description.slice(0, 100) };
      })
    );
  return new ActionRowBuilder().addComponents(menu);
}

/** 結帳預覽：金額拆解 + 客人餘額 + 兩種付款方式按鈕 */
function preview(sid, sess) {
  const coupon = sess.couponKey
    ? G.usableCoupons(sess.guildId, sess.customerId, sess.list).find(c => c.item_key === sess.couponKey)
    : null;
  const discount = G.couponDiscount(coupon, sess.list) + (sess.manualDiscount || 0);
  const payable = Math.max(0, sess.list - discount);
  const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
  const enough = coins >= payable;

  return {
    embeds: [emb(sess.guildId, {
      title: '💳 選擇付款方式',
      color: COLOR.money,
      desc: [
        '**結帳預覽**',
        `　▫️ 訂單原價：\`${sess.list}\` 元`,
        `　▫️ 代金/背包券折抵：\`${discount}\` 元${coupon ? `（${coupon.name}）` : ''}`,
        `　▫️ 實際應付：\`${payable}\` 元`,
        '',
        `💰 客戶目前雨幣餘額：\`${coins}\``,
        enough ? '' : `⚠️ 雨幣餘額不足 **${payable - coins}**，只能選現金／轉帳結帳。`,
        '',
        '請選擇客人的支付方式：'
      ].filter(x => x !== '').join('\n')
    })],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`co:pay:${sid}:cash`).setLabel('現金 / 轉帳結帳')
        .setStyle(ButtonStyle.Success).setEmoji('💵'),
      new ButtonBuilder().setCustomId(`co:pay:${sid}:coin`).setLabel('雨幣餘額扣款')
        .setStyle(ButtonStyle.Primary).setEmoji('🪙').setDisabled(!enough),
      new ButtonBuilder().setCustomId(`co:cancel:${sid}`).setLabel('取消')
        .setStyle(ButtonStyle.Secondary)
    )]
  };
}

/** /結帳 的第一步：先選券（含手動折扣），再進付款預覽 */
function start(sess) {
  const sid = S.put(sess);
  return { sid, payload: couponPayload(sid, sess) };
}

/** 身分組結帳：沒有折價券流程，直接進付款方式選擇 */
function startRole(sess) {
  const sid = S.put(sess);
  return { sid, payload: preview(sid, sess) };
}

/** 選券畫面 */
function couponPayload(sid, sess) {
  const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
  return {
    content: `🧾 正在為 ${mention(sess.customerId)} 結帳，訂單原價：\`${sess.list}\` 元。\n`
           + `💰 客戶目前雨幣餘額：\`${coins}\` 雨幣`,
    embeds: [],
    components: [couponRow(sid, sess)]
  };
}

/** 成立訂單：扣券、依付款方式決定要不要動雨幣，最後回傳結帳明細訊息 */
function finish(sid, pay) {
  const sess = S.get(sid);
  if (!sess) throw new Error('這筆結帳已逾時（超過 15 分鐘），請重新執行 /結帳。');

  let coupon = null;
  if (sess.couponKey) {
    coupon = G.usableCoupons(sess.guildId, sess.customerId, sess.list)
      .find(c => c.item_key === sess.couponKey);
    if (!coupon) throw new Error('選用的折價券已失效或不在背包裡，請重新結帳。');
  }
  const discount = G.couponDiscount(coupon, sess.list) + (sess.manualDiscount || 0);
  const payable = Math.max(0, sess.list - discount);
  // 折價券剛好折抵完（例如 500 元的單用 500 元券）是正常的用法，實付 0 照樣成立：
  // 陪玩抽成本來就以原價計算、折扣由伺服器吸收。只有「原價本身就是 0」才是真的有問題。
  if (payable === 0 && discount <= 0) throw new Error('訂單金額為 0，請確認原價。');

  const cash = pay === 'cash';
  if (!cash) {
    const coins = getCustomer(orgOf(sess.guildId), sess.customerId).coins;
    if (coins < payable) throw new Error(`雨幣餘額不足：目前 ${coins}，需要 ${payable}`);
  }

  // 先扣券再建單；建單失敗會丟錯，這時券還沒真的被消耗（同一個同步流程內沒有中間狀態外洩）
  if (coupon) G.useCoupon(sess.guildId, sess.customerId, coupon.item_key);

  const note = [sess.note, coupon ? `使用券：${coupon.name}` : ''].filter(Boolean).join(' / ');
  const order = M.createOrder({
    guildId: sess.guildId, customerId: sess.customerId, customerName: sess.customerName,
    staffId: sess.staffId, staffName: sess.staffName,
    csId: sess.csId, csName: sess.csName,
    item: sess.item, qty: sess.qty,
    unitPrice: Math.round(payable / (sess.qty || 1)),
    listPrice: sess.list, amount: payable,
    // 身分組結帳走 kind='role' 且免核銷，直接入可提領
    ...(sess.kind ? { kind: sess.kind } : {}),
    ...(sess.status ? { status: sess.status } : {}),
    source: 'ticket', operator: sess.csName,
    payMethod: cash ? PAY_CASH : PAY_COIN,
    // 現金／轉帳是場外收款，不能再動客人的雨幣餘額
    skipWallet: cash,
    // 全額折抵時實付為 0，要明確允許 0 元單
    allowZero: payable === 0,
    note
  });

  S.drop(sid);
  return {
    order, discount, coupon, cash,
    message: checkoutMessage(sess.guildId, order),
    detail: checkoutDetail(sess.guildId, order)
  };
}

module.exports = { start, startRole, preview, couponPayload, finish, PAY_CASH, PAY_COIN };
