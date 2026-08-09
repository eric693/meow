// Slash 指令處理
const { db, getCustomer, findStaff, refreshVip, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const G = require('../util/gifts');
const R = require('../util/reports');
const { isAdmin, isCS } = require('./perm');

const deny = i => i.reply({ embeds: [err(i.guildId, '你沒有使用這個指令的權限。')], ephemeral: true });

// 「陪玩」參數可填代號／藝名／@提及
function resolveStaff(i, key = '陪玩') {
  const raw = i.options.getString(key);
  const s = findStaff(i.guildId, raw);
  if (!s) throw new Error(`查無陪玩「${raw}」，請確認代號或藝名（可用 /入職 建檔）`);
  return s;
}

const handlers = {
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
