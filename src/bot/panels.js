// 面板建置（!sendrole / !sendorder / !setup-*）與其按鈕、表單互動
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
  ModalBuilder, TextInputBuilder, TextInputStyle
} = require('discord.js');
const { db, getSetting, getCustomer, findStaff, getStaff, now, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const M = require('../util/money');
const G = require('../util/gifts');
const { isAdmin, isCS } = require('./perm');

const btn = (id, label, style = ButtonStyle.Primary, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const row = (...c) => new ActionRowBuilder().addComponents(...c);
const input = (id, label, { style = TextInputStyle.Short, required = true, ph = '', value = '' } = {}) =>
  row(new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style)
    .setRequired(required).setPlaceholder(ph).setValue(value));

const adminOnly = msg => { if (!isAdmin(msg.member)) throw new Error('面板建置僅限管理員使用。'); };
const post = async (msg, payload) => {
  await msg.channel.send(payload);
  if (msg.deletable) await msg.delete().catch(() => {});
};

// ---------------- 面板建置指令 ----------------
const commands = {
  async sendrole(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, {
        title: '🎭 身分組領取',
        desc: '點下方按鈕領取／取消你的身分組。\n\n**老闆**：可下單、看金主專區\n**雨滴**：接收開單與活動通知'
      })],
      components: [row(
        btn('role:boss', '我是老闆', ButtonStyle.Success, '👑'),
        btn('role:drop', '雨滴通知', ButtonStyle.Secondary, '💧')
      )]
    });
  },

  async sendorder(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, {
        title: '☔ 喚雨下單前提醒',
        desc: [
          '**1. 儲值** — 先向客服儲值雨幣，餘額可用 `!消費查詢` 查看。',
          '**2. 選人** — 到陪玩名片區挑選喜歡的陪玩師，記下代號。',
          '**3. 下單** — 到「開始下單」面板開單，客服會為你安排。',
          '**4. 核銷** — 服務結束後由客服核銷，陪玩才會入帳。',
          '',
          '⚠️ 禁止私下交易、辱罵、騷擾陪玩，違者永久黑名單且不退款。',
          '⚠️ 退單需在服務開始前提出，服務中恕不退費。'
        ].join('\n')
      })]
    });
  },

  async 'setup-ticket'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '🎫 派單接待大廳', desc: '點擊下方按鈕開啟你的專屬下單頻道，客服將盡快為你服務。' })],
      components: [row(btn('ticket:order', '開始下單', ButtonStyle.Success, '🛒'))]
    });
  },

  async 'setup-report'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '📝 自主報單系統', desc: '陪玩／客服完成服務後於此回報訂單，系統自動扣款並計算分潤。' })],
      components: [row(btn('report:self', '我要報單', ButtonStyle.Primary, '📝'))]
    });
  },

  async 'setup-report-cross'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '🌐 跨伺服器報單系統 1 號', desc: '外服合作單請由此回報。' })],
      components: [row(btn('report:cross', '跨服報單', ButtonStyle.Primary, '🌐'))]
    });
  },

  async 'setup-report-cross-2'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '🎤 唱歌單跨服報單', desc: '唱歌類跨服訂單請由此回報。' })],
      components: [row(btn('report:cross2', '唱歌跨服報單', ButtonStyle.Primary, '🎤'))]
    });
  },

  async 'setup-exam'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '📋 陪玩考核報名', desc: '想加入喚雨？點下方按鈕填寫報名表，系統會為你建立專屬考場。' })],
      components: [row(btn('exam:start', '開始考核', ButtonStyle.Success, '📋'))]
    });
  },

  async 'setup-bank'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '🏦 地下金庫', desc: '點擊查詢你目前的雨幣餘額、VIP 等級與消費紀錄（僅你自己看得到）。' })],
      components: [row(btn('bank:me', '查詢餘額', ButtonStyle.Primary, '🪙'))]
    });
  },

  async 'setup-intimacy'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '💞 愛戀藏館', desc: '查詢你與陪玩師之間的羈絆點數與特權進度。' })],
      components: [row(btn('intimacy:query', '查詢羈絆', ButtonStyle.Primary, '💞'))]
    });
  },

  async 'setup-suggestion'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '📮 意見投訴與建議箱', desc: '任何建議或申訴都歡迎提出，內容只有管理層看得到。' })],
      components: [row(btn('sug:public', '我要投稿', ButtonStyle.Secondary, '📮'))]
    });
  },

  async 'setup-staff-suggestion'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, { title: '🧑‍💼 員工輔導室', desc: '員工專屬管道，內容將直送專屬後台，保密處理。' })],
      components: [row(btn('sug:staff', '員工投稿', ButtonStyle.Secondary, '🧑‍💼'))]
    });
  }
};

