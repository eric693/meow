// Slash 指令處理
const { db, getCustomer, findStaff, getStaff, addCoins, refreshVip, audit, orgOf } = require('../db');
const M = require('../util/money');
const { checkoutMessage, refundNotice } = require('../util/checkout');
const { parseSlots } = require('../util/slots');
const CF = require('../util/checkout-flow');
const GF = require('../util/gift-flow');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const { vipName } = require('../util/reports');
const G = require('../util/gifts');
const R = require('../util/reports');
const { isCS } = require('./perm');
const { helpEmbed } = require('../util/help');
const { getSetting } = require('../db');

/** 把金流紀錄發到「金流紀錄頻道」；沒設定就退回後台財務頻道，再沒有就發在當前頻道 */
async function moneyLog(i, embed) {
  const id = getSetting('channel_money_log', '', i.guildId) || getSetting('channel_finance', '', i.guildId);
  const ch = id ? await i.client.channels.fetch(id).catch(() => null) : null;
  await (ch && ch.isTextBased() ? ch : i.channel).send({ embeds: [embed] }).catch(() => {});
}

// 標記起來，讓 index.js 把這次互動記成 deny 而不是成功
const deny = i => {
  i._denied = true;
  return i.reply({ embeds: [err(i.guildId, '你沒有使用這個指令的權限。')], ephemeral: true });
};

// 「陪玩」參數可填代號／藝名／@提及
function resolveStaff(i, key = '陪玩') {
  const raw = i.options.getString(key);
  const s = findStaff(i.guildId, raw);
  if (!s) throw new Error(`查無陪玩「${raw}」，請確認代號或藝名（可用 /入職 建檔）`);
  return s;
}

