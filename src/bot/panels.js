// 面板建置（!sendrole / !sendorder / !setup-*）與其按鈕、表單互動
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField,
  ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder
} = require('discord.js');
const { db, getSetting, getNum, getCustomer, findStaff, getStaff, now, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const M = require('../util/money');
const G = require('../util/gifts');
const { checkoutMessage } = require('../util/checkout');
const { parseSlots } = require('../util/slots');
const S = require('../util/session');
const CF = require('../util/checkout-flow');
const GF = require('../util/gift-flow');
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
  try {
    await msg.channel.send(payload);
  } catch (e) {
    // Discord 的 50013 只回 Missing Permissions，翻成看得懂的指引
    if (e.code === 50001) {
      throw new Error(`機器人在 ${msg.channel} 沒有存取權限。\n`
        + '請到「編輯頻道 → 權限」把 **喚雨機器喵** 加進去並允許「檢視頻道」。');
    }
    if (e.code === 50013) {
      throw new Error(`機器人在 ${msg.channel} 沒有發送訊息的權限。\n`
        + '請到「編輯頻道 → 權限」把 **喚雨機器喵** 加進去，並允許：檢視頻道、發送訊息、嵌入連結、管理訊息。');
    }
    throw e;
  }
  if (msg.deletable) await msg.delete().catch(() => {});
};

// ---------------- 面板建置指令 ----------------
// 每個面板的訊息內容。抽成獨立定義，讓 ! 前綴指令與後台「一鍵發送面板」共用同一份。
const PANELS = {
  'sendrole': {
    label: '身分組領取',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '🎭 身分組領取',
        desc: '點下方按鈕領取／取消你的身分組。\n\n**老闆**：可下單、看金主專區\n**雨滴**：接收開單與活動通知'
      })],
      components: [row(
        btn('role:boss', '我是老闆', ButtonStyle.Success, '👑'),
        btn('role:drop', '雨滴通知', ButtonStyle.Secondary, '💧')
      )]
    })
  },

  'setup-identity': {
    label: '身份大廳',
    build: guildId => ({
      embeds: [emb(guildId, {
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
    })
  },

  'sendorder': {
    label: '下單前提醒',
    build: guildId => ({
      embeds: [emb(guildId, {
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
    })
  },

  'setup-ticket': {
    label: '派單接待大廳',
    build: guildId => ({
      embeds: [emb(guildId, { title: '🎫 派單接待大廳', desc: '點擊下方按鈕開啟你的專屬下單頻道，客服將盡快為你服務。' })],
      components: [row(btn('ticket:order', '開始下單', ButtonStyle.Success, '🛒'))]
    })
  },

  'setup-report': {
    label: '自主報單系統',
    build: guildId => ({
      embeds: [emb(guildId, { title: '📝 喚雨｜自主報單系統', desc: '成員您好！請點擊下方按鈕開始填寫你的名稱。' })],
      components: [row(btn('report:self', '我要報單', ButtonStyle.Primary, '📄'))]
    })
  },

  'setup-checkout': {
    label: '客服結帳台',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '🧾 喚雨｜客服結帳台',
        desc: '客服完成服務後於此結帳：系統會扣老闆雨幣、發出結帳明細，並產生供陪玩報單的訂單編號。'
      })],
      components: [row(btn('checkout:start', '我要結帳', ButtonStyle.Success, '🧾'))]
    })
  },

  'setup-report-cross': {
    label: '跨伺服器報單 1 號',
    build: guildId => ({
      embeds: [emb(guildId, { title: '📄 跨伺服器報單中心', desc: '陪玩專用：請點擊下方按鈕填寫報單資料！' })],
      components: [row(btn('report:cross', '填寫報單', ButtonStyle.Primary, '📄'))]
    })
  },

  'setup-report-cross-2': {
    label: '唱歌單跨服報單',
    build: guildId => ({
      embeds: [emb(guildId, { title: '🎤 唱歌單跨服報單中心', desc: '歌手專用：請點擊下方按鈕填寫唱歌報單！' })],
      components: [row(btn('report:cross2', '填寫唱歌報單', ButtonStyle.Primary, '🎤'))]
    })
  },

  'setup-exam': {
    label: '考核入職開單說明',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '📋 喚雨｜考核入職開單說明',
        desc: [
          '歡迎來到喚雨電競',
          '',
          '在開啟考核入職單前，請先詳閱上方的考核規則，確認自己已了解考核流程',
          '',
          '**📌 開單前請先確認：**',
          '',
          '・已閱讀並了解考核規則',
          '・確認自己可以配合考核流程',
          '・清楚考核期間需遵守店內規範',
          '・有任何疑問請先詢問管理，不要自行判斷',
          '',
          '開單後，考官會看到你的考核入職單，並依照流程進行後續考核流程',
          '',
          '**⚠️ 小提醒**',
          '',
          '開單不代表已正式入職，也不代表已開放接單權限',
          '請等待考官或管理通知後，再進行下一步流程'
        ].join('\n')
      })],
      components: [row(btn('exam:start', '我要入職', ButtonStyle.Success, '📋'))]
    })
  },

  'setup-member': {
    label: '會員服務中心',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '💎 會員服務中心',
        desc: '點擊下方按鈕，即可查詢您的雨幣餘額、背包優惠券與歷史點單紀錄。'
      })],
      components: [row(
        btn('mb:coins', '查詢雨幣餘額', ButtonStyle.Primary, '💳'),
        btn('mb:bag', '查看背包優惠券', ButtonStyle.Primary, '🎒'),
        btn('mb:orders', '查詢我的點單紀錄', ButtonStyle.Primary, '📋')
      )]
    })
  },

  'setup-bank': {
    label: '地下金庫',
    build: guildId => ({
      embeds: [emb(guildId, { title: '🏦 地下金庫', desc: '點擊查詢你目前的雨幣餘額、VIP 等級與消費紀錄（僅你自己看得到）。' })],
      components: [row(btn('bank:me', '查詢餘額', ButtonStyle.Primary, '🪙'))]
    })
  },

  'setup-intimacy': {
    label: '愛戀藏館',
    build: guildId => ({
      embeds: [emb(guildId, { title: '💞 愛戀藏館', desc: '查詢你與陪玩師之間的羈絆點數與特權進度。' })],
      components: [row(btn('intimacy:query', '查詢羈絆', ButtonStyle.Primary, '💞'))]
    })
  },

  'setup-suggestion': {
    label: '意見投訴與建議箱',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '📮 喚雨｜意見箱',
        desc: '接收任何關於喚雨的改善建議。\n\n抑或著是有任何問題也可以在此提出，\n我們會絕對對非當事人保密意見箱內容！'
      })],
      components: [row(btn('sug:public', '填寫意見表單', ButtonStyle.Primary, '📝'))]
    })
  },

  'setup-staff-suggestion': {
    label: '員工輔導室',
    build: guildId => ({
      embeds: [emb(guildId, {
        title: '🤝 喚雨｜員工輔導室',
        desc: '接收任何關於喚雨員工的專屬建議、投訴與問題。\n\n我們會絕對保密內容，僅後台管理可見！'
      })],
      components: [row(btn('sug:staff', '填寫問題', ButtonStyle.Primary, '📝'))]
    })
  }
};

