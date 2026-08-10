// 面板建置（!sendrole / !sendorder / !setup-*）與其按鈕、表單互動
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const { db, getSetting, getCustomer, findStaff, getStaff, now, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const M = require('../util/money');
const G = require('../util/gifts');
const { checkoutMessage } = require('../util/checkout');
const { parseSlots } = require('../util/slots');
const S = require('../util/session');
const CF = require('../util/checkout-flow');
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

  async 'setup-identity'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, {
        title: '《喚雨電競》身份大廳 🏡☔',
        desc: [
          'ฅ^•ﻌ•^ฅ 歡迎來到喚雨！',
          '',
          '這裡不是普通的陪玩店，',
          '而是一間能讓旅人暫時歇息的 **小小民宿** 🏡💙',
          '',
          '🐾 民宿裡住著一群可愛的貓貓，',
          '等待與每位旅人相遇 ( ˶ˆ꒳ˆ˵ )♡',
          '',
          '**請先選擇你的身份** ✨',
          '',
          '🧳 **旅人**',
          '帶著故事而來，希望遇見陪伴自己的貓貓 ☔',
          '',
          '🐈 **寄宿貓貓**',
          '用溫暖、陪伴與歡笑，迎接每一位旅人 ♡',
          '',
          '🌧️ 點擊下方按鈕完成入住吧！',
          '',
          '╭────────────╮',
          '☔ 願所有相遇，都剛剛好。',
          '🏡 願每位旅人，都有貓貓陪伴。',
          '🐈 願每隻貓貓，都能找到自己的旅人。',
          '╰────────────╯'
        ].join('\n')
      })],
      components: [row(
        btn('role:traveler', '旅人', ButtonStyle.Primary, '🧳'),
        btn('role:cat', '寄宿貓貓', ButtonStyle.Success, '🐈')
      )]
    });
  },

  async sendorder(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, {
        title: '☔ 喚雨下單前提醒',
        desc: [
          '**⚠️ 下單前請先確認**',
          '',
          '• 請依照選單完成服務類型、性別、需求與加購選項',
          '• 本店服務預設為 1 陪 1',
          '• 若需要 1 陪多，請務必提前告知客服，並由客服確認是否可安排',
          '• 若需指定稱呼、甜蜜單、聲優，請在加購選項中勾選',
          '• 若有特殊需求，請在備註欄補充，實際安排以客服確認為準',
          '',
          '**⚠️ 訂單流程提醒**',
          '',
          '送出訂單後，請依照客服指示完成確認與後續流程。',
          '若客服通知後 15 分鐘內未回覆、未補資料或未完成指定流程，將視同棄單。',
          '',
          '本表單僅作為下單資料建立，不代表訂單已完成付款或排單。',
          '送出訂單後，請等待客服確認價格、時段與可接單人員。',
          '',
          '**🤍 喚雨提醒**',
          '',
          '請勿重複送單、惡意測試表單或使用不實資料。',
          '若因資料錯誤、未即時回覆或未完成流程導致安排延誤，需由下單者自行負責。',
          '',
          '**點擊下方按鈕開始下單。**'
        ].join('\n')
      })],
      components: [row(btn('order:start', '我已閱讀，開始下單', ButtonStyle.Success, '🪄'))]
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
      embeds: [emb(msg.guild.id, { title: '📝 喚雨｜自主報單系統', desc: '成員您好！請點擊下方按鈕開始填寫你的名稱。' })],
      components: [row(btn('report:self', '我要報單', ButtonStyle.Primary, '📄'))]
    });
  },

  async 'setup-checkout'(msg) {
    adminOnly(msg);
    await post(msg, {
      embeds: [emb(msg.guild.id, {
        title: '🧾 喚雨｜客服結帳台',
        desc: '客服完成服務後於此結帳：系統會扣老闆雨幣、發出結帳明細，並產生供陪玩報單的訂單編號。'
      })],
      components: [row(btn('checkout:start', '我要結帳', ButtonStyle.Success, '🧾'))]
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
      embeds: [emb(msg.guild.id, {
        title: '🤝 喚雨｜員工輔導室',
        desc: '接收任何關於喚雨員工的專屬建議、投訴與問題。\n\n我們會絕對保密內容，僅後台管理可見！'
      })],
      components: [row(btn('sug:staff', '填寫問題', ButtonStyle.Primary, '📝'))]
    });
  }
};

