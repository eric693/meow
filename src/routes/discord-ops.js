// 後台 → Discord 的實際操作：發面板、發公告、發投票、互動式結帳、退單通知。
// 目標是讓「Discord 能做的，後台都能做」，且兩邊共用同一份訊息樣板與金流邏輯。
const express = require('express');
const { db, getSetting, findStaff, getCustomer, audit, orgOf } = require('../db');
const { requireAuth, guardModule } = require('../auth');
const { emb, ok, COLOR, mention } = require('../util/embed');
const M = require('../util/money');
const G = require('../util/gifts');
const { checkoutMessage, checkoutDetail, refundNotice } = require('../util/checkout');
const { parseSlots } = require('../util/slots');
const bot = require('../bot');

const router = express.Router();
router.use(requireAuth());

const who = req => req.user.name || req.user.username;

/** 取得可發送的頻道，順便擋掉機器人離線或沒權限的情況 */
async function channelOf(guildId, channelId) {
  const client = bot.getClient();
  if (!client || !bot.isReady()) throw new Error('機器人目前離線，無法發送訊息');
  const ch = await client.channels.fetch(channelId).catch(() => null);
  if (!ch || !ch.isTextBased?.()) throw new Error('找不到這個頻道，或它不是文字頻道');
  if (ch.guildId !== guildId) throw new Error('這個頻道不屬於目前選取的伺服器');
  return ch;
}
const fail = (res, e) => res.status(400).json({ error: e.message || String(e) });

// ---------------- 面板建置 ----------------
router.get('/panels/list', guardModule('panels'), (req, res) => {
  const { PANELS } = require('../bot/panels');
  res.json(Object.entries(PANELS).map(([key, p]) => ({ key, label: p.label, command: '!' + key })));
});

router.post('/panels/send', guardModule('panels'), async (req, res) => {
  try {
    const { PANELS } = require('../bot/panels');
    const { key, channel_id } = req.body || {};
    const panel = PANELS[key];
    if (!panel) return res.status(400).json({ error: '查無這個面板' });
    const ch = await channelOf(req.guildId, channel_id);
    const msg = await ch.send(panel.build(req.guildId));
    audit(who(req), '發送面板', `${panel.label} → #${ch.name}`, req.orgId, { source: 'web', channelId: ch.id });
    res.json({ ok: true, message_id: msg.id, channel: ch.name });
  } catch (e) { fail(res, e); }
});

// ---------------- 公告 / 自訂訊息 ----------------
router.post('/announce', guardModule('panels'), async (req, res) => {
  try {
    const { channel_id, title = '', content = '', color = 'main', plain = false, mention_everyone = false } = req.body || {};
    if (!content && !title) return res.status(400).json({ error: '請填寫標題或內容' });
    const ch = await channelOf(req.guildId, channel_id);
    const payload = plain
      ? { content: (mention_everyone ? '@everyone\n' : '') + content }
      : {
          content: mention_everyone ? '@everyone' : undefined,
          embeds: [emb(req.guildId, { title: title || undefined, desc: content, color: COLOR[color] || COLOR.main })]
        };
    const msg = await ch.send(payload);
    audit(who(req), '發送公告', `${title || content.slice(0, 40)} → #${ch.name}`, req.orgId,
      { source: 'web', channelId: ch.id });
    res.json({ ok: true, message_id: msg.id });
  } catch (e) { fail(res, e); }
});

/** 結單公告（等同 !結單） */
router.post('/announce/close-orders', guardModule('panels'), async (req, res) => {
  try {
    const ch = await channelOf(req.guildId, req.body?.channel_id);
    await ch.send({ embeds: [emb(req.guildId, {
      title: '🛑 目前已結單',
      desc: '**請停止下單和聊天。**\n\n今日營業已結束，感謝各位老闆的支持 💜\n有任何問題請等待下次開單或私訊客服。',
      color: COLOR.err
    })] });
    audit(who(req), '發送結單公告', `#${ch.name}`, req.orgId, { source: 'web', channelId: ch.id });
    res.json({ ok: true });
  } catch (e) { fail(res, e); }
});