// ! 前綴指令：在目前頻道發出面板並刪掉指令原文
const commands = Object.fromEntries(Object.keys(PANELS).map(key => [key,
  async msg => { adminOnly(msg); await post(msg, PANELS[key].build(msg.guild.id)); }]));

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

/** 建立頻道後若後續動作失敗，把頻道與資料列一起收掉，避免殘留擋住使用者 */
async function rollbackChannel(channel, table, id) {
  if (channel) await channel.delete().catch(() => {});
  if (table && id) db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
}

async function createPrivateChannel(guild, member, { prefix, name, categoryKey, extraRoleKeys = [] }) {
  const parent = getSetting(categoryKey, '', guild.id) || null;
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    // 機器人自己也要開權限：@everyone 被關掉檢視後，它會看不到自己剛建的頻道
    { id: guild.members.me.id,
      allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages,
              PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.AttachFiles,
              PermissionsBitField.Flags.EmbedLinks, PermissionsBitField.Flags.ManageChannels,
              PermissionsBitField.Flags.ManageMessages] },
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
    name: (name || `${prefix}-${member.user.username}`.toLowerCase()).slice(0, 90),
    type: ChannelType.GuildText,
    parent: parent || undefined,
    permissionOverwrites: overwrites
  });
}

const REPORT_LABEL = { self: '自主報單', cross: '跨服報單 1 號', cross2: '唱歌單跨服報單' };

// 開單防呆：同時進行的張數上限與冷卻時間（後台可調，設 0 表示不限）
const lastOrderAt = new Map();
function checkOrderQuota(i) {
  const org = orgOf(i.guildId);
  const max = getNum('order_max_open', 5, org);
  if (max > 0) {
    const open = db.prepare(`SELECT COUNT(*) c FROM tickets
                             WHERE guild_id=? AND customer_id=? AND kind='order' AND status!='closed'`)
      .get(org, i.user.id).c;
    if (open >= max) {
      return `你目前有 ${open} 張進行中的單，已達上限 ${max} 張。\n請先結束其中一張（按頻道裡的「🔒 關閉訂單」）再開新單。`;
    }
  }
  const cd = getNum('order_cooldown_sec', 30, org);
  if (cd > 0) {
    const key = `${i.guildId}:${i.user.id}`;
    const last = lastOrderAt.get(key) || 0;
    const left = Math.ceil((last + cd * 1000 - Date.now()) / 1000);
    if (left > 0) return `開單太頻繁了，請於 ${left} 秒後再試。`;
  }
  return null;
}
const markOrderCreated = i => lastOrderAt.set(`${i.guildId}:${i.user.id}`, Date.now());

// 下單選單的選項，皆可用後台設定覆蓋（逗號分隔）
const DEFAULT_GENDERS = ['不限男女', '限女生', '限男生'];
const DEFAULT_SERVICES = ['雨幣儲值', '特戰英豪', 'Steam 小遊戲', '唱歌單曲', '語聊', '其他遊戲'];
// 需要再問子類型的服務（服務 → 子選項清單）
const SERVICE_SUBTYPES = { '語聊': ['一般語聊', '戀愛語聊'] };
// 不必問技術／娛樂分類的服務，選完（子類型後）直接問性別
const SKIP_CATEGORY = ['唱歌單曲', '語聊', '一般語聊', '戀愛語聊'];
// 需求單不問段位的服務（沒有段位可言）
const SKIP_RANK = ['唱歌單曲', '語聊', '一般語聊', '戀愛語聊'];
// 加購選項可標價，格式「名稱=每局加價」
const DEFAULT_ADDONS = ['指定/甜蜜=50', '聲優=50', '無=0'];
// 服務分類（技術／娛樂）
const DEFAULT_CATEGORIES = ['技術', '娛樂'];
// 服務類型 → 頻道名稱用的單別，可用設定 order_type_labels 覆蓋（格式：服務=單別,服務=單別）
const DEFAULT_TYPE_LABELS = {
  '雨幣儲值': '儲值單', '特戰英豪': '娛樂單', 'Steam 小遊戲': 'steam單',
  '唱歌單曲': '唱歌單', '語聊': '語聊單',
  '一般語聊': '語聊單', '戀愛語聊': '語聊單', '其他遊戲': '娛樂單'
};

const optionList = (guildId, key, fallback) => {
  const arr = getSetting(key, '', guildId).split(',').map(x => x.trim()).filter(Boolean);
  return (arr.length ? arr : fallback).slice(0, 25);
};
const selectRow = (customId, placeholder, values, maxValues = 1) =>
  new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder.slice(0, 150))
      .setMinValues(1).setMaxValues(Math.min(maxValues, values.length))
      .addOptions(values.map(v => ({ label: v.slice(0, 100), value: v.slice(0, 100) }))));

/** 不需要分類的服務直接問性別，其餘先問技術／娛樂 */
function askCategoryOrGender(guildId, sid, service) {
  if (SKIP_CATEGORY.includes(service)) {
    return {
      content: '請選擇您偏好的性別：',
      components: [selectRow(`ord:gender:${sid}`, '請選擇您偏好的性別',
        optionList(guildId, 'order_genders', DEFAULT_GENDERS))]
    };
  }
  return {
    content: '請選擇服務分類：',
    components: [selectRow(`ord:cat:${sid}`, '請選擇服務分類（技術／娛樂）',
      optionList(guildId, 'order_categories', DEFAULT_CATEGORIES))]
  };
}

/** 服務類型對應的分類（娛樂／技術…），取單別名稱去掉「單」字 */
const categoryOf = (guildId, service) => ticketLabel(guildId, service).replace(/單$/, '');

/** 服務類型對應的單別名稱（頻道名稱用） */
function ticketLabel(guildId, service) {
  const raw = getSetting('order_type_labels', '', guildId);
  const map = { ...DEFAULT_TYPE_LABELS };
  for (const pair of raw.split(',')) {
    const [k, v] = pair.split('=').map(x => (x || '').trim());
    if (k && v) map[k] = v;
  }
  // 已經是分類名稱（例：娛樂）時直接補「單」字
  return map[service] || (service ? `${service}單` : '娛樂單');
}

/** 全店連號的單號 */
function nextTicketSeq(guildId) {
  const org = orgOf(guildId);
  const start = getNum('ticket_seq_start', 1001, org);
  const max = db.prepare('SELECT COALESCE(MAX(seq),0) m FROM tickets WHERE guild_id=?').get(org).m;
  return Math.max(start, max + 1);
}