// ---------------- 互動處理 ----------------
const eph = (i, e) => i.reply({ embeds: [e], ephemeral: true });
// 面板的權限阻擋同樣標記起來，讓 index.js 記成 deny
const denyEph = (i, message) => { i._denied = true; return eph(i, err(i.guildId, message)); };

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

// 下單選單的選項，皆可用後台設定覆蓋（逗號分隔）
const DEFAULT_GENDERS = ['女生陪玩', '男生陪玩', '都可以'];
const DEFAULT_SERVICES = ['英雄聯盟', '傳說對決', 'VALORANT', '唱歌', '聊天', '其他'];
const DEFAULT_ADDONS = ['指定稱呼', '甜蜜單', '聲優'];

const optionList = (guildId, key, fallback) => {
  const arr = getSetting(key, '', guildId).split(',').map(x => x.trim()).filter(Boolean);
  return (arr.length ? arr : fallback).slice(0, 25);
};
const selectRow = (customId, placeholder, values, maxValues = 1) =>
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder)
      .setMinValues(1).setMaxValues(Math.min(maxValues, values.length))
      .addOptions(values.map(v => ({ label: v.slice(0, 100), value: v.slice(0, 100) }))));

// 自主報單＝認領主群已結帳的訂單（金流已在結帳時完成，這裡只留服務紀錄與截圖）
function reportModal(kind) {
  const m = new ModalBuilder().setCustomId(`reportm:${kind}`).setTitle(REPORT_LABEL[kind]);
  if (kind === 'self') {
    return m.addComponents(
      input('order_no', '訂單編號', { ph: '例：ORD-63876816（結帳時客服提供）' }),
      input('boss_dc', '老闆 dc', { ph: '例：tsuki_.32' }),
      input('customer', '老闆 id', { ph: '例：123456789012345678' }),
      input('staff', '陪玩 id', { ph: '例：一坨羊毛毛#0712 或 R01' }),
      input('slots', '報單場次／小時', { ph: '例：娛樂4場' })
    );
  }
  // 跨服單沒有主群結帳流程，報單當下才建帳
  return m.addComponents(
    input('boss_dc', '老闆 dc', { ph: '例：tsuki_.32' }),
    input('customer', '老闆 id', { ph: '例：123456789012345678' }),
    input('staff', '陪玩 id', { ph: '例：一坨羊毛毛#0712 或 R01' }),
    input('slots', '報單場次／小時', { ph: '例：娛樂4場' }),
    input('price', '單價（雨幣）', { ph: '例：300' })
  );
}

/** 這個人是否已經有進行中的下單頻道；有的話回傳頻道 ID */
function openOrderTicket(i) {
  const t = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND customer_id=? AND kind='order' AND status!='closed'")
    .get(orgOf(i.guildId), i.user.id);
  if (!t || !t.channel_id) return null;
  return i.guild.channels.cache.has(t.channel_id) ? t.channel_id : null;
}