// ---------------- 投票 ----------------
router.post('/polls', guardModule('polls'), async (req, res) => {
  try {
    const { channel_id, title, options } = req.body || {};
    const opts = (Array.isArray(options) ? options : String(options || '').split(/[、,]/))
      .map(x => String(x).trim()).filter(Boolean).slice(0, 10);
    if (!title || opts.length < 2) return res.status(400).json({ error: '請填寫標題與至少兩個選項' });
    const ch = await channelOf(req.guildId, channel_id);
    const info = db.prepare('INSERT INTO polls (guild_id, title, options) VALUES (?,?,?)')
      .run(req.guildId, title, JSON.stringify(opts));
    const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
    await ch.send({
      embeds: [emb(req.guildId, {
        title: '🗳️ ' + title,
        desc: opts.map((o, i) => `${i + 1}. ${o}`).join('\n') + '\n\n共 0 票・匿名投票'
      })],
      components: [new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder().setCustomId(`poll:${info.lastInsertRowid}`)
          .setPlaceholder('選擇你的答案（可重選覆蓋）')
          .addOptions(opts.map((o, i) => ({ label: o.slice(0, 100), value: String(i) }))))]
    });
    audit(who(req), '發布投票', title, req.orgId, { source: 'web', channelId: ch.id });
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) { fail(res, e); }
});

// ---------------- 結帳（含折價券與付款方式）----------------
/** 這位老闆這筆金額可用的券，給後台結帳畫面下拉用 */
router.get('/checkout/coupons', guardModule('orders'), (req, res) => {
  const { customer_id, amount } = req.query;
  if (!customer_id) return res.json([]);
  res.json(G.usableCoupons(req.orgId, String(customer_id), Number(amount) || 0)
    .map(c => ({ key: c.item_key, name: c.name, qty: c.qty, value: c.value,
                 percent: c.percent, min_spend: c.min_spend,
                 discount: G.couponDiscount(c, Number(amount) || 0), label: G.couponLabel(c) })));
});

router.post('/checkout', guardModule('orders'), async (req, res) => {
  try {
    const b = req.body || {};
    const customerId = String(b.customer_id || '').trim();
    const staff = findStaff(req.orgId, String(b.staff || '').trim());
    if (!customerId) return res.status(400).json({ error: '請指定老闆 Discord ID' });
    if (!staff) return res.status(400).json({ error: '查無這位陪玩' });

    const list = Math.round(Number(b.list_price));
    const manual = Math.max(0, Math.round(Number(b.manual_discount) || 0));
    if (!Number.isFinite(list) || list <= 0) return res.status(400).json({ error: '訂單原價必須大於 0' });

    const coupon = b.coupon_key
      ? G.usableCoupons(req.orgId, customerId, list).find(c => c.item_key === b.coupon_key)
      : null;
    if (b.coupon_key && !coupon) return res.status(400).json({ error: '這張折價券已失效或不符使用條件' });

    const discount = G.couponDiscount(coupon, list) + manual;
    const payable = Math.max(0, list - discount);
    if (payable <= 0) return res.status(400).json({ error: '折抵後實付為 0 元，請調整金額' });

    const cash = b.pay === 'cash';
    if (!cash) {
      const coins = getCustomer(req.orgId, customerId).coins;
      if (coins < payable) return res.status(400).json({ error: `雨幣餘額不足：目前 ${coins}，需要 ${payable}` });
    }
    if (coupon) G.useCoupon(req.orgId, customerId, coupon.item_key);

    const item = b.item || '陪玩服務';
    const { qty } = parseSlots(item);
    const order = M.createOrder({
      guildId: req.orgId, customerId, customerName: b.customer_name || '',
      staffId: staff.user_id, staffName: staff.name || staff.code,
      csId: String(b.cs_id || '').trim(), csName: who(req),
      item, qty, unitPrice: Math.round(payable / (qty || 1)),
      listPrice: list, amount: payable, source: 'ticket', operator: who(req),
      payMethod: cash ? '現金 / 轉帳' : '雨幣扣款', skipWallet: cash,
      note: [b.note || '', coupon ? `使用券：${coupon.name}` : ''].filter(Boolean).join(' / ')
    });

    // 有指定頻道就把結帳明細發出去，沒指定就只建帳
    let posted = false;
    if (b.channel_id) {
      const ch = await channelOf(req.guildId, b.channel_id);
      await ch.send(checkoutMessage(req.guildId, order));
      posted = true;
    }
    res.json({ ok: true, order, posted, discount, detail: checkoutDetail(req.guildId, order).data });
  } catch (e) { fail(res, e); }
});