/** 解析加購選項設定：「甜蜜/指定稱呼=50」→ { name, price, label } */
function addonOptions(guildId) {
  return optionList(guildId, 'order_addons', DEFAULT_ADDONS).map(raw => {
    const [name, price] = raw.split('=').map(x => (x || '').trim());
    const p = Number(price) || 0;
    return { name, price: p, label: p ? `${name} (+${p}元/局)` : name };
  });
}
const addonText = (guildId, t) => {
  if (!t.addons) return '無';
  const map = Object.fromEntries(addonOptions(guildId).map(a => [a.name, a]));
  return t.addons.split(',').filter(Boolean).map(k => map[k]?.label || k).join('、');
};

/** 包廂內「訂單建立中」的卡片（附加選項已於下單流程選定，這裡只做確認與發布） */
function draftPayload(guildId, tid) {
  const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(tid);
  return {
    embeds: [emb(guildId, {
      title: '⏳ 訂單建立中...(請確認並發布)',
      desc: `老闆 ${mention(t.customer_id)} 您好！您的需求已記錄，確認無誤後請點下方按鈕發布訂單：`,
      fields: [
        { name: '需求類型', value: `${t.service}${t.gender}`, inline: true },
        { name: '老闆段位', value: t.rank || '無', inline: true },
        { name: '附加選項', value: addonText(guildId, t), inline: true },
        { name: '其他需求', value: `時間：${t.play_at || '—'}\n時長：${t.duration || '—'}\n備註：${t.content || '無'}` },
        { name: '​', value: '⚠️ 尚未發布，陪玩目前還看不到這張單喔！' }
      ]
    })],
    components: [
      row(
        btn(`tk:anon:${tid}`, '確認訂單', ButtonStyle.Success, '✅'),
        btn(`tk:public:${tid}`, '公開訂單', ButtonStyle.Primary, '📢'),
        btn(`tk:cancel:${tid}`, '取消訂單', ButtonStyle.Danger, '❌')
      )
    ]
  };
}

/** 發布後留在包廂的狀態卡 */
function publishedPayload(guildId, t) {
  const anon = t.publish === 'anon';
  return {
    content: '✅ 已經為您發布到接單專區！請耐心等候陪玩遞交名片。\n'
           + '(若已徵滿，可點擊下方按鈕提早關閉名片專區)',
    embeds: [emb(guildId, {
      title: '✅ 訂單已發布！',
      desc: `老闆 ${mention(t.customer_id)} 您好！您的需求已送出，以下是這張單的內容：`,
      color: COLOR.ok,
      fields: [
        { name: '需求類型', value: `${t.service}${t.gender}`, inline: true },
        { name: '老闆段位', value: t.rank || '無', inline: true },
        { name: '附加選項', value: addonText(guildId, t), inline: true },
        { name: '其他需求', value: `時間：${t.play_at || '—'}\n時長：${t.duration || '—'}\n備註：${t.content || '無'}` },
        { name: '​', value: anon
            ? '此為匿名頻道。陪玩的報名名片將會直接發送至此。'
            : '這是公開單，陪玩可以直接在本頻道遞交名片。' }
      ]
    })],
    components: [row(btn(`tk:closecard:${t.id}`, '關閉名片專區', ButtonStyle.Danger, '🗑️'))]
  };
}

/** 給陪玩看的招募卡；匿名單不顯示老闆是誰 */
function recruitEmbed(guildId, t) {
  const anon = t.publish === 'anon';
  return emb(guildId, {
    title: '⚠️ 新訂單！',
    color: COLOR.warn,
    desc: anon
      ? '⚠️ 有老闆發布了新任務！符合條件的陪玩們請火速遞交名片！'
      : `老闆 ${mention(t.customer_id)} 發布了新任務！符合條件的陪玩們請火速遞交名片！`,
    fields: [
      { name: '需求類型', value: `${t.service}${t.gender}`, inline: true },
      { name: '老闆段位', value: t.rank || '無', inline: true },
      { name: '附加選項', value: addonText(guildId, t), inline: true },
      { name: '其他需求', value: `時間：${t.play_at || '—'}\n時長：${t.duration || '—'}\n備註：${t.content || '無'}` }
    ]
  });
}