async function handleInteraction(i) {
  if (i.isAutocomplete()) return;
  const id = i.customId || '';

  // ---- 身分組領取 ----
  if (id.startsWith('role:')) {
    // 身分大廳的「旅人／寄宿貓貓」與舊的「老闆／雨滴」共用同一套領取邏輯
    const ROLE_KEY = { 'role:boss': 'role_boss', 'role:traveler': 'role_boss',
                       'role:cat': 'role_player', 'role:drop': 'role_drop' };
    const key = ROLE_KEY[id] || 'role_drop';
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
  const canReport = () => isCS(i.member) || getStaff(i.guildId, i.user.id);

  // 自主報單：先問名稱 → 建立個人報單頻道 → 在頻道內填寫明細
  if (id === 'report:self') {
    if (!canReport()) return denyEph(i, '只有在職員工可以報單。');
    return i.showModal(new ModalBuilder().setCustomId('reportch').setTitle('自主報單系統')
      .addComponents(input('name', '你的名稱', { ph: '例：羊毛毛' })));
  }
  if (id === 'reportch') {
    await i.deferReply({ ephemeral: true });
    const name = i.fields.getTextInputValue('name').trim();
    const ch = await createPrivateChannel(i.guild, i.member,
      { prefix: name, categoryKey: 'category_report', extraRoleKeys: ['role_cs', 'role_admin'] });
    await ch.setName(`${name}報單`.slice(0, 90)).catch(() => {});
    await ch.send({
      content: mention(i.user.id),
      embeds: [emb(i.guildId, { title: '📄 報單頻道', desc: '請點擊下方按鈕填寫報單明細，送出後於本頻道補上對局截圖。' })],
      components: [row(btn('reportform:self', '填寫報單明細', ButtonStyle.Primary, '📄'))]
    });
    return i.editReply({ embeds: [ok(i.guildId, '報單頻道已建立', `請前往填寫詳細內容：${ch}`)] });
  }

  // 跨服報單／頻道內的填寫按鈕，都直接開表單
  if (id.startsWith('report:') || id.startsWith('reportform:')) {
    const kind = id.split(':')[1];
    if (!canReport()) return denyEph(i, '只有在職員工可以報單。');
    return i.showModal(reportModal(kind));
  }
  if (id.startsWith('reportm:')) {
    const kind = id.split(':')[1];
    const f = k => i.fields.getTextInputValue(k).trim();
    const customerId = (f('customer').match(/\d{15,25}/) || [])[0];
    if (!customerId) return eph(i, err(i.guildId, '老闆 id 格式不正確（需為 Discord 數字 ID）。'));
    const staff = findStaff(i.guildId, f('staff'));
    if (!staff) return eph(i, err(i.guildId, `查無陪玩「${f('staff')}」`));
    const { item, qty } = parseSlots(f('slots'));

    let o;
    try {
      if (kind === 'self') {
        // 認領主群結帳產生的訂單，不重複扣款
        const exist = M.getOrder(i.guildId, f('order_no'));
        if (exist && exist.staff_id !== staff.user_id)
          return eph(i, err(i.guildId,
            `訂單 ${exist.order_no} 的服務陪玩是 <@${exist.staff_id}>，與你填寫的「${f('staff')}」不符，請向客服確認。`));
        if (exist && exist.customer_id !== customerId)
          return eph(i, err(i.guildId,
            `訂單 ${exist.order_no} 的消費金主是 <@${exist.customer_id}>，與你填寫的老闆 id 不符，請向客服確認。`));
        o = M.reportOrder(i.guildId, f('order_no'), { reporterId: i.user.id, item, qty });
      } else {
        const price = Number(f('price'));
        if (!Number.isFinite(qty) || !Number.isFinite(price))
          return eph(i, err(i.guildId, '場次與單價必須含數字。'));
        o = M.createOrder({
          guildId: i.guildId, customerId, customerName: f('boss_dc'), staffId: staff.user_id,
          csId: isCS(i.member) ? i.user.id : '', item, qty, unitPrice: price,
          source: kind, operator: i.user.tag
        });
      }
    } catch (e) { return eph(i, err(i.guildId, e.message)); }

    const body = emb(i.guildId, {
      title: '📄 報單明細',
      desc: [
        `訂單編號：\`${o.order_no}\``,
        `老闆dc：${f('boss_dc')}`,
        `老闆id：${customerId}`,
        `陪玩id：${staff.name || staff.code}`,
        `報單場次/小時：${f('slots')}`,
        '',
        '*(請在下方補充對局截圖)*'
      ].join('\n')
    });
    const csRole = getSetting('role_cs', '', i.guildId);
    const content = [mention(staff.user_id), csRole ? `<@&${csRole}>` : '', '您的報單已產生：']
      .filter(Boolean).join(' ');
    await sendToChannel(i.guild, 'channel_order_log', { content, embeds: [body] });
    return i.reply({ content, embeds: [body] });
  }

  // ---- 客服結帳 ----
  if (id === 'checkout:start') {
    if (!isCS(i.member)) return denyEph(i, '只有客服／管理員可以結帳。');
    return i.showModal(new ModalBuilder().setCustomId('checkoutm').setTitle('本次結帳明細')
      .addComponents(
        input('customer', '老闆 id', { ph: '例：123456789012345678' }),
        input('staff', '陪玩 id', { ph: '例：lumi 或 R01' }),
        input('slots', '服務項目／場次·小時', { ph: '例：娛樂4場' }),
        input('list', '訂單原價（雨幣）', { ph: '例：2000' }),
        input('discount', '手動/背包券折抵', { required: false, ph: '沒有折抵請留空或填 0' })
      ));
  }
  if (id === 'checkoutm') {
    const f = k => i.fields.getTextInputValue(k).trim();
    const customerId = (f('customer').match(/\d{15,25}/) || [])[0];
    if (!customerId) return eph(i, err(i.guildId, '老闆 id 格式不正確（需為 Discord 數字 ID）。'));
    const staff = findStaff(i.guildId, f('staff'));
    if (!staff) return eph(i, err(i.guildId, `查無陪玩「${f('staff')}」`));
    const list = Number(f('list'));
    const discount = Number(f('discount') || 0);
    if (!Number.isFinite(list) || !Number.isFinite(discount))
      return eph(i, err(i.guildId, '訂單原價與折抵必須是數字。'));
    if (discount > list) return eph(i, err(i.guildId, '折抵金額不可大於訂單原價。'));
    const { item, qty } = parseSlots(f('slots'));

    let o;
    try {
      o = M.createOrder({
        guildId: i.guildId, customerId, staffId: staff.user_id,
        csId: i.user.id, csName: i.user.tag, item, qty,
        unitPrice: qty ? Math.round((list - discount) / qty) : list - discount,
        listPrice: list, amount: list - discount,
        source: 'ticket', operator: i.user.tag, payMethod: '雨幣扣款'
      });
    } catch (e) { return eph(i, err(i.guildId, e.message)); }

    await i.channel.send(checkoutMessage(i.guildId, o));
    return eph(i, ok(i.guildId, '結帳完成', `訂單編號 \`${o.order_no}\`，已扣款並通知老闆。`));
  }

  // ---- 互動式結帳（選券 → 預覽 → 付款方式）----
  if (id.startsWith('co:')) {
    if (!isCS(i.member)) return denyEph(i, '只有客服／管理員可以結帳。');
    const [, act, sid, pay] = id.split(':');
    const sess = S.get(sid);
    if (!sess) return eph(i, err(i.guildId, '這筆結帳已逾時（超過 15 分鐘），請重新執行 /結帳。'));

    if (act === 'pick') {
      const picked = i.values[0];
      S.update(sid, { couponKey: picked === 'none' ? '' : picked });
      return i.update(CF.preview(sid, S.get(sid)));
    }
    if (act === 'cancel') {
      S.drop(sid);
      return i.update({ embeds: [ok(i.guildId, '已取消結帳', '沒有建立任何訂單，折價券也未扣除。')], components: [] });
    }
    if (act === 'pay') {
      let r;
      try { r = CF.finish(sid, pay); }
      catch (e) { return i.update({ embeds: [err(i.guildId, e.message)], components: [] }); }
      await i.update({
        content: `✅ 結帳建檔完成！（方式：${r.cash ? '💸 現金 / 轉帳' : '🪙 雨幣扣款'}）\n`
               + '**[客服專屬機密]** 帳務紀錄已同步至資料庫：',
        embeds: [r.detail], components: []
      });
      return i.channel.send(r.message);
    }
  }

  // ---- 點單系統（面板 → 性別 → 服務類型 → 加購 → 備註 → 專屬頻道）----
  if (id === 'order:start') {
    const open = openOrderTicket(i);
    if (open) return eph(i, err(i.guildId, `你已經有一個進行中的下單頻道：<#${open}>`));
    const sid = S.put({ guildId: i.guildId, userId: i.user.id });
    return i.reply({
      embeds: [emb(i.guildId, { title: '🪄 開始下單（1/4）', desc: '請選擇您偏好的性別：' })],
      components: [selectRow(`ord:gender:${sid}`, '請選擇您偏好的性別', optionList(i.guildId, 'order_genders', DEFAULT_GENDERS))],
      ephemeral: true
    });
  }
  if (id.startsWith('ord:')) {
    const [, step, sid] = id.split(':');
    const sess = S.get(sid);
    if (!sess) return eph(i, err(i.guildId, '這次下單已逾時（超過 15 分鐘），請重新點一次按鈕。'));

    if (step === 'gender') {
      S.update(sid, { gender: i.values[0] });
      return i.update({
        embeds: [emb(i.guildId, { title: '🪄 開始下單（2/4）', desc: `偏好性別：**${i.values[0]}**\n\n請選擇服務類型：` })],
        components: [selectRow(`ord:service:${sid}`, '請選擇服務類型', optionList(i.guildId, 'order_services', DEFAULT_SERVICES))]
      });
    }
    if (step === 'service') {
      S.update(sid, { service: i.values[0] });
      const addons = optionList(i.guildId, 'order_addons', DEFAULT_ADDONS);
      return i.update({
        embeds: [emb(i.guildId, { title: '🪄 開始下單（3/4）', desc: `服務類型：**${i.values[0]}**\n\n請選擇加購選項（可複選，沒有就選「不加購」）：` })],
        components: [selectRow(`ord:addon:${sid}`, '請選擇加購選項', ['不加購', ...addons], addons.length + 1)]
      });
    }
    if (step === 'addon') {
      S.update(sid, { addons: i.values.filter(v => v !== '不加購') });
      return i.showModal(new ModalBuilder().setCustomId(`ord:final:${sid}`).setTitle('下單資料（4/4）')
        .addComponents(
          input('when', '需求時段與時數', { ph: '例：今晚 21:00 起 2 小時' }),
          input('prefer', '指定陪玩（可留空）', { required: false, ph: '例：指定 lumi；沒有就留空' }),
          input('note', '備註（可留空）', { required: false, style: TextInputStyle.Paragraph,
            ph: '特殊需求請在這裡補充，實際安排以客服確認為準' })
        ));
    }
    if (step === 'final') {
      const open = openOrderTicket(i);
      if (open) return eph(i, err(i.guildId, `你已經有一個進行中的下單頻道：<#${open}>`));
      await i.deferReply({ ephemeral: true });
      const f = k => (i.fields.getTextInputValue(k) || '').trim();
      const ch = await createPrivateChannel(i.guild, i.member,
        { prefix: '下單', categoryKey: 'category_ticket', extraRoleKeys: ['role_cs', 'role_admin'] });
      const info = db.prepare("INSERT INTO tickets (guild_id, src_guild, channel_id, customer_id, kind, subject) VALUES (?,?,?,?,'order',?)")
        .run(orgOf(i.guildId), i.guildId, ch.id, i.user.id, sess.service || '下單');
      const csRole = getSetting('role_cs', '', i.guildId);
      await ch.send({
        content: [mention(i.user.id), csRole ? `<@&${csRole}>` : ''].filter(Boolean).join(' ') + ' 新的下單需求！',
        embeds: [emb(i.guildId, {
          title: '🪄 下單資料',
          fields: [
            { name: '下單者', value: mention(i.user.id), inline: true },
            { name: '偏好性別', value: sess.gender || '不指定', inline: true },
            { name: '服務類型', value: sess.service || '—', inline: true },
            { name: '需求時段與時數', value: f('when') },
            { name: '加購選項', value: sess.addons?.length ? sess.addons.join('、') : '（無）', inline: true },
            { name: '指定陪玩', value: f('prefer') || '（不指定）', inline: true },
            { name: '備註', value: f('note') || '（無）' }
          ],
          footer: '本表單僅建立下單資料，尚未完成付款或排單。客服通知後 15 分鐘內未回覆將視同棄單。'
        })],
        components: [row(
          btn(`ticket:claim:${info.lastInsertRowid}`, '客服接單', ButtonStyle.Success, '🙋'),
          btn(`ticket:close:${info.lastInsertRowid}`, '關閉頻道', ButtonStyle.Danger, '🔒')
        )]
      });
      S.drop(sid);
      return i.editReply({ embeds: [ok(i.guildId, '下單資料已送出',
        `請前往你的專屬頻道等待客服確認：${ch}`)] });
    }
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
    if (!isCS(i.member)) return denyEph(i, '只有客服可以接單。');
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
      return denyEph(i, '只有開單者或客服可以關閉。');
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