const handlers = {
  // ---------- 說明 ----------
  async help(i) {
    const pub = i.options.getBoolean('公開') || false;
    await i.reply({ embeds: [helpEmbed(i.guildId)], ephemeral: !pub });
  },

  // ---------- 財務與結帳 ----------
  async 結帳(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('客人');
    const st = resolveStaff(i);
    const paid = i.options.getInteger('金額');
    const list = i.options.getInteger('原價') ?? paid;
    if (list < paid) return i.reply({ embeds: [err(i.guildId, '訂單原價不可小於客人實付金額。')], ephemeral: true });
    const item = i.options.getString('項目') || '陪玩服務';
    const { qty } = parseSlots(item);
    // 指令帶的「金額」若低於原價，差額視為客服手動折讓，之後再疊加背包券
    const { payload } = CF.start({
      guildId: i.guildId,
      customerId: u.id, customerName: u.username,
      staffId: st.user_id, staffName: st.name || st.code,
      csId: i.user.id, csName: i.user.tag,
      item, qty, list, manualDiscount: list - paid,
      note: i.options.getString('備註') || ''
    });
    await i.reply({ ...payload, ephemeral: true });
  },

  async 身分組結帳(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('客人');
    const s = resolveStaff(i);
    const item = i.options.getString('項目');
    const unit = i.options.getInteger('單價');
    const qty = i.options.getInteger('數量') || 1;
    // 跟 /結帳 一樣先問付款方式（現金／雨幣／取消），只是沒有折價券這一步
    const { payload } = CF.startRole({
      guildId: i.guildId,
      customerId: u.id, customerName: u.username,
      staffId: s.user_id, staffName: s.name || s.code,
      csId: i.user.id, csName: i.user.tag,
      item, qty, list: unit * qty,
      kind: 'role', status: 'settled',
      note: i.options.getString('備註') || ''
    });
    await i.reply({ ...payload, ephemeral: true });
  },

  async 伺服器冠名結帳(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const amount = i.options.getInteger('金額');
    const o = M.createOrder({
      guildId: i.guildId, customerId: u.id, customerName: u.username,
      staffId: '', allowNoStaff: true, staffName: '（伺服器）',
      csId: i.user.id, csName: i.user.tag,
      item: i.options.getString('項目') || '伺服器冠名', qty: 1, unitPrice: amount, amount,
      source: 'ticket', status: 'settled', operator: i.user.tag,
      note: i.options.getString('備註') || ''
    });
    await i.reply({ embeds: [money(i.guildId, '🏷️ 伺服器冠名結帳完成', `訂單編號 \`${o.order_no}\``, [
      { name: '消費金主', value: mention(u.id), inline: true },
      { name: '實付金額', value: `${n(amount)} 雨幣`, inline: true },
      { name: '伺服器淨利', value: `**${n(o.net)}**（100%）`, inline: true }
    ])] });
  },

  async 儲值(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('對象');
    const amt = i.options.getInteger('金額');
    const reason = i.options.getString('原因') || '人工儲值';
    addCoins(i.guildId, u.id, amt, reason, { operator: i.user.tag, name: u.username });
    await i.reply({ content: `✅ **儲值成功！** 已將 \`${n(amt)}\` 雨幣 放入 ${mention(u.id)} 的金庫。`,
      ephemeral: true });
    return moneyLog(i, emb(i.guildId, {
      title: '💰 儲值紀錄',
      color: COLOR.ok,
      desc: `**對象：** ${mention(u.id)}\n**金額：** \`${n(amt)}\` 雨幣\n**經辦：** ${mention(i.user.id)}`
    }));
  },

  async 扣款(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('對象');
    const amt = i.options.getInteger('金額');
    const reason = i.options.getString('原因') || '人工扣款';
    const bal = addCoins(i.guildId, u.id, -amt, reason, { operator: i.user.tag, name: u.username });
    await i.reply({ content: `✅ **扣款成功！** 已從 ${mention(u.id)} 的帳戶扣除 \`${n(amt)}\` 雨幣。`,
      ephemeral: true });
    return moneyLog(i, emb(i.guildId, {
      title: '💵 手動扣款紀錄',
      color: COLOR.err,
      desc: `**經辦人：** ${mention(i.user.id)}\n**對象：** ${mention(u.id)}\n`
          + `**扣除：** \`${n(amt)}\` 雨幣\n**剩餘餘額：** \`${n(bal)}\` 雨幣`
    }));
  },

  async 提領(i) {
    if (!isCS(i.member)) return deny(i);
    const s = resolveStaff(i);
    const amt = i.options.getInteger('金額');
    M.payoutStaff(i.guildId, s.user_id, amt, i.user.tag, i.options.getString('備註') || '');
    const after = getStaff(i.guildId, s.user_id);
    await i.reply({ content: '✅ 提領作業已完成並公開發送至指定頻道。', ephemeral: true });
    return moneyLog(i, emb(i.guildId, {
      title: '💸 薪資發放成功',
      color: COLOR.ok,
      desc: `✅ 已成功扣除系統帳目，發放 \`${n(amt)}\` 元薪資給 ${mention(s.user_id)}。\n`
          + `💳 該員剩餘可提領薪資：\`${n(after.income)}\` 元`,
      footer: `經辦人：${i.user.tag}`
    }));
  },

  async 退單(i) {
    if (!isCS(i.member)) return deny(i);
    const no = i.options.getString('訂單編號').trim().toUpperCase();
    const refundCoins = i.options.getBoolean('退還雨幣') ?? true;
    const reason = i.options.getString('原因') || '';
    const o = M.refundOrder(i.guildId, no, i.user.tag, reason, { refundCoins });
    await i.reply({ embeds: [refundNotice(i.guildId, o, { reason, refundCoins, operator: i.user.tag })], ephemeral: true });
  },

  async 補單(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('客人');
    const s = resolveStaff(i);
    const amount = i.options.getInteger('金額');
    const date = (i.options.getString('日期') || '').trim();
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return i.reply({ embeds: [err(i.guildId, '日期格式請用 YYYY-MM-DD，例如 2026-08-01。')], ephemeral: true });
    const item = i.options.getString('項目') || '補登';
    const { qty } = parseSlots(item);
    const o = M.createOrder({
      guildId: i.guildId, customerId: u.id, customerName: u.username,
      staffId: s.user_id, csId: i.user.id, csName: i.user.tag,
      item, qty, unitPrice: Math.round(amount / (qty || 1)), amount,
      source: 'manual', status: 'settled', skipWallet: true, intimacy: 0,
      createdAt: date ? `${date} 12:00:00` : null,
      operator: i.user.tag, note: i.options.getString('備註') || '手動補單'
    });
    await i.reply({ embeds: [money(i.guildId, '📒 已補登帳本', `訂單編號 \`${o.order_no}\``, [
      { name: '金主', value: mention(u.id), inline: true },
      { name: '陪玩', value: s.name || s.code, inline: true },
      { name: '金額', value: `${n(amount)} 雨幣`, inline: true },
      { name: '日期', value: o.created_at.slice(0, 10), inline: true },
      { name: '說明', value: '僅影響對帳與戰報，未變動雨幣餘額與可提領薪資。' }
    ])] });
  },

  async 財務調整(i) {
    if (!isCS(i.member)) return deny(i);
    const amount = i.options.getInteger('金額');
    const reason = i.options.getString('原因');
    const o = M.createOrder({
      guildId: i.guildId, customerId: '', staffId: '', allowNoStaff: true, allowZero: true,
      csId: i.user.id, csName: i.user.tag, kind: 'adjust', item: reason,
      qty: 1, unitPrice: amount, amount, source: 'manual', status: 'settled',
      skipWallet: true, intimacy: 0, operator: i.user.tag, note: reason
    });
    await i.reply({ embeds: [money(i.guildId, '⚙️ 財務調整已記錄', `訂單編號 \`${o.order_no}\``, [
      { name: '淨利變動', value: `${amount > 0 ? '+' : ''}${n(amount)} 雨幣`, inline: true },
      { name: '原因', value: reason, inline: true },
      { name: '經辦', value: mention(i.user.id), inline: true }
    ])] });
  },

  async 發放折價券(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const type = i.options.getString('類型');
    const num = i.options.getInteger('數值');
    const name = i.options.getString('名稱').trim();
    const qty = i.options.getInteger('數量') || 1;
    const minSpend = i.options.getInteger('門檻') || 0;
    const expires = (i.options.getString('期限') || '').trim();
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires))
      return i.reply({ embeds: [err(i.guildId, '期限格式請用 YYYY-MM-DD，例如 2026-12-31。')], ephemeral: true });
    // 打折券以「折數」輸入（85 折），存的是折抵百分比（15）
    if (type === 'percent' && (num < 1 || num > 99))
      return i.reply({ embeds: [err(i.guildId, '打折券的折數請填 1~99，例如 85 折填 85。')], ephemeral: true });

    const value = type === 'amount' ? num : 0;
    const percent = type === 'percent' ? 100 - num : 0;
    // 0 元券：像「指定稱呼不加價」這種優惠，背包看得到、結帳時可選用，但不折抵金額
    const desc = type === 'amount' ? (num > 0 ? `折抵 ${n(num)} 元` : '折抵卷')
                                   : `打 ${num} 折`;
    const key = `${type}${num}-${name}`.replace(/\s+/g, '').slice(0, 60);
    G.addItem(i.guildId, u.id, { key, name, qty, value, percent, minSpend, expires: expires || null });
    audit(i.user.tag, '發放折價券', `${name}(${desc})×${qty} → ${u.tag}`, i.guildId);

    const line = `【${name}】(${desc})${minSpend ? `（滿 ${n(minSpend)}）` : ''} x${qty}`;
    await i.reply({ content: `✅ 成功將 ${line} 發送給老闆 ${mention(u.id)} 的背包！`, ephemeral: true });
    return i.channel.send(`發放了 ${line} 給 ${mention(u.id)} 的背包！`);
  },

  // ---------- 查詢與報表 ----------
  async 對帳(i) {
    if (!isCS(i.member)) return deny(i);
    const cust = i.options.getUser('客人');
    const staff = resolveStaff(i);
    const p = R.pairSpend(i.guildId, cust.id, staff.user_id);
    await i.reply({
      embeds: [emb(i.guildId, {
        title: '🔍 專屬對帳紀錄',
        color: COLOR.main,
        desc: `老闆 ${mention(cust.id)} 在 ${mention(staff.user_id)} 身上總共點了 **${p.order_count + p.gift_count}** 次單！\n\n`
            + `💸 **總累計消費 (實付)：** \`${n(p.total)}\` 元`
      })],
      ephemeral: true
    });
  },

  async 陪玩業績詳報(i) {
    if (!isCS(i.member)) return deny(i);
    const staff = resolveStaff(i);
    const d = R.staffDetail(i.guildId, staff.user_id, 10);
    const list = d.patrons.length
      ? d.patrons.map((p, idx) => `第 ${idx + 1} 名：${mention(p.customer_id)} ➜ \`${n(p.amount)}\` 元`).join('\n')
      : '目前還沒有金主紀錄。';
    await i.reply({
      embeds: [money(i.guildId, `📊 ${staff.name || staff.code} 的金主戰報 (Top 10)`, list)],
      ephemeral: true
    });
  },

  async 送禮(i) {
    if (!isCS(i.member)) return deny(i);
    const from = i.options.getUser('送禮人');
    const staff = resolveStaff(i, '對象');
    const key = i.options.getString('禮物款式');
    const gift = G.findGift(i.guildId, key);
    if (!gift) return i.reply({ embeds: [err(i.guildId, `查無禮物款式「${key}」`)], ephemeral: true });
    const qty = Math.max(1, i.options.getInteger('數量') || 1);
    const { payload } = GF.start({
      guildId: i.guildId, customerId: from.id, customerName: from.username,
      staffId: staff.user_id, staffName: staff.name || staff.code,
      csId: i.user.id, csName: i.user.tag,
      giftKey: gift.key, qty, list: gift.price * qty
    });
    await i.reply({ ...payload, ephemeral: true });
  },

  // ---------- 喚雨星象 ----------
  async 抽籤(i) {
    const L = require('../util/lottery');
    const P = require('./panels');
    let r;
    try { r = L.draw(i.guildId, i.user.id, i.user.tag); }
    catch (e) { return i.reply({ embeds: [err(i.guildId, e.message)], ephemeral: true }); }
    await i.reply({ embeds: [P.lotteryEmbed(i.guildId, r)], ephemeral: true });
  },

  async 愛戀查詢(i) {
    const staff = resolveStaff(i);
    const cust = i.options.getUser('客人') || i.user;
    const pts = G.getIntimacy(i.guildId, cust.id, staff.user_id);
    const rank = G.rankOf(pts);
    const gifts = db.prepare(`SELECT gift_name, SUM(qty) q FROM gift_logs
                              WHERE guild_id=? AND customer_id=? AND staff_id=? GROUP BY gift_key
                              ORDER BY q DESC LIMIT 8`).all(orgOf(i.guildId), cust.id, staff.user_id);
    await i.reply({
      embeds: [emb(i.guildId, {
        title: '💞 愛戀藏館',
        desc: `${mention(cust.id)} ❤ **${staff.name || staff.code}**`,
        fields: [
          { name: '羈絆點數', value: n(pts), inline: true },
          { name: '目前階級', value: rank.name, inline: true },
          { name: '下一階', value: rank.next ? `${rank.next.name}（還差 ${n(rank.next.need)}）` : '已達最高階 🎉', inline: true },
          { name: '送過的禮物', value: gifts.length ? gifts.map(g => `${g.gift_name} ×${g.q}`).join('、') : '尚無紀錄' }
        ]
      })]
    });
  },

  async 親密調整(i) {
    if (!isCS(i.member)) return deny(i);
    const cust = i.options.getUser('客人');
    const staff = resolveStaff(i);
    const delta = i.options.getInteger('點數');
    const pts = G.addIntimacy(i.guildId, cust.id, staff.user_id, delta);
    audit(i.user.tag, '親密調整', `${cust.id}×${staff.user_id} ${delta}`, i.guildId);
    await i.reply({
      embeds: [ok(i.guildId, '親密度已調整',
        `${mention(cust.id)} ❤ **${staff.name || staff.code}**\n調整 ${delta > 0 ? '+' : ''}${n(delta)} → 目前 **${n(pts)}**` +
        (pts === 0 ? '\n（已歸零，該 CP 歷史禮物紀錄同步清除）' : ''))]
    });
  },

  async vip等級(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const lv = i.options.getInteger('等級');
    const c = getCustomer(i.guildId, u.id, u.username);
    const before = vipName(i.guildId, c.vip_level);
    if (lv < 0) {
      db.prepare('UPDATE customers SET vip_locked = 0 WHERE id = ?').run(c.id);
      const auto = refreshVip(i.guildId, u.id);
      return i.reply({ content: `✅ 已解除 ${mention(u.id)} 的等級鎖定，改回自動計算，目前為 **${vipName(i.guildId, auto)}**。`,
        ephemeral: true });
    }
    db.prepare('UPDATE customers SET vip_level = ?, vip_locked = 1 WHERE id = ?').run(lv, c.id);
    audit(i.user.tag, '設定 VIP', `${u.id} → ${lv}`, i.guildId);
    await i.reply({
      content: `✅ **已成功為 ${mention(u.id)} 設定 VIP 等級！**\n`
             + `原等級：**${before}**\n新等級：**${vipName(i.guildId, lv)}**（手動設定值: \`${lv}\`）`,
      ephemeral: true
    });
  },

  async 背包查詢(i) {
    const u = i.options.getUser('客人') || i.user;
    if (u.id !== i.user.id && !isCS(i.member)) return deny(i);
    const items = G.listBackpack(i.guildId, u.id);
    const body = items.length
      ? items.map(x => {
          const off = x.percent > 0 ? `打 ${100 - x.percent} 折` : `折抵 ${n(x.value)} 元`;
          const cond = x.min_spend ? `｜滿 ${n(x.min_spend)}` : '';
          const exp = x.expires ? `｜期限 ${x.expires}` : '';
          return `🎟️ **${x.name}**\n└ 優惠內容：\`${off}\`${cond} ｜ 數量：\`${x.qty}\` 張${exp}`;
        }).join('\n\n')
      : '背包裡目前沒有任何道具或折價券。';
    await i.reply({
      embeds: [emb(i.guildId, { title: `🎒 ${u.username} 的專屬背包`, desc: body, color: COLOR.err })],
      ephemeral: true
    });
  },

  async 新增地盤(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const v = i.options.getInteger('數值');
    getCustomer(i.guildId, u.id, u.username);
    const r = G.addTerritory(i.guildId, u.id, v);
    await i.reply({
      embeds: [ok(i.guildId, '地盤已更新',
        `${mention(u.id)} 目前步數 **${r.steps} / 21**` + (r.lapped ? '\n🎉 超過 21 格，已自動歸 0 並完成一圈！' : ''))]
    });
  },

  async 發布投票(i) {
    if (!isCS(i.member)) return deny(i);
    const title = i.options.getString('標題');
    const opts = i.options.getString('選項').split(/[、,，]/).map(s => s.trim()).filter(Boolean).slice(0, 10);
    if (opts.length < 2) throw new Error('至少要 2 個選項');
    const { ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
    const info = db.prepare('INSERT INTO polls (guild_id, channel_id, title, options) VALUES (?,?,?,?)')
      .run(i.guildId, i.channelId, title, JSON.stringify(opts));
    const menu = new StringSelectMenuBuilder()
      .setCustomId(`poll:${info.lastInsertRowid}`)
      .setPlaceholder('選擇你的答案（匿名）')
      .addOptions(opts.map((o, idx) => ({ label: o.slice(0, 100), value: String(idx) })));
    await i.reply({
      embeds: [emb(i.guildId, { title: '🗳️ ' + title, desc: opts.map((o, x) => `${x + 1}. ${o}`).join('\n') + '\n\n*匿名投票，可更改答案*' })],
      components: [new ActionRowBuilder().addComponents(menu)]
    });
    const msg = await i.fetchReply();
    db.prepare('UPDATE polls SET message_id = ? WHERE id = ?').run(msg.id, info.lastInsertRowid);
  },

  // ---------- 人事 ----------
  // ---------- 冠名與身份組期限 ----------
  async 冠名(i) {
    if (!isCS(i.member)) return deny(i);
    const T = require('../util/titles');
    const customer = i.options.getUser('客人'), staff = i.options.getUser('陪玩');
    const t = T.addTitle(i.guildId, {
      kind: 'title', name: i.options.getString('名稱'),
      days: i.options.getInteger('天數'),
      startAt: i.options.getString('開始') || null,
      queueAfter: !!i.options.getBoolean('接棒'),
      customerId: customer.id, customerName: customer.username,
      staffId: staff.id, staffName: staff.username,
      note: i.options.getString('備註') || '',
      operator: i.user.tag, srcGuild: i.guildId
    });
    await i.reply({ embeds: [ok(i.guildId, `🏷️ 冠名已登記（#${t.id}）`, T.titleBlock(t))] });
  },

  async 身份組(i) {
    if (!isCS(i.member)) return deny(i);
    const T = require('../util/titles');
    const u = i.options.getUser('對象');
    const t = T.addTitle(i.guildId, {
      kind: 'role', name: i.options.getString('名稱'),
      days: i.options.getInteger('天數'),
      startAt: i.options.getString('開始') || null,
      targetId: u.id, targetName: u.username,
      note: i.options.getString('備註') || '',
      operator: i.user.tag, srcGuild: i.guildId
    });
    await i.reply({ embeds: [ok(i.guildId, `🎯 身份組期限已登記（#${t.id}）`, T.titleBlock(t))] });
  },

  async 冠名列表(i) {
    const T = require('../util/titles');
    const { rows, total } = T.listTitles(i.guildId, {
      kind: i.options.getString('類別') || '',
      status: i.options.getBoolean('含已結束') ? '' : 'live',
      q: i.options.getString('關鍵字') || '',
      limit: 25
    });
    if (!rows.length)
      return i.reply({ embeds: [ok(i.guildId, '沒有符合條件的紀錄', '　')], ephemeral: true });
    const body = rows.map(t => T.titleBlock(t)).join('\n' + '─'.repeat(28) + '\n');
    await i.reply({ embeds: [emb(i.guildId, {
      title: `🏷️ 冠名／身份組（${total} 筆${total > 25 ? '，顯示前 25 筆' : ''}）`,
      desc: body.slice(0, 4000)
    })] });
  },

  async 結束冠名(i) {
    if (!isCS(i.member)) return deny(i);
    const T = require('../util/titles');
    const id = i.options.getInteger('編號');
    const t = T.endTitle(i.guildId, id, i.user.tag);
    await i.reply({ embeds: [ok(i.guildId, '已提前結束', `#${id}　${t.name}`)] });
  },

  async 收回折價券(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const key = i.options.getString('券');
    const qty = i.options.getInteger('數量');
    const reason = i.options.getString('原因') || '';
    const r = G.revokeItem(i.guildId, u.id, key, qty);
    audit(i.user.tag, '收回折價券', `${r.name}×${r.taken} ← ${u.tag}${reason ? `（${reason}）` : ''}`, i.guildId);
    await i.reply({ embeds: [ok(i.guildId, '已收回折價券',
      `已從 ${mention(u.id)} 的背包收回 **${r.name}** ×${r.taken}`
      + `${r.left ? `，還剩 ${r.left} 張` : '（已全部收回）'}${reason ? `\n原因：${reason}` : ''}`)] });
  },

  async 範本(i) {
    const SN = require('../util/snippets');
    const key = i.options.getString('名稱');
    const s = SN.find(i.guildId, key);
    if (!s) {
      return i.reply({ embeds: [err(i.guildId, `查無模板「${key}」，請確認後台「小工作台」裡的指令名稱。`)],
                       ephemeral: true });
    }
    if (s.cs_only && !isCS(i.member)) return deny(i);
    SN.bump(s.id);
    // 斜線指令才有真正的「只有自己看得到」
    await i.reply({ embeds: [emb(i.guildId, { title: s.title || `📋 ${s.key}`, desc: s.content })],
                    ephemeral: true });
  },

  async 入職(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('對象');
    const code = i.options.getString('代號');
    const name = i.options.getString('名稱');
    const url = i.options.getString('網址') || '';
    const kind = i.options.getString('職務') || 'player';
    db.prepare(`INSERT INTO staff (guild_id, user_id, code, name, card_url, kind) VALUES (?,?,?,?,?,?)
                ON CONFLICT(guild_id, user_id) DO UPDATE SET
                  code=excluded.code, name=excluded.name, card_url=excluded.card_url,
                  kind=excluded.kind, active=1`)
      .run(orgOf(i.guildId), u.id, code, name, url, kind);
    audit(i.user.tag, '入職', `${name}(${code}) ${u.id}`, i.guildId);
    await i.reply({
      embeds: [emb(i.guildId, {
        title: '🎊 入職成功！',
        color: COLOR.ok,
        desc: `✅ 已成功將 **${name}** 加入公司的正式名單！\n`
            + (url ? `名片網址已綁定：${url}` : '（尚未綁定名片網址，可再執行一次 /入職 補上）')
      })]
    });
  }
};