// 自主報單＝認領主群已結帳的訂單（金流已在結帳時完成，這裡只留服務紀錄與截圖）
function reportModal(kind) {
  const m = new ModalBuilder().setCustomId(`reportm:${kind}`).setTitle('📄 報單填寫');
  if (kind === 'self') {
    return m.addComponents(
      input('order_no', '訂單編號（ORD-XXXXXXXX）', { ph: '結帳時客服提供' }),
      input('boss_dc', '老闆 DC_ID', { ph: '例：tsuki_.32' }),
      input('customer', '老闆 遊戲ID', { ph: '例：123456789012345678' }),
      input('staff', '陪玩 遊戲ID', { ph: '例：一坨羊毛毛#0712 或 R01' }),
      input('slots', '報單類別及場次/小時', { ph: '例：娛樂4場' })
    );
  }
  if (kind === 'cross2') {
    return m.setTitle('🎤 唱歌單跨服報單').addComponents(
      input('order_no', '訂單編號（ORD-XXXXXXXX）', { ph: '結帳時客服提供' }),
      input('boss_dc', '老闆 DC_ID', { ph: '例：luvmao3' }),
      input('songs', '幾首歌', { ph: '例：1' }),
      input('song_names', '歌名', { style: TextInputStyle.Paragraph, ph: '一行一首' })
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

const UNSETTLED_PER_PAGE = 20;

/** 待核銷訂單的第 page 頁（0 起算），含上一頁／下一頁按鈕 */
function unsettledPage(guildId, page = 0) {
  const org = orgOf(guildId);
  const total = db.prepare("SELECT COUNT(*) c FROM orders WHERE guild_id=? AND status='pending'").get(org).c;
  const pages = Math.max(1, Math.ceil(total / UNSETTLED_PER_PAGE));
  const p = Math.min(Math.max(0, page), pages - 1);
  const rows = db.prepare(`SELECT * FROM orders WHERE guild_id=? AND status='pending'
                           ORDER BY created_at LIMIT ? OFFSET ?`)
    .all(org, UNSETTLED_PER_PAGE, p * UNSETTLED_PER_PAGE);
  const body = rows.length
    ? rows.map(o => {
        const t = o.created_at.slice(5, 16).replace('-', '/');
        const note = o.note ? ` | 📝: ${o.note}` : '';
        return `▫️ \`${o.order_no}\` | ${t} | 陪玩 ${mention(o.staff_id)} | 金額: \`${n(o.amount)}\`${note}`;
      }).join('\n')
    : '🎉 目前沒有未核銷的訂單。';
  return {
    embeds: [emb(guildId, {
      title: `📋 待核銷訂單總覽 (目前共 ${n(total)} 筆)`,
      desc: `以下是系統中尚未被核銷發放的訂單列表：\n\n${body}`.slice(0, 3900)
        + `\n\n*(第 ${p + 1} 頁 / 共 ${pages} 頁)*`,
      color: COLOR.warn
    })],
    components: pages > 1 ? [row(
      btn(`un:${p - 1}`, '上一頁', ButtonStyle.Secondary, '⬅️').setDisabled(p === 0),
      btn(`un:${p + 1}`, '下一頁', ButtonStyle.Secondary, '➡️').setDisabled(p >= pages - 1)
    )] : []
  };
}

/** 歸檔時的頻道名稱：有服務類型就用「單別│單號│狀態」，否則保留原名再加狀態 */
function archivedName(channel, t, suffix) {
  const base = t.service && t.seq
    ? `🎫│${ticketLabel(channel.guild.id, t.service)}│${t.seq}`
    : channel.name.replace(/│(已結帳|已結單)$/, '');
  return `${base}│${suffix}`.slice(0, 90);
}

/** 名片專區刪除前，把裡面的對話整理成存底貼到老闆的訂單頻道 */
async function archiveCardChannel(guild, t) {
  try {
    const cc = await guild.channels.fetch(t.card_channel_id).catch(() => null);
    const boss = await guild.channels.fetch(t.channel_id).catch(() => null);
    if (!cc || !boss?.isTextBased?.()) return;

    const msgs = [...(await cc.messages.fetch({ limit: 100 })).values()]
      .filter(m => !m.author.bot || m.embeds.length)
      .reverse();
    if (!msgs.length) return;

    const lines = msgs.map(m => {
      const who = m.member?.displayName || m.author.username;
      const text = m.content || m.embeds[0]?.description || '（附件）';
      const files = [...m.attachments.values()].map(a => a.url).join(' ');
      return `**${who}**：${text}${files ? '\n' + files : ''}`;
    });

    // Discord 描述上限 4096，超過就分批送
    const chunks = [];
    let buf = '';
    for (const l of lines) {
      if ((buf + l).length > 3800) { chunks.push(buf); buf = ''; }
      buf += l + '\n';
    }
    if (buf) chunks.push(buf);

    for (const [idx, body] of chunks.entries()) {
      await boss.send({
        embeds: [emb(guild.id, {
          title: idx === 0 ? `🗂️ 名片專區存底（單號 ${t.seq || t.id}）` : `🗂️ 名片專區存底（續 ${idx + 1}）`,
          desc: body,
          color: COLOR.warn,
          footer: idx === chunks.length - 1 ? '名片專區已關閉，以上為完整對話紀錄' : undefined
        })]
      }).catch(() => {});
    }
  } catch (e) {
    console.warn('名片專區存底失敗：', e.message);
  }
}

/** 把結帳明細自動備份一份到財務頻道 */
async function backupToFinance(i, r) {
  const id = getSetting('channel_finance', '', i.guildId);
  if (!id) return;
  const ch = await i.client.channels.fetch(id).catch(() => null);
  if (!ch || !ch.isTextBased()) return;
  await ch.send({
    content: `📦 **[系統自動備份]** 結帳方式：${r.cash ? '💸 現金 / 轉帳' : '🪙 雨幣扣款'}`,
    embeds: [r.detail]
  }).catch(() => {});
}

/** 結帳後：張貼完成卡片、改名為「已結帳」並搬到已結單分類，同時關掉名片專區 */
async function archiveTicketChannel(i) {
  const t = db.prepare("SELECT * FROM tickets WHERE guild_id=? AND channel_id=? AND kind='order'")
    .get(orgOf(i.guildId), i.channelId);
  if (!t) return;
  db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(now(), t.id);
  if (t.card_channel_id) {
    const cc = await i.guild.channels.fetch(t.card_channel_id).catch(() => null);
    if (cc) {
      await archiveCardChannel(i.guild, t);
      await cc.delete().catch(() => {});
    }
    db.prepare("UPDATE tickets SET card_channel_id='' WHERE id=?").run(t.id);
  }
  await i.channel.send({
    embeds: [emb(i.guildId, {
      title: '🔴 此訂單已完成 🔴',
      color: COLOR.err,
      desc: [
        '────────────────────',
        '🚫 請勿在此線後發言及遞交名片',
        '⚠️ 若老闆或陪玩對訂單有任何問題',
        '請務必在 **24小時內** 包廂關閉前，聯繫管理員',
        '────────────────────'
      ].join('\n')
    })],
    components: [row(btn(`ticket:close:${t.id}`, '關閉訂單', ButtonStyle.Danger, '🔒'))]
  }).catch(() => {});
  await i.channel.setName(archivedName(i.channel, t, '已結帳')).catch(() => {});
  const done = getSetting('category_order_done', '', i.guildId);
  if (done) await i.channel.setParent(done, { lockPermissions: false }).catch(() => {});
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

  // ---- 待核銷分頁 ----
  if (id.startsWith('un:')) {
    if (!isCS(i.member)) return denyEph(i, '僅限客服／管理員使用。');
    return i.update(unsettledPage(i.guildId, Number(id.split(':')[1]) || 0));
  }

  // ---- 會員服務中心 ----
  if (id.startsWith('mb:')) {
    const act = id.split(':')[1];
    const c = getCustomer(i.guildId, i.user.id, i.user.username);
    if (act === 'coins') {
      return eph(i, emb(i.guildId, {
        title: '💳 餘額查詢', color: COLOR.money,
        desc: `💰 雨幣：\`${n(c.coins)}\``
      }));
    }
    if (act === 'bag') {
      const items = G.listBackpack(i.guildId, i.user.id);
      const body = items.length
        ? items.map(x => {
            const off = x.percent > 0 ? `打 ${100 - x.percent} 折` : `折抵 ${n(x.value)} 元`;
            return `🎟️ **${x.name}**\n└ 優惠內容：\`${off}\` ｜ 數量：\`${x.qty}\` 張`;
          }).join('\n\n')
        : '背包裡目前沒有任何優惠券。';
      return eph(i, emb(i.guildId, { title: '🎒 我的專屬背包', desc: body, color: COLOR.err }));
    }
    if (act === 'orders') {
      const rows = db.prepare(`SELECT staff_id, SUM(amount) amt FROM orders
                               WHERE guild_id=? AND customer_id=? AND status!='refunded'
                               GROUP BY staff_id ORDER BY amt DESC LIMIT 25`)
        .all(orgOf(i.guildId), i.user.id);
      const total = rows.reduce((a, r) => a + r.amt, 0);
      const body = rows.length
        ? rows.map(r => `・${mention(r.staff_id)}：共消費 \`${n(r.amt)}\` 元`).join('\n')
          + `\n\n────────────────\n💰 **歷史總計消費：** \`${n(total)}\` 元`
        : '你還沒有任何點單紀錄。';
      return eph(i, emb(i.guildId, { title: '📋 您的專屬點單紀錄', desc: body }));
    }
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
    return i.showModal(new ModalBuilder().setCustomId('reportch').setTitle('📄 自主報單系統')
      .addComponents(input('name', '請輸入此份報單的名稱', { ph: '例：羊毛毛' })));
  }
  if (id === 'reportch') {
    await i.deferReply({ ephemeral: true });
    const name = i.fields.getTextInputValue('name').trim();
    const ch = await createPrivateChannel(i.guild, i.member, {
      name: `📄│${name}報單`,
      categoryKey: 'category_report',
      extraRoleKeys: ['role_cs', 'role_admin']
    });
    try {
      await ch.send({
      content: `${mention(i.user.id)} 您的專屬報單通道已建立！`,
      embeds: [emb(i.guildId, {
        title: '📝 報單內容提交',
        desc: `**報單人：** ${mention(i.user.id)}\n\n請在下方提供詳細的報單數據或截圖，管理團隊將會儘速為您處理。`
      })]
    });
    const panel = await ch.send({
      embeds: [emb(i.guildId, {
        title: '📄 跨伺服器報單中心',
        desc: '陪玩專用：請點擊下方按鈕填寫報單資料！'
      })],
      components: [row(btn('reportform:self', '填寫報單', ButtonStyle.Primary, '📄'))]
    });
      await panel.pin().catch(() => {});
    } catch (e) {
      await rollbackChannel(ch, null, null);
      throw e;
    }
    return i.editReply({ content: `✅ **報單頻道已建立**，請前往填寫詳細內容：${ch}` });
  }

  // 跨服報單／頻道內的填寫按鈕，都直接開表單
  if (id.startsWith('report:') || id.startsWith('reportform:')) {
    const kind = id.split(':')[1];
    if (!canReport()) return denyEph(i, '只有在職員工可以報單。');
    return i.showModal(reportModal(kind));
  }
  if (id.startsWith('reportm:')) {
    const kind = id.split(':')[1];
    const f = k => (i.fields.getTextInputValue(k) || '').trim();

    // 唱歌單：認領既有訂單，明細只列歌曲資訊
    if (kind === 'cross2') {
      let o;
      try { o = M.reportOrder(i.guildId, f('order_no'), { reporterId: i.user.id }); }
      catch (e) { return eph(i, err(i.guildId, e.message)); }
      const body = emb(i.guildId, {
        title: '🎤 唱歌報單明細',
        desc: [
          `訂單編號：\`${o.order_no}\``,
          `老闆dc：${f('boss_dc')}`,
          `幾首歌：${f('songs')}`,
          `歌名：\n${f('song_names')}`,
          '',
          '*(請在下方補充截圖)*'
        ].join('\n')
      });
      const csRole0 = getSetting('role_cs', '', i.guildId);
      const content0 = [mention(i.user.id), csRole0 ? `<@&${csRole0}>` : '', '您的報單已產生：']
        .filter(Boolean).join(' ');
      await i.reply({ embeds: [ok(i.guildId, '報單已成功發布！', null)], ephemeral: true });
      await sendToChannel(i.guild, 'channel_order_log', { content: content0, embeds: [body] });
      return i.channel.send({ content: content0, embeds: [body] });
    }

    const customerId = (f('customer').match(/\d{15,25}/) || [])[0];
    if (!customerId) return eph(i, err(i.guildId, '老闆 id 格式不正確（需為 Discord 數字 ID）。'));
    const staff = findStaff(i.guildId, f('staff'));
    if (!staff) return eph(i, err(i.guildId, `查無陪玩「${f('staff')}」`));
    const { item, qty } = parseSlots(f('slots'));

    let o;
    try {
      if (kind === 'self') {
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
    await i.reply({ embeds: [ok(i.guildId, '報單已成功發布！', null)], ephemeral: true });
    await sendToChannel(i.guild, 'channel_order_log', { content, embeds: [body] });
    return i.channel.send({ content, embeds: [body] });
  }

  // ---- 客服結帳台（面板按鈕 → 表單 → 互動式結帳）----
  if (id === 'checkout:start') {
    if (!isCS(i.member)) return denyEph(i, '只有客服／管理員可以結帳。');
    return i.showModal(new ModalBuilder().setCustomId('checkoutm').setTitle('本次結帳明細')
      .addComponents(
        input('customer', '老闆 id', { ph: '例：123456789012345678' }),
        input('staff', '陪玩 id', { ph: '例：lumi 或 R01' }),
        input('slots', '服務項目／場次·小時', { ph: '例：娛樂4場' }),
        input('list', '訂單原價（雨幣）', { ph: '例：2000' }),
        input('discount', '手動折扣（可留空）', { required: false, ph: '沒有折扣請留空或填 0' })
      ));
  }
  if (id === 'checkoutm') {
    const f = k => (i.fields.getTextInputValue(k) || '').trim();
    const customerId = (f('customer').match(/\d{15,25}/) || [])[0];
    if (!customerId) return eph(i, err(i.guildId, '老闆 id 格式不正確（需為 Discord 數字 ID）。'));
    const staff = findStaff(i.guildId, f('staff'));
    if (!staff) return eph(i, err(i.guildId, `查無陪玩「${f('staff')}」`));
    const list = Number(f('list'));
    const manual = Number(f('discount') || 0);
    if (!Number.isFinite(list) || list <= 0) return eph(i, err(i.guildId, '訂單原價必須是大於 0 的數字。'));
    if (!Number.isFinite(manual) || manual > list) return eph(i, err(i.guildId, '手動折扣不可大於訂單原價。'));
    const { item, qty } = parseSlots(f('slots'));
    const { payload } = CF.start({
      guildId: i.guildId, customerId, staffId: staff.user_id, staffName: staff.name || staff.code,
      csId: i.user.id, csName: i.user.tag, item, qty, list, manualDiscount: manual, note: ''
    });
    return i.reply({ ...payload, ephemeral: true });
  }

  // ---- 互動式送禮（預覽 → 付款方式）----
  if (id.startsWith('gf:')) {
    if (!isCS(i.member)) return denyEph(i, '只有客服／管理員可以送禮。');
    const [, act, sid, pay] = id.split(':');
    if (act === 'cancel') { S.drop(sid); return i.update({ content: '已取消送禮，沒有扣款。', embeds: [], components: [] }); }
    if (act === 'pay') {
      let r;
      try { r = GF.finish(sid, pay); }
      catch (e) { return i.update({ embeds: [err(i.guildId, e.message)], components: [] }); }
      await i.update({ content: r.detail, embeds: [], components: [] });
      return i.channel.send(r.message);
    }
  }

  // ---- 互動式結帳（選券 → 預覽 → 付款方式）----
  if (id.startsWith('co:')) {
    if (!isCS(i.member)) return denyEph(i, '只有客服／管理員可以結帳。');
    const [, act, sid, pay] = id.split(':');
    const sess = S.get(sid);
    if (!sess) return eph(i, err(i.guildId, '這筆結帳已逾時（超過 15 分鐘），請重新執行 /結帳。'));

    if (act === 'pick') {
      const picked = i.values[0];
      if (picked === 'manual') {
        return i.showModal(new ModalBuilder().setCustomId(`co:manual:${sid}`).setTitle('額外折扣金額')
          .addComponents(input('amount', '折扣金額（元）', { ph: '例：50', value: String(sess.manualDiscount || 0) })));
      }
      S.update(sid, { couponKey: picked === 'none' ? '' : picked });
      return i.update(CF.preview(sid, S.get(sid)));
    }
    if (act === 'manual') {
      const v = Math.max(0, Math.round(Number(i.fields.getTextInputValue('amount')) || 0));
      if (v > sess.list) return eph(i, err(i.guildId, `折扣金額不可超過訂單原價 ${sess.list} 元。`));
      S.update(sid, { manualDiscount: v });
      return i.update(CF.couponPayload(sid, S.get(sid)));
    }
    if (act === 'cancel') {
      S.drop(sid);
      return i.update({ content: '', embeds: [ok(i.guildId, '已取消結帳', '沒有建立任何訂單，折價券也未扣除。')], components: [] });
    }
    if (act === 'pay') {
      let r;
      try { r = CF.finish(sid, pay); }
      catch (e) { return i.update({ content: '', embeds: [err(i.guildId, e.message)], components: [] }); }
      await i.update({
        content: `✅ 結帳建檔完成！（方式：${r.cash ? '💸 現金 / 轉帳' : '🪙 雨幣扣款'}）\n`
               + '**[客服專屬機密]** 帳務紀錄已同步至資料庫：',
        embeds: [r.detail], components: []
      });
      await i.channel.send(r.message);
      await backupToFinance(i, r);
      return archiveTicketChannel(i);
    }
  }

  // ---- 點單系統（服務類型 →〔子類型〕→ 技術／娛樂 → 性別 → 附加選項 → 需求單 → 專屬包廂 → 發布）----
  if (id === 'order:start') {
    const over = checkOrderQuota(i);
    if (over) return eph(i, err(i.guildId, over));
    const sid = S.put({ guildId: i.guildId, userId: i.user.id });
    return i.reply({
      components: [selectRow(`ord:service:${sid}`, '🔍 請選擇服務類型...',
        optionList(i.guildId, 'order_services', DEFAULT_SERVICES))],
      ephemeral: true
    });
  }

  if (id.startsWith('ord:')) {
    const [, step, sid] = id.split(':');
    const sess = S.get(sid);
    if (!sess) return eph(i, err(i.guildId, '這次下單已逾時（超過 15 分鐘），請重新點一次按鈕。'));

    if (step === 'service') {
      const svc = i.values[0];
      S.update(sid, { service: svc });

      // 雨幣儲值不需要需求單，直接開專屬頻道給客服處理
      if (svc.includes('儲值')) {
        await i.deferUpdate();
        const seq = nextTicketSeq(i.guildId);
        const ch = await createPrivateChannel(i.guild, i.member, {
          name: `🎫│${ticketLabel(i.guildId, svc)}│${seq}`,
          categoryKey: 'category_ticket',
          extraRoleKeys: ['role_cs', 'role_admin']
        });
        const info = db.prepare(`INSERT INTO tickets
            (guild_id, src_guild, channel_id, customer_id, kind, subject, seq, service, publish)
            VALUES (?,?,?,?,'order',?,?,?,'draft')`)
          .run(orgOf(i.guildId), i.guildId, ch.id, i.user.id, svc, seq, svc);
        const csRole = getSetting('role_cs', '', i.guildId);
        try {
          await ch.send({
            content: [mention(i.user.id), csRole ? `<@&${csRole}>` : ''].filter(Boolean).join(' '),
            embeds: [emb(i.guildId, {
              title: '🪙 雨幣儲值受理中',
              desc: '請告訴我們您要儲值的金額與付款方式，客服看到後會為你處理 💜'
            })],
            components: [row(
              btn(`ticket:claim:${info.lastInsertRowid}`, '客服接單', ButtonStyle.Success, '🙋'),
              btn(`ticket:close:${info.lastInsertRowid}`, '關閉頻道', ButtonStyle.Danger, '🔒')
            )]
          });
        } catch (e) {
          await rollbackChannel(ch, 'tickets', info.lastInsertRowid);
          throw e;
        }
        S.drop(sid);
        markOrderCreated(i);
        return i.editReply({ content: `✅ **已開啟儲值頻道**：${ch}`, components: [] });
      }

      // 需要再細分的服務（例：語聊 → 一般／戀愛）先問子類型
      const subs = SERVICE_SUBTYPES[svc];
      if (subs) {
        return i.update({
          content: `請選擇 ${svc} 的類型：`,
          components: [selectRow(`ord:sub:${sid}`, `選擇${subs.join(' / ')}...`, subs)]
        });
      }

      return i.update(askCategoryOrGender(i.guildId, sid, svc));
    }

    if (step === 'sub') {
      const svc = i.values[0];
      S.update(sid, { service: svc });
      return i.update(askCategoryOrGender(i.guildId, sid, svc));
    }

    if (step === 'cat') {
      S.update(sid, { category: i.values[0] });
      return i.update({
        content: '請選擇您偏好的性別：',
        components: [selectRow(`ord:gender:${sid}`, '請選擇您偏好的性別',
          optionList(i.guildId, 'order_genders', DEFAULT_GENDERS))]
      });
    }

    if (step === 'gender') {
      S.update(sid, { gender: i.values[0] });
      const addons = addonOptions(i.guildId);
      return i.update({
        content: '請選擇附加選項（可複選，沒有需求請選「無」）：',
        components: [new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder().setCustomId(`ord:addon:${sid}`)
            .setPlaceholder('＋ 選擇附加選項（可複選）')
            .setMinValues(1).setMaxValues(addons.length)
            .addOptions(addons.map(a => ({ label: a.label.slice(0, 100), value: a.name.slice(0, 100) }))))]
      });
    }

    if (step === 'addon') {
      S.update(sid, { addons: i.values.filter(v => v !== '無') });
      const d = S.get(sid);
      // 「其他遊戲」要先問是哪款、想玩什麼；Discord 表單上限 5 欄，故不再問段位
      const other = d.service === '其他遊戲';
      return i.showModal(new ModalBuilder().setCustomId(`ord:final:${sid}`)
        .setTitle(`📝 ${d.service} ${d.gender} - 需求單`.slice(0, 45))
        .addComponents(
          ...(other ? [input('game', '遊戲名稱'), input('want', '希望遊玩內容 (模式、教學、解任務)')] : []),
          ...(other || SKIP_RANK.includes(d.service)
            ? []
            : [input('rank', '您的目前段位？(無則填無)', { value: '無' })]),
          input('play_at', '希望時段 (例如: 今晚 20:00 後 / 現在)'),
          input('duration', '預計時長、場次', { ph: '例如：1小時 / 2場 / 不確定' }),
          input('note', '其他需求或備註', { required: false, style: TextInputStyle.Paragraph, ph: '填寫於此' })
        ));
    }

    if (step === 'final') {
      const over = checkOrderQuota(i);
      if (over) return eph(i, err(i.guildId, over));
      await i.deferReply({ ephemeral: true });
      // 欄位會依服務類型不同（其他遊戲沒有段位、多了遊戲名稱與遊玩內容）
      const f = k => { try { return (i.fields.getTextInputValue(k) || '').trim(); } catch { return ''; } };
      const seq = nextTicketSeq(i.guildId);
      const label = (sess.category ? sess.category + '單' : ticketLabel(i.guildId, sess.service));

      const ch = await createPrivateChannel(i.guild, i.member, {
        name: `🎫│${label}│${seq}`,
        categoryKey: 'category_ticket',
        extraRoleKeys: ['role_cs', 'role_admin']
      });
      const info = db.prepare(`INSERT INTO tickets
          (guild_id, src_guild, channel_id, customer_id, kind, subject, seq, service, gender,
           rank, play_at, duration, publish)
          VALUES (?,?,?,?,'order',?,?,?,?,?,?,?,'draft')`)
        .run(orgOf(i.guildId), i.guildId, ch.id, i.user.id, sess.service, seq,
             sess.category || sess.service, sess.gender, f('rank'), f('play_at'), f('duration'));
      if (sess.addons?.length)
        db.prepare('UPDATE tickets SET addons=? WHERE id=?').run(sess.addons.join(','), info.lastInsertRowid);
      const note = [
        f('game') && `遊戲：${f('game')}`,
        f('want') && `希望內容：${f('want')}`,
        f('note')
      ].filter(Boolean).join('\n');
      if (note) db.prepare('UPDATE tickets SET content=? WHERE id=?').run(note, info.lastInsertRowid);

      const csRole = getSetting('role_cs', '', i.guildId);
      try {
        await ch.send({
          content: [mention(i.user.id), csRole ? `<@&${csRole}>` : ''].filter(Boolean).join(' '),
          ...draftPayload(i.guildId, info.lastInsertRowid)
        });
      } catch (e) {
        await rollbackChannel(ch, 'tickets', info.lastInsertRowid);
        throw e;
      }
      S.drop(sid);
      markOrderCreated(i);
      return i.editReply({ content: `✅ **派單初步建立！** 請移步至專屬包廂完成選項設定：${ch}` });
    }
  }

  // ---- 包廂內：附加選項與發布 ----
  if (id.startsWith('tk:')) {
    const [, act, tidRaw] = id.split(':');
    const tid = Number(tidRaw);
    const t = db.prepare('SELECT * FROM tickets WHERE id=?').get(tid);
    if (!t) return eph(i, err(i.guildId, '查無這張訂單。'));
    const mine = t.customer_id === i.user.id;
    if (!mine && !isCS(i.member)) return denyEph(i, '只有開單者或客服可以操作這張單。');

    if (act === 'cancel') {
      db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(now(), tid);
      await i.update({ embeds: [ok(i.guildId, '訂單已取消', '頻道將於 5 秒後關閉。')], components: [] });
      return setTimeout(() => i.channel.delete().catch(() => {}), 5000);
    }
    if (act === 'public' || act === 'anon') {
      if (t.publish !== 'draft') return eph(i, err(i.guildId, '這張單已經發布過了。'));
      await i.deferUpdate();
      const anon = act === 'anon';
      db.prepare('UPDATE tickets SET publish=?, published_at=? WHERE id=?').run(act, now(), tid);

      const parent = getSetting(anon ? 'category_order_anon' : 'category_order_public', '', i.guildId);
      if (parent) await i.channel.setParent(parent, { lockPermissions: false }).catch(() => {});

      const playerRoles = getSetting('role_player', '', i.guildId).split(',').map(x => x.trim()).filter(Boolean);
      const csRole = getSetting('role_cs', '', i.guildId);
      let cardCh = null;

      if (anon) {
        // 匿名單：另開名片專區給陪玩，老闆的包廂維持隱密
        cardCh = await createPrivateChannel(i.guild, i.member, {
          name: `🎫│${ticketLabel(i.guildId, t.service)}│${t.seq}│名片專區`,
          categoryKey: 'category_order_public',   // 名片專區要讓陪玩看得到，放公開單分類
          extraRoleKeys: ['role_cs', 'role_admin', 'role_player']
        });
        db.prepare('UPDATE tickets SET card_channel_id=? WHERE id=?').run(cardCh.id, tid);
      } else {
        // 公開單：直接把包廂開放給陪玩
        for (const rid of playerRoles) {
          await i.channel.permissionOverwrites.edit(rid, {
            ViewChannel: true, SendMessages: true, ReadMessageHistory: true
          }).catch(() => {});
        }
      }

      const fresh = db.prepare('SELECT * FROM tickets WHERE id=?').get(tid);
      await i.editReply(publishedPayload(i.guildId, fresh));

      const target = cardCh || i.channel;
      await target.send({
        content: [csRole ? `<@&${csRole}>` : '', ...playerRoles.map(r => `<@&${r}>`)].filter(Boolean).join(' '),
        embeds: [recruitEmbed(i.guildId, fresh)],
        components: [row(
          btn(`tk:card:${tid}`, '遞交名片', ButtonStyle.Success, '📇'),
          btn(`tk:end:${tid}`, '結束此訂單', ButtonStyle.Danger, '🔒')
        )]
      });
      return;
    }

    // 陪玩遞交名片：名片專區公開展示一份，老闆的包廂也收到一份
    if (act === 'card') {
      const staff = getStaff(i.guildId, i.user.id);
      if (!staff || !staff.active || staff.kind !== 'player')
        return denyEph(i, '只有在職陪玩可以遞交名片。');
      if (t.publish === 'draft') return eph(i, err(i.guildId, '這張單還沒發布。'));
      if (t.status === 'closed') return eph(i, err(i.guildId, '這張單已經結束了。'));
      const name = staff.name || staff.code;
      const boss = await i.guild.channels.fetch(t.channel_id).catch(() => null);
      if (!boss) return eph(i, err(i.guildId, '找不到老闆的訂單頻道，請聯絡客服。'));

      const card = {
        content: staff.card_url || undefined,
        embeds: [emb(i.guildId, {
          title: `✨ 專屬名片：${name}`,
          desc: `老闆您好，我是 **${name}**！請看看我的專屬音卡 👋`,
          color: COLOR.ok,
          footer: staff.card_url ? undefined : '這位陪玩還沒綁定影音名片，請管理用 /入職 補上'
        })]
      };
      await boss.send(card);
      // 在名片專區也公開一份，讓其他陪玩與客服看得到誰報名了
      if (i.channel.id !== boss.id) await i.channel.send(card).catch(() => {});
      return eph(i, ok(i.guildId, '影片名片已成功遞交！', '老闆將在頻道收到您的名片！'));
    }

    // 關閉名片專區（徵滿了）／結束此訂單
    if (act === 'closecard' || act === 'end') {
      if (t.card_channel_id) {
        const cc = await i.guild.channels.fetch(t.card_channel_id).catch(() => null);
        if (cc) {
          await archiveCardChannel(i.guild, t);   // 刪除前先把對話存底到老闆頻道
          await cc.delete().catch(() => {});
        }
        db.prepare("UPDATE tickets SET card_channel_id='' WHERE id=?").run(tid);
      } else {
        // 公開單沒有獨立頻道，改成收回陪玩的檢視權限
        for (const rid of getSetting('role_player', '', i.guildId).split(',').map(x => x.trim()).filter(Boolean)) {
          await i.channel.permissionOverwrites.edit(rid, { ViewChannel: false }).catch(() => {});
        }
      }
      if (act === 'end') db.prepare("UPDATE tickets SET status='closed', closed_at=? WHERE id=?").run(now(), tid);
      const msg = act === 'end' ? '訂單已結束，名片專區已關閉。' : '名片專區已關閉，陪玩不會再看到這張單。';
      if (i.channel.id === t.card_channel_id) return i.reply({ embeds: [ok(i.guildId, '已關閉', msg)] });
      return eph(i, ok(i.guildId, '已關閉', msg));
    }

  }

  // ---- 下單傳票 ----
  if (id === 'ticket:order') {
    const over = checkOrderQuota(i);
    if (over) return eph(i, err(i.guildId, over));
    await i.deferReply({ ephemeral: true });
    const seqT = nextTicketSeq(i.guildId);
    const ch = await createPrivateChannel(i.guild, i.member,
      { name: `下單-${i.user.username}-${seqT}`.toLowerCase(),
        categoryKey: 'category_ticket', extraRoleKeys: ['role_cs', 'role_admin'] });
    const info = db.prepare("INSERT INTO tickets (guild_id, src_guild, channel_id, customer_id, kind, subject, seq) VALUES (?,?,?,?,'order','下單',?)")
      .run(orgOf(i.guildId), i.guildId, ch.id, i.user.id, seqT);
    try {
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
    } catch (e) {
      await rollbackChannel(ch, 'tickets', info.lastInsertRowid);
      throw e;
    }
    markOrderCreated(i);
    return i.editReply({ content: `✅ **已開啟下單頻道**：${ch}` });
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
    // 名片專區一併收掉（收掉前先把對話存底到包廂）
    if (t.card_channel_id) {
      const cc = await i.guild.channels.fetch(t.card_channel_id).catch(() => null);
      if (cc) { await archiveCardChannel(i.guild, t); await cc.delete().catch(() => {}); }
      db.prepare("UPDATE tickets SET card_channel_id='' WHERE id=?").run(tid);
    }

    // 結單＝搬到結單分類並鎖住發言，頻道保留供日後查閱
    const target = getSetting('category_order_closed', '', i.guildId)
                || getSetting('category_ticket', '', i.guildId);
    if (target) await i.channel.setParent(target, { lockPermissions: false }).catch(() => {});
    for (const rid of [t.customer_id, ...getSetting('role_player', '', i.guildId).split(',').map(x => x.trim())]) {
      if (rid) await i.channel.permissionOverwrites.edit(rid, { SendMessages: false }).catch(() => {});
    }
    await i.channel.setName(archivedName(i.channel, t, '已結單')).catch(() => {});

    return i.reply({ embeds: [ok(i.guildId, '訂單已結單',
      '本頻道已移至結單分類並鎖定發言，紀錄保留供日後查閱。')] });
  }

  // ---- 考核入職 ----
  if (id === 'exam:start') {
    return i.showModal(new ModalBuilder().setCustomId('exammodal').setTitle('📝 考核基本資料填寫')
      .addComponents(
        input('subject', '考試項目 (如: 唱歌, 特戰)'),
        input('grade', '分級 (如: 娛樂, 技術, 歌手)'),
        input('gender', '性別 (男 / 女)')
      ));
  }
  if (id === 'exammodal') {
    await i.deferReply({ ephemeral: true });
    const f = k => (i.fields.getTextInputValue(k) || '').trim();
    const ch = await createPrivateChannel(i.guild, i.member, {
      name: `📝│考核單│${i.user.username}`,
      categoryKey: 'category_exam',
      extraRoleKeys: ['role_admin', 'role_cs']
    });
    const info = db.prepare(`INSERT INTO exams (guild_id, src_guild, user_id, nickname, subject, grade, gender, channel_id)
                VALUES (?,?,?,?,?,?,?,?)`)
      .run(orgOf(i.guildId), i.guildId, i.user.id, i.user.username,
           f('subject'), f('grade'), f('gender'), ch.id);
    const csRole = getSetting('role_cs', '', i.guildId);
    try {
      await ch.send({
      content: csRole ? `<@&${csRole}>` : undefined,
      embeds: [emb(i.guildId, {
        title: '📝 考核入職單',
        color: COLOR.ok,
        desc: [
          `歡迎 ${mention(i.user.id)}！您的考核單已建立。`,
          '',
          '**【考生填寫資料】**',
          `▫️ **考試項目：**${f('subject')}`,
          `▫️ **分級：**${f('grade')}`,
          `▫️ **性別：**${f('gender')}`,
          '',
          '請稍候，考官或客服人員將會盡速為您服務！'
        ].join('\n')
      })],
      components: [row(btn(`exam:close:${info.lastInsertRowid}`, '關閉考核單', ButtonStyle.Danger, '🔒'))]
      });
    } catch (e) {
      await rollbackChannel(ch, 'exams', info.lastInsertRowid);
      throw e;
    }
    return i.editReply({ content: `✅ **考核單已開啟！** 請移步至：${ch}` });
  }
  if (id.startsWith('exam:close:')) {
    const eid = Number(id.split(':')[2]);
    const e = db.prepare('SELECT * FROM exams WHERE id=?').get(eid);
    if (!e) return eph(i, err(i.guildId, '查無這張考核單。'));
    if (e.user_id !== i.user.id && !isCS(i.member)) return denyEph(i, '只有考生或考官可以關閉考核單。');
    db.prepare("UPDATE exams SET status='closed' WHERE id=?").run(eid);
    await i.reply({ embeds: [ok(i.guildId, '考核單已關閉', '頻道將於 5 秒後刪除。')] });
    return setTimeout(() => i.channel.delete().catch(() => {}), 5000);
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

module.exports = { commands, handleInteraction, PANELS, unsettledPage };