// ---------------- 退單（可選是否退幣、可發撤銷通知）----------------
router.post('/checkout/refund', guardModule('orders'), async (req, res) => {
  try {
    const { order_no, reason = '', refund_coins = true, channel_id } = req.body || {};
    const order = M.refundOrder(req.orgId, String(order_no || '').trim().toUpperCase(),
      who(req), reason, { refundCoins: !!refund_coins });
    const notice = refundNotice(req.guildId, order,
      { reason, refundCoins: !!refund_coins, operator: who(req) });
    if (channel_id) {
      const ch = await channelOf(req.guildId, channel_id);
      await ch.send({ embeds: [notice] });
    }
    res.json({ ok: true, order, notice: notice.data });
  } catch (e) { fail(res, e); }
});

// ---------------- 專用結帳類型 ----------------
router.post('/checkout/special', guardModule('orders'), async (req, res) => {
  try {
    const b = req.body || {};
    const kind = b.type;   // role 身分組結帳 / naming 伺服器冠名 / backfill 補單 / adjust 財務調整
    const amount = Math.round(Number(b.amount));
    if (!Number.isFinite(amount)) return res.status(400).json({ error: '金額格式不正確' });

    const base = {
      guildId: req.orgId, csName: who(req), csId: String(b.cs_id || '').trim(),
      source: 'manual', status: 'settled', operator: who(req), note: b.note || ''
    };
    let order;
    if (kind === 'adjust') {
      if (!b.note) return res.status(400).json({ error: '財務調整必須填寫原因' });
      order = M.createOrder({ ...base, customerId: '', staffId: '', allowNoStaff: true, allowZero: true,
        kind: 'adjust', item: b.note, qty: 1, unitPrice: amount, amount, skipWallet: true, intimacy: 0 });
    } else {
      const customerId = String(b.customer_id || '').trim();
      if (!customerId) return res.status(400).json({ error: '請指定老闆 Discord ID' });
      if (kind === 'naming') {
        order = M.createOrder({ ...base, customerId, staffId: '', allowNoStaff: true, staffName: '（伺服器）',
          item: b.item || '伺服器冠名', qty: 1, unitPrice: amount, amount });
      } else {
        const staff = findStaff(req.orgId, String(b.staff || '').trim());
        if (!staff) return res.status(400).json({ error: '查無這位陪玩' });
        const item = b.item || (kind === 'role' ? '身分組' : '補登');
        const { qty } = parseSlots(item);
        order = M.createOrder({
          ...base, customerId, staffId: staff.user_id, staffName: staff.name || staff.code,
          kind: kind === 'role' ? 'role' : 'order', item, qty,
          unitPrice: Math.round(amount / (qty || 1)), amount,
          // 補單只補帳本，不動雨幣也不加羈絆
          skipWallet: kind === 'backfill',
          intimacy: kind === 'backfill' ? 0 : null,
          createdAt: b.created_at || null
        });
      }
    }
    res.json({ ok: true, order });
  } catch (e) { fail(res, e); }
});

// ---------------- 直接私訊某位成員 ----------------
router.post('/dm', guardModule('panels'), async (req, res) => {
  try {
    const { user_id, content } = req.body || {};
    if (!user_id || !content) return res.status(400).json({ error: '請填寫對象與內容' });
    const client = bot.getClient();
    if (!client || !bot.isReady()) return res.status(503).json({ error: '機器人目前離線' });
    const u = await client.users.fetch(String(user_id)).catch(() => null);
    if (!u) return res.status(404).json({ error: '查無這位成員' });
    await u.send({ embeds: [emb(req.guildId, { title: '📩 來自客服的訊息', desc: content })] });
    audit(who(req), '私訊成員', `${u.tag}：${content.slice(0, 60)}`, req.orgId, { source: 'web' });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message?.includes('Cannot send') ? '對方關閉了私訊' : e.message });
  }
});

module.exports = router;
