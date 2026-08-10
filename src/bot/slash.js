// Slash 指令處理
const { db, getCustomer, findStaff, getStaff, addCoins, refreshVip, audit, orgOf } = require('../db');
const M = require('../util/money');
const { checkoutMessage } = require('../util/checkout');
const { parseSlots } = require('../util/slots');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const G = require('../util/gifts');
const R = require('../util/reports');
const { isAdmin, isCS } = require('./perm');
const { helpEmbed } = require('../util/help');

const deny = i => i.reply({ embeds: [err(i.guildId, '你沒有使用這個指令的權限。')], ephemeral: true });

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
    const s = resolveStaff(i);
    const paid = i.options.getInteger('金額');
    const list = i.options.getInteger('原價') ?? paid;
    if (list < paid) return i.reply({ embeds: [err(i.guildId, '訂單原價不可小於客人實付金額。')], ephemeral: true });
    const item = i.options.getString('項目') || '陪玩服務';
    const { qty } = parseSlots(item);
    const o = M.createOrder({
      guildId: i.guildId, customerId: u.id, customerName: u.username,
      staffId: s.user_id, csId: i.user.id, csName: i.user.tag,
      item, qty, unitPrice: Math.round(paid / (qty || 1)),
      listPrice: list, amount: paid, source: 'ticket', operator: i.user.tag,
      payMethod: i.options.getString('支付方式') || '雨幣扣款',
      note: i.options.getString('備註') || ''
    });
    await i.reply(checkoutMessage(i.guildId, o));
  },

  async 身分組結帳(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('客人');
    const s = resolveStaff(i);
    const item = i.options.getString('項目');
    const unit = i.options.getInteger('單價');
    const qty = i.options.getInteger('數量') || 1;
    const amount = unit * qty;
    const o = M.createOrder({
      guildId: i.guildId, customerId: u.id, customerName: u.username,
      staffId: s.user_id, csId: i.user.id, csName: i.user.tag,
      kind: 'role', item, qty, unitPrice: unit, amount,
      source: 'ticket', status: 'settled', operator: i.user.tag,
      note: i.options.getString('備註') || ''
    });
    await i.reply({ embeds: [money(i.guildId, '💳 身分組結帳完成', `訂單編號 \`${o.order_no}\`（免核銷）`, [
      { name: '消費金主', value: mention(u.id), inline: true },
      { name: '服務陪玩', value: s.name || s.code, inline: true },
      { name: '項目', value: `${item} ×${qty}`, inline: true },
      { name: '客人實付', value: `${n(amount)} 雨幣`, inline: true },
      { name: '陪玩分潤', value: `${n(o.staff_share)}（已直接入可提領）`, inline: true },
      { name: '增加羈絆', value: `+${n(o.intimacy)}`, inline: true }
    ])] });
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
    const bal = addCoins(i.guildId, u.id, amt, reason, { operator: i.user.tag, name: u.username });
    await i.reply({ embeds: [ok(i.guildId, '儲值完成',
      `${mention(u.id)} +${n(amt)} 雨幣\n目前餘額：**${n(bal)}**\n原因：${reason}`)] });
  },

  async 扣款(i) {
    if (!isCS(i.member)) return deny(i);
    const u = i.options.getUser('對象');
    const amt = i.options.getInteger('金額');
    const reason = i.options.getString('原因') || '人工扣款';
    const bal = addCoins(i.guildId, u.id, -amt, reason, { operator: i.user.tag, name: u.username });
    await i.reply({ embeds: [ok(i.guildId, '扣款完成',
      `${mention(u.id)} -${n(amt)} 雨幣\n目前餘額：**${n(bal)}**\n原因：${reason}`)] });
  },

  async 提領(i) {
    if (!isAdmin(i.member)) return deny(i);
    const s = resolveStaff(i);
    const amt = i.options.getInteger('金額');
    M.payoutStaff(i.guildId, s.user_id, amt, i.user.tag, i.options.getString('備註') || '');
    const after = getStaff(i.guildId, s.user_id);
    await i.reply({ embeds: [money(i.guildId, '💸 薪資已發放', `**${s.name || s.code}**（${mention(s.user_id)}）`, [
      { name: '本次發放', value: `${n(amt)} 雨幣`, inline: true },
      { name: '剩餘可提領', value: n(after.income), inline: true },
      { name: '經辦', value: mention(i.user.id), inline: true }
    ])] });
  },

  async 退單(i) {
    if (!isAdmin(i.member)) return deny(i);
    const no = i.options.getString('訂單編號').trim().toUpperCase();
    const refundCoins = i.options.getBoolean('退還雨幣') ?? true;
    const reason = i.options.getString('原因') || '';
    const o = M.refundOrder(i.guildId, no, i.user.tag, reason, { refundCoins });
    await i.reply({ embeds: [ok(i.guildId, `訂單 ${o.order_no} 已撤銷`, null, [
      { name: '退還老闆', value: refundCoins ? `${n(o.amount)} 雨幣` : '未退幣', inline: true },
      { name: '扣回陪玩分潤', value: n(o.staff_share), inline: true },
      { name: '扣回羈絆', value: o.intimacy ? `-${n(o.intimacy)}` : '無', inline: true },
      { name: '原因', value: reason || '無註記' }
    ])] });
  },

  async 補單(i) {
    if (!isAdmin(i.member)) return deny(i);
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
    if (!isAdmin(i.member)) return deny(i);
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

  // ---------- 查詢與報表 ----------
  async 對帳(i) {
    if (!isCS(i.member)) return deny(i);
    const cust = i.options.getUser('客人');
    const staff = resolveStaff(i);
    const p = R.pairSpend(i.guildId, cust.id, staff.user_id);
    await i.reply({
      embeds: [money(i.guildId, '📒 對帳單', `${mention(cust.id)} ➜ **${staff.name || staff.code}**`, [
        { name: '點單消費', value: `${n(p.order_amount)} 雨幣 / ${p.order_count} 筆`, inline: true },
        { name: '禮物消費', value: `${n(p.gift_amount)} 雨幣 / ${p.gift_count} 份`, inline: true },
        { name: '合計', value: `**${n(p.total)}** 雨幣`, inline: false }
      ])]
    });
  },

  async 陪玩業績詳報(i) {
    if (!isCS(i.member)) return deny(i);
    const staff = resolveStaff(i);
    const d = R.staffDetail(i.guildId, staff.user_id, 10);
    const list = d.patrons.length
      ? d.patrons.map((p, idx) => `\`${String(idx + 1).padStart(2)}\` ${mention(p.customer_id)} — **${n(p.amount)}**（${p.cnt} 次）`).join('\n')
      : '目前還沒有金主紀錄。';
    await i.reply({
      embeds: [money(i.guildId, `📊 ${staff.name || staff.code} 業績詳報`, list, [
        { name: '本月業績', value: `${n(d.month)}（${d.month_count} 單）`, inline: true },
        { name: '歷史總業績', value: `${n(d.total)}（${d.total_count} 單）`, inline: true },
        { name: '禮物收入', value: n(d.gifts), inline: true },
        { name: '可提領', value: n(staff.income), inline: true },
        { name: '暫存薪水', value: n(staff.pending_income), inline: true }
      ])]
    });
  },

  // ---------- 互動與福利 ----------
  async 送禮(i) {
    if (!isCS(i.member)) return deny(i);
    const from = i.options.getUser('送禮人');
    const staff = resolveStaff(i, '對象');
    const r = G.sendGift({
      guildId: i.guildId, customerId: from.id, customerName: from.username,
      staffId: staff.user_id, giftKey: i.options.getString('禮物款式'),
      qty: i.options.getInteger('數量') || 1, operator: i.user.tag
    });
    await i.reply({
      embeds: [emb(i.guildId, {
        title: `${r.gift.emoji} 送禮成功！`,
        desc: `${mention(from.id)} 送給 **${staff.name || staff.code}** ${r.gift.name} ×${r.qty}`,
        color: COLOR.main,
        fields: [
          { name: '花費', value: `${n(r.amount)} 雨幣`, inline: true },
          { name: '親密度', value: `+${n(r.gain)}（雙倍）`, inline: true },
          { name: '目前羈絆', value: `${n(r.points)}・${r.rank.name}`, inline: true }
        ]
      })]
    });
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
    if (!isAdmin(i.member)) return deny(i);
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
    if (!isAdmin(i.member)) return deny(i);
    const u = i.options.getUser('老闆');
    const lv = i.options.getInteger('等級');
    const c = getCustomer(i.guildId, u.id, u.username);
    if (lv < 0) {
      db.prepare('UPDATE customers SET vip_locked = 0 WHERE id = ?').run(c.id);
      const auto = refreshVip(i.guildId, u.id);
      return i.reply({ embeds: [ok(i.guildId, '已解除鎖定', `${mention(u.id)} 改回自動計算，目前 VIP **${auto}**`)] });
    }
    db.prepare('UPDATE customers SET vip_level = ?, vip_locked = 1 WHERE id = ?').run(lv, c.id);
    audit(i.user.tag, '設定 VIP', `${u.id} → ${lv}`, i.guildId);
    await i.reply({ embeds: [ok(i.guildId, 'VIP 等級已設定', `${mention(u.id)} → **VIP ${lv}**（已鎖定，不再自動升降）`)] });
  },

  async 背包查詢(i) {
    const u = i.options.getUser('客人') || i.user;
    if (u.id !== i.user.id && !isCS(i.member)) return deny(i);
    const c = getCustomer(i.guildId, u.id, u.username);
    const items = G.listBackpack(i.guildId, u.id);
    const coupons = items.filter(x => x.value > 0);
    const others = items.filter(x => !x.value);
    await i.reply({
      embeds: [emb(i.guildId, {
        title: '🎒 專屬背包',
        desc: mention(u.id),
        fields: [
          { name: '雨幣餘額', value: n(c.coins), inline: true },
          { name: 'VIP 等級', value: `Lv.${c.vip_level}`, inline: true },
          { name: '地盤步數', value: `${c.territory} / 21`, inline: true },
          { name: '折價券', value: coupons.length ? coupons.map(x => `${x.name}（面額 ${n(x.value)}）×${x.qty}${x.expires ? ` 期限 ${x.expires}` : ''}`).join('\n') : '無' },
          { name: '其他道具', value: others.length ? others.map(x => `${x.name} ×${x.qty}`).join('、') : '無' }
        ]
      })]
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
  async 入職(i) {
    if (!isAdmin(i.member)) return deny(i);
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
      embeds: [ok(i.guildId, '錄取成功 🎉',
        `${mention(u.id)} 已加入公司名單`, [
          { name: '代號', value: code, inline: true },
          { name: '藝名', value: name, inline: true },
          { name: '職務', value: kind === 'cs' ? '客服' : '陪玩', inline: true },
          { name: '影音名片', value: url || '（未綁定）' }
        ])]
    });
  }
};

// 送禮款式自動完成
async function autocomplete(i) {
  const q = (i.options.getFocused() || '').toLowerCase();
  const list = G.listGifts(i.guildId)
    .filter(g => !q || g.name.toLowerCase().includes(q) || g.key.includes(q))
    .slice(0, 25)
    .map(g => ({ name: `${g.emoji} ${g.name}（${g.price} 雨幣）`, value: g.key }));
  await i.respond(list);
}

module.exports = { handlers, autocomplete };