// ---------------- 互動處理 ----------------
const eph = (i, e) => i.reply({ embeds: [e], ephemeral: true });

async function sendToChannel(guild, settingKey, payload) {
  const id = getSetting(settingKey, '', guild.id);
  if (!id) return false;
  const ch = await guild.channels.fetch(id).catch(() => null);
  if (!ch) return false;
  await ch.send(payload);
  return true;
}

async function createPrivateChannel(guild, member, { prefix, categoryKey, extraRoleKeys = [] }) {
  const parent = getSetting(categoryKey, '', guild.id) || null;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    { id: member.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages,
                             PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles] }
  ];
  for (const key of extraRoleKeys) {
    for (const rid of getSetting(key, '', guild.id).split(',').map(s => s.trim()).filter(Boolean)) {
      overwrites.push({ id: rid, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages,
                                         PermissionsBitField.Flags.ReadMessageHistory] });
    }
  }
  return guild.channels.create({
    name: `${prefix}-${member.user.username}`.slice(0, 90).toLowerCase(),
    type: ChannelType.GuildText,
    parent: parent || undefined,
    permissionOverwrites: overwrites
  });
}

const REPORT_LABEL = { self: '自主報單', cross: '跨服報單 1 號', cross2: '唱歌單跨服報單' };

function reportModal(kind) {
  return new ModalBuilder().setCustomId(`reportm:${kind}`).setTitle(REPORT_LABEL[kind])
    .addComponents(
      input('customer', '老闆 Discord ID', { ph: '例：123456789012345678' }),
      input('staff', '陪玩代號／藝名', { ph: '例：小雨 或 R01' }),
      input('item', '服務項目', { ph: '例：英雄聯盟 / 唱歌 / 聊天' }),
      input('qty', '數量（時數或局數）', { ph: '例：2' }),
      input('price', '單價（雨幣）', { ph: '例：300' })
    );
}