// 送禮款式自動完成
async function autocomplete(i) {
  if (!i.guildId) return i.respond([]);
  const focused = i.options.getFocused(true);
  const q = String(focused?.value || '').toLowerCase().replace(/^@/, '');

  // 收回折價券：列出那位老闆背包裡實際有的券
  if (focused?.name === '券') {
    const target = i.options.get('老闆')?.value;
    if (!target) return i.respond([{ name: '請先選擇老闆', value: 'none' }]);
    const bag = G.listBackpack(i.guildId, String(target))
      .filter(c => !q || c.name.toLowerCase().includes(q))
      .slice(0, 25);
    if (!bag.length) return i.respond([{ name: '這位老闆的背包是空的', value: 'none' }]);
    return i.respond(bag.map(c => ({ name: G.couponLabel(c).slice(0, 100), value: c.item_key })));
  }

  // 回應模板：列出後台「小工作台」建立的自訂指令
  if (focused?.name === '名稱') {
    const list = require('../util/snippets').list(i.guildId)
      .filter(s => !q || s.key.toLowerCase().includes(q) || (s.title || '').toLowerCase().includes(q))
      .slice(0, 25);
    return i.respond(list.map(s => ({
      name: `${s.key}${s.title ? `｜${s.title}` : ''}`.slice(0, 100), value: s.key
    })));
  }

  // 陪玩欄位：用代號／藝名／Discord 名稱直接搜尋在職陪玩，不必先打 @
  if (focused?.name === '陪玩') {
    const rows = db.prepare(`SELECT * FROM staff WHERE guild_id=? ORDER BY active DESC, name`)
      .all(orgOf(i.guildId));
    const label = s => {
      const m = i.guild?.members?.cache.get(s.user_id);
      const dc = m ? (m.displayName || m.user.username) : '';
      return [s.name || s.code, s.code && s.code !== s.name ? `(${s.code})` : '', dc ? `・${dc}` : '',
              s.active ? '' : '（已離職）'].filter(Boolean).join(' ').slice(0, 100);
    };
    const hit = rows.filter(s => {
      if (!q) return true;
      const m = i.guild?.members?.cache.get(s.user_id);
      return [s.name, s.code, s.user_id, m?.displayName, m?.user?.username]
        .some(x => String(x || '').toLowerCase().includes(q));
    }).slice(0, 25);
    // 沒綁 Discord 帳號的員工 user_id 不是數字，改回傳代號／藝名，findStaff 才對得到
    const value = s => (/^\d{15,25}$/.test(String(s.user_id || '')) ? s.user_id : (s.code || s.name || ''));
    return i.respond(hit.filter(s => value(s)).map(s => ({ name: label(s), value: value(s) })));
  }

  const list = G.listGifts(i.guildId)
    .filter(g => !q || g.name.toLowerCase().includes(q) || g.key.includes(q))
    .slice(0, 25)
    .map(g => ({ name: `${g.emoji} ${g.name}（${g.price} 雨幣）`, value: g.key }));
  await i.respond(list);
}

module.exports = { handlers, autocomplete };