async function handleInteraction(i) {
  if (i.isAutocomplete()) return;
  const id = i.customId || '';

  // ---- 身分組領取 ----
  if (id.startsWith('role:')) {
    const key = id === 'role:boss' ? 'role_boss' : 'role_drop';
    const rid = getSetting(key, '', i.guildId);
    if (!rid) return eph(i, err(i.guildId, '管理員尚未在後台設定這個身分組。'));
    const has = i.member.roles.cache.has(rid);
    await (has ? i.member.roles.remove(rid) : i.member.roles.add(rid));
    return eph(i, ok(i.guildId, has ? '已取消身分組' : '已領取身分組', `<@&${rid}>`));
  }

  // ---- 地下金庫 ----
  if (id === 'bank:me') {
    const R = require('../util/reports');
    const s = R.customerSpend(i.guildId, i.user.id);
    getCustomer(i.guildId, i.user.id, i.user.username);
    return eph(i, money(i.guildId, '🏦 你的地下金庫', null, [
      { name: '雨幣餘額', value: n(s.coins), inline: true },
      { name: 'VIP 等級', value: `Lv.${s.vip_level}`, inline: true },
      { name: '歷史消費', value: n(s.total_spend), inline: true },
      { name: '本月消費', value: `${n(s.month)}（${s.month_count} 單）`, inline: true },
      { name: '禮物累計', value: n(s.gift_total), inline: true }
    ]));
  }

  // ---- 愛戀查詢 ----
  if (id === 'intimacy:query') {
    return i.showModal(new ModalBuilder().setCustomId('intimacym').setTitle('愛戀藏館查詢')
      .addComponents(input('staff', '陪玩代號／藝名', { ph: '例：小雨' })));
  }
  if (id === 'intimacym') {
    const s = findStaff(i.guildId, i.fields.getTextInputValue('staff'));
    if (!s) return eph(i, err(i.guildId, '查無這位陪玩師。'));
    const pts = G.getIntimacy(i.guildId, i.user.id, s.user_id);
    const rank = G.rankOf(pts);
    return eph(i, emb(i.guildId, {
      title: '💞 愛戀藏館',
      desc: `你 ❤ **${s.name || s.code}**`,
      fields: [
        { name: '羈絆點數', value: n(pts), inline: true },
        { name: '目前階級', value: rank.name, inline: true },
        { name: '下一階', value: rank.next ? `${rank.next.name}（還差 ${n(rank.next.need)}）` : '已達最高階 🎉', inline: true }
      ]
    }));
  }

  // ---- 報單 ----
  if (id.startsWith('report:')) {
    const kind = id.split(':')[1];
    if (!isCS(i.member) && !getStaff(i.guildId, i.user.id))
      return eph(i, err(i.guildId, '只有在職員工可以報單。'));
    return i.showModal(reportModal(kind));
  }
  if (id.startsWith('reportm:')) {
    const kind = id.split(':')[1];
    const f = k => i.fields.getTextInputValue(k).trim();
    const customerId = (f('customer').match(/\d{15,25}/) || [])[0];
    if (!customerId) return eph(i, err(i.guildId, '老闆 Discord ID 格式不正確。'));
    const staff = findStaff(i.guildId, f('staff'));
    if (!staff) return eph(i, err(i.guildId, `查無陪玩「${f('staff')}」`));
    const qty = Number(f('qty')), price = Number(f('price'));
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return eph(i, err(i.guildId, '數量與單價必須是數字。'));

    let o;
    try {
      o = M.createOrder({
        guildId: i.guildId, customerId, staffId: staff.user_id,
        csId: isCS(i.member) ? i.user.id : '', item: f('item'), qty, unitPrice: price,
        source: kind, operator: i.user.tag
      });
    } catch (e) { return eph(i, err(i.guildId, e.message)); }

    const body = money(i.guildId, `🧾 ${REPORT_LABEL[kind]}成立`, `訂單編號 \`${o.order_no}\``, [
      { name: '老闆', value: mention(customerId), inline: true },
      { name: '陪玩', value: `${staff.name || staff.code}`, inline: true },
      { name: '項目', value: `${o.item} ×${o.qty}`, inline: true },
      { name: '金額', value: `${n(o.amount)} 雨幣`, inline: true },
      { name: '陪玩分潤', value: `${n(o.staff_share)}（暫存）`, inline: true },
      { name: '狀態', value: '🕗 待核銷', inline: true }
    ]);
    await sendToChannel(i.guild, 'channel_order_log', { embeds: [body] });
    return eph(i, body);
  }

  // ---- 下單傳票 ----
  if (id === 'ticket:order') {
    const exist = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND kind='order' AND status!='closed'")
      .get(orgOf(i.guildId), i.user.id);
    if (exist && exist.channel_id) {
      const ch = await i.guild.channels.fetch(exist.channel_id).catch(() => null);
      if (ch) return eph(i, err(i.guildId, `你已經有一個進行中的下單頻道：${ch}`));
    }
    await i.deferReply({ ephemeral: true });
    const ch = await createPrivateChannel(i.guild, i.member,
      { prefix: '下單', categoryKey: 'category_ticket', extraRoleKeys: ['role_cs', 'role_admin'] });
    const info = db.prepare("INSERT INTO tickets (guild_id, src_guild, channel_id, customer_id, kind, subject) VALUES (?,?,?,?,'order','下單')")
      .run(orgOf(i.guildId), i.guildId, ch.id, i.user.id);
    await ch.send({
      content: `${mention(i.user.id)} 歡迎光臨！`,
      embeds: [emb(i.guildId, {
        title: '🛒 下單接待中',
        desc: '請告訴我們：\n1️⃣ 想指定的陪玩代號\n2️⃣ 服務項目與時數\n\n客服看到後會點「接單」為你服務。'
      })],
      components: [row(
        btn(`ticket:claim:${info.lastInsertRowid}`, '客服接單', ButtonStyle.Success, '🙋'),
        btn(`ticket:close:${info.lastInsertRowid}`, '關閉頻道', ButtonStyle.Danger, '🔒')
      )]
    });
    return i.editReply({ embeds: [ok(i.guildId, '已開啟下單頻道', `${ch}`)] });
  }

  if (id.startsWith('ticket:claim:')) {
    if (!isCS(i.member)) return eph(i, err(i.guildId, '只有客服可以接單。'));
    const tid = Number(id.split(':')[2]);
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(tid);
    if (!t) return eph(i, err(i.guildId, '查無此傳票。'));
    if (t.cs_id) return eph(i, err(i.guildId, `這張單已由 <@${t.cs_id}> 接走。`));
    db.prepare("UPDATE tickets SET cs_id=?, status='claimed', claimed_at=? WHERE id=?").run(i.user.id, now(), tid);
    db.prepare('INSERT INTO cs_stats (guild_id, cs_id, ticket_id) VALUES (?,?,?)').run(orgOf(i.guildId), i.user.id, tid);
    return i.reply({ embeds: [ok(i.guildId, '客服已接單', `本單由 ${mention(i.user.id)} 為你服務 💜`)] });
  }

  if (id.startsWith('ticket:close:')) {
    const tid = Number(id.split(':')[2]);
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(tid);
    if (!t) return eph(i, err(i.guildId, '查無此傳票。'));
    if (t.customer_id !== i.user.id && !isCS(i.member))
      return eph(i, err(i.guildId, '只有開單者或客服可以關閉。'));
    db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(now(), tid);
    await i.reply({ embeds: [ok(i.guildId, '頻道將於 5 秒後關閉', '感謝你的支持 💜')] });
    setTimeout(() => i.channel.delete().catch(() => {}), 5000);
    return;
  }

  // ---- 考核 ----
  if (id === 'exam:start') {
    return i.showModal(new ModalBuilder().setCustomId('exammodal').setTitle('陪玩考核報名表')
      .addComponents(
        input('nickname', '想使用的藝名'),
        input('age', '年齡'),
        input('skills', '擅長項目', { ph: '例：英雄聯盟、唱歌、聊天' }),
        input('contact', '聯絡方式／可上線時段', { style: TextInputStyle.Paragraph })
      ));
  }
  if (id === 'exammodal') {
    await i.deferReply({ ephemeral: true });
    const f = k => i.fields.getTextInputValue(k).trim();
    const ch = await createPrivateChannel(i.guild, i.member,
      { prefix: '考場', categoryKey: 'category_exam', extraRoleKeys: ['role_admin', 'role_cs'] });
    db.prepare(`INSERT INTO exams (guild_id, src_guild, user_id, nickname, age, skills, contact, channel_id)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(orgOf(i.guildId), i.guildId, i.user.id, f('nickname'), f('age'), f('skills'), f('contact'), ch.id);
    await ch.send({
      content: mention(i.user.id),
      embeds: [emb(i.guildId, {
        title: '📋 考核報名表',
        fields: [
          { name: '藝名', value: f('nickname'), inline: true },
          { name: '年齡', value: f('age'), inline: true },
          { name: '擅長項目', value: f('skills') },
          { name: '聯絡方式／時段', value: f('contact') }
        ]
      })]
    });
    return i.editReply({ embeds: [ok(i.guildId, '報名成功', `專屬考場已建立：${ch}`)] });
  }

  // ---- 意見箱 ----
  if (id.startsWith('sug:')) {
    const kind = id.split(':')[1];
    return i.showModal(new ModalBuilder().setCustomId(`sugm:${kind}`)
      .setTitle(kind === 'staff' ? '員工輔導室' : '意見投訴與建議箱')
      .addComponents(input('content', '內容', { style: TextInputStyle.Paragraph, ph: '請詳細描述…' })));
  }
  if (id.startsWith('sugm:')) {
    const kind = id.split(':')[1];
    const content = i.fields.getTextInputValue('content').trim();
    db.prepare('INSERT INTO suggestions (guild_id, user_id, kind, content) VALUES (?,?,?,?)')
      .run(orgOf(i.guildId), i.user.id, kind, content);
    const sent = await sendToChannel(i.guild, kind === 'staff' ? 'channel_staff_box' : 'channel_suggestion', {
      embeds: [emb(i.guildId, {
        title: kind === 'staff' ? '🧑‍💼 員工輔導室來信' : '📮 新的意見投稿',
        desc: content,
        color: COLOR.warn,
        footer: `來自 ${i.user.tag}`
      })]
    });
    return eph(i, ok(i.guildId, '已送出', sent ? '管理層會盡快處理，謝謝你的回饋 💜'
      : '已記錄到後台（管理員尚未設定接收頻道）。'));
  }

  // ---- 投票 ----
  if (id.startsWith('poll:')) {
    const pid = Number(id.split(':')[1]);
    const choice = Number(i.values[0]);
    db.prepare(`INSERT INTO poll_votes (poll_id, user_id, choice) VALUES (?,?,?)
                ON CONFLICT(poll_id, user_id) DO UPDATE SET choice = excluded.choice`).run(pid, i.user.id, choice);
    const p = db.prepare('SELECT * FROM polls WHERE id=?').get(pid);
    const opts = JSON.parse(p.options);
    const counts = db.prepare('SELECT choice, COUNT(*) c FROM poll_votes WHERE poll_id=? GROUP BY choice').all(pid);
    const total = counts.reduce((a, b) => a + b.c, 0);
    const map = Object.fromEntries(counts.map(c => [c.choice, c.c]));
    const bar = opts.map((o, idx) => {
      const c = map[idx] || 0, pct = total ? Math.round(c / total * 100) : 0;
      return `${idx + 1}. ${o}\n\`${'█'.repeat(Math.round(pct / 5)).padEnd(20, '░')}\` ${pct}%（${c}）`;
    }).join('\n');
    await i.message.edit({ embeds: [emb(i.guildId, { title: '🗳️ ' + p.title, desc: `${bar}\n\n共 ${total} 票・匿名投票` })] })
      .catch(() => {});
    return eph(i, ok(i.guildId, '已投票', `你選擇了「${opts[choice]}」（可重新選擇覆蓋）`));
  }
}

module.exports = { commands, handleInteraction };
