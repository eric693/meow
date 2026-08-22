// ! 前綴指令（日常操作、查詢報表、面板建置）
const { AttachmentBuilder } = require('discord.js');
const { db, getCustomer, findStaff, getStaff, addCoins, monthPrefix, getNum, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const M = require('../util/money');
const R = require('../util/reports');
const { isCS } = require('./perm');
const { checkoutMessage } = require('../util/checkout');
const { helpEmbed } = require('../util/help');
const panels = require('./panels');

const firstId = (msg, argStr) => {
  const m = msg.mentions.users.first();
  if (m) return m.id;
  const raw = (argStr.match(/\d{15,25}/) || [])[0];
  return raw || null;
};
const { toCSV } = require('../util/export');
const csv = (name, text) => new AttachmentBuilder(Buffer.from(text, 'utf8'), { name });
const rankLine = (arr, fmt) => arr.length ? arr.map((x, i) => `${['🥇', '🥈', '🥉'][i] || `\`${i + 1}\``} ${fmt(x)}`).join('\n') : '目前沒有資料。';

const handlers = {
  // ---------- 查詢與統計 ----------
  async 消費查詢(msg, args) {
    const target = firstId(msg, args) || msg.author.id;
    if (target !== msg.author.id && !isCS(msg.member)) throw new Error('只有客服／管理員可以查詢他人。');
    const s = R.customerSpend(msg.guild.id, target);
    // 距離下一級 VIP 還差多少
    const thresholds = require('../db').vipThresholds(msg.guild.id);
    const next = thresholds.find(t => t > s.total_spend);
    const progress = next
      ? `（進度：距離 **${R.vipName(msg.guild.id, thresholds.indexOf(next) + 1)}** 還差 \`${n(next - s.total_spend)}\` 元，老闆加油！）`
      : '（已達最高等級，感謝老闆一路支持 💜）';
    await msg.reply({ embeds: [money(msg.guild.id, '💠 喚雨｜消費成就查詢', progress, [
      { name: '👤 查詢對象', value: mention(target) },
      { name: '📅 本月累計消費', value: `\`${n(s.month)}\` 元`, inline: true },
      { name: '🏆 歷史累計消費', value: `\`${n(s.total_spend)}\` 元`, inline: true },
      { name: '\u200b', value: '💡 所有金額均以「實付金額(折價後)」累計，已與點單紀錄同步' }
    ])] });
  },

  async 查點單(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    if (!target) throw new Error('請標記要查詢的老闆，例如 `!查點單 @老闆`');
    const c = getCustomer(msg.guild.id, target);
    const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
    await msg.reply({
      embeds: [emb(msg.guild.id, {
        title: `📋 ${c.name || target} 的專屬點單紀錄`,
        desc: R.patronOrdersText(msg.guild.id, target)
      })],
      // 手機無法選取 embed 內的文字，另外給一份可複製的純文字
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ord:plain:${target}`)
          .setLabel('純文字版（可複製）').setStyle(ButtonStyle.Secondary).setEmoji('📄'))]
    });
  },

  async 消費榜(msg) {
    const r = R.spendRanking(msg.guild.id, 10);
    const line = (arr, fmt) => arr.length
      ? arr.map((x, i) => `${i + 1}. ${fmt(x)}`).join('\n') : '目前沒有資料。';
    await msg.reply({ embeds: [money(msg.guild.id, '🏆 喚雨｜金主消費榮譽榜', null, [
      { name: '👑 歷史累計總榜 (VVIP)',
        value: line(r.history, x => `${mention(x.user_id)} ➜ \`${n(x.total_spend)}\` 元`) },
      { name: '📅 本月消費戰報',
        value: line(r.month, x => `${mention(x.user_id)} ➜ \`${n(x.amount)}\` 元`) }
    ])] });
  },

  async 匯出消費總表(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    await msg.reply({ content: '✅ **全服金主消費總表已成功匯出！**\n包含所有老闆的 VIP 進度與完整數據，請下載附件查看。',
      files: [csv(`喚雨金主總表_${monthPrefix()}.csv`, toCSV(R.PATRON_COLUMNS, R.patronBoard(msg.guild.id)))] });
  },

  async 薪資查詢(msg, args) {
    const target = firstId(msg, args) || msg.author.id;
    if (target !== msg.author.id && !isCS(msg.member)) throw new Error('只有客服／管理員可以查詢他人薪資。');
    const s = getStaff(msg.guild.id, target);
    if (!s) throw new Error('查無此人的員工資料。');
    await msg.reply({
      content: mention(target),
      embeds: [money(msg.guild.id, '💰 專屬薪資查詢',
        `${mention(target)} 您好！\n\n您目前的薪資狀況如下：\n`
        + `✅ **可提領餘額：** \`${n(s.income)}\` 元\n`
        + `⏳ **暫存薪水 (審核中)：** \`${n(s.pending_income)}\` 元`)]
    });
  },

  async 全服雨幣(msg) {
    const rows = db.prepare(`SELECT user_id, name, coins FROM customers
                             WHERE guild_id=? AND coins > 0 ORDER BY coins DESC LIMIT 60`)
      .all(orgOf(msg.guild.id));
    const t = R.totalCoins(msg.guild.id);
    const body = rows.length
      ? rows.map(r => `${mention(r.user_id)}：\`${n(r.coins)}\` 雨幣`).join('\n')
      : '目前沒有人持有雨幣。';
    await msg.reply({ embeds: [money(msg.guild.id, '🏦 全服雨幣金庫總覽',
      body.slice(0, 3800) + `\n\n────────────────\n流通總額 \`${n(t.c)}\` 雨幣・持有 ${t.n} 位`)] });
  },

  async 雨幣查詢(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    if (!target) {
      await msg.reply('❌ 請標記要查詢的老闆！例如： `!雨幣查詢 @老闆`');
      return;
    }
    const c = getCustomer(msg.guild.id, target);
    const G = require('../util/gifts');
    // 0 元的優惠券（指定稱呼不加價之類）一樣要列出來，只是不顯示折抵金額
    const coupons = G.listBackpack(msg.guild.id, target);
    await msg.reply({ embeds: [money(msg.guild.id, '💳 餘額與背包查詢',
      `老闆 ${mention(target)} 的雨幣餘額：\`${n(c.coins)}\`\n\n**🎒 背包折價券：**\n`
      + (coupons.length ? coupons.map(x => '・' + G.couponLabel(x)).join('\n') : '無'))] });
  },

  async 業績查詢(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const LINE_UP = getNum('high_income_threshold', 20000, orgOf(msg.guild.id));
    const rows = R.staffRanking(msg.guild.id)
      .filter(s => s.amount >= LINE_UP)
      .sort((a, b) => b.amount - a.amount);
    const body = rows.length
      ? rows.map((s, i) => `${i + 1}. ${mention(s.user_id)} ➜ \`${n(s.amount)}\` 元`).join('\n')
      : `本月暫無陪玩達 ${n(LINE_UP / 10000)} 萬元`;
    await msg.reply({ embeds: [money(msg.guild.id,
      `🏆 喚雨｜${monthPrefix()} 高薪陪玩 (達 ${n(LINE_UP / 10000)} 萬以上)`, body.slice(0, 3900))] });
  },

  // ---------- 週結 ----------
  // 薪水一律以「核銷日」計：核銷才是錢真正進到可提領的時點。
  // 用下單日算會對不上——這週核銷上週的單很常見，兩種算法每週都會差。
  async 週結(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const d = (args || '').trim().match(/\d{4}-\d{2}-\d{2}/);
    const r = R.weeklyPayroll(msg.guild.id, d ? d[0] : '');
    if (!r.rows.length) {
      await msg.reply({ embeds: [ok(msg.guild.id, '本週沒有資料', `${r.start} ~ ${r.end}`)] });
      return;
    }
    const top = r.rows.filter(x => x.settled > 0).slice(0, 20);
    const body = top.length
      ? top.map((x, i) => `\`${String(i + 1).padStart(2)}\` ${mention(x.user_id)} ➜ \`${n(x.settled)}\` 元`
          + `（${x.cnt} 單${x.paid ? `，已領 ${n(x.paid)}` : ''}${x.in_roster ? '' : '　⚠️ 不在名冊'}）`).join('\n')
      : '這週還沒有核銷入帳。';
    const csvText = R.toCSV
      ? ''
      : ['代號,姓名,在職狀態,本週核銷入帳,單數,本週退單扣回,本週已提領,目前可提領,暫存薪水']
        .concat(r.rows.map(x => [x.code, x.name,
          x.in_roster ? (x.active ? '在職' : '已離職') : '不在名冊',
          x.settled, x.cnt, x.refunded, x.paid, x.income, x.pending_income]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))).join('\r\n');
    await msg.reply({
      embeds: [money(msg.guild.id, `🗓️ 週結薪資（${r.start} ~ ${r.end}）`,
        `${body}\n\n────────────────\n`
        + `💰 **本週核銷入帳合計：** \`${n(r.total.settled)}\` 元\n`
        + `💸 **本週已提領：** \`${n(r.total.paid)}\` 元\n`
        + `🏦 **目前可提領總額：** \`${n(r.total.income)}\` 元\n`
        + `⏳ **暫存薪水（未核銷）：** \`${n(r.total.pending)}\` 元\n`
        + `（共 ${r.total.staff} 位，完整名單見附件）`
        + (r.total.off_roster
          ? `\n\n⚠️ 其中 **${r.total.off_roster}** 位不在員工名冊（已離職或未建檔），`
            + `本週入帳 \`${n(r.total.off_roster_amount)}\` 元，發薪前請先確認`
          : ''))],
      files: [csv(`週結_${r.start}.csv`, '\ufeff' + csvText)]
    });
  },

  async 匯出報表(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    await msg.reply({ content: `✅ **${monthPrefix()} 財務報表已成功匯出！**\n，請下載附件查看。`,
      files: [csv(`喚雨財務報表_${monthPrefix()}.csv`, toCSV(R.LEDGER_COLUMNS, R.ledgerQuery(msg.guild.id, { month: monthPrefix() }).rows))] });
  },

  async 匯出提領報表(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    await msg.reply({ content: `✅ **${monthPrefix()} 陪玩提領明細已成功匯出！**\n請下載附件查看。`,
      files: [csv(`喚雨提領明細_${monthPrefix()}.csv`, toCSV(R.WITHDRAW_COLUMNS, R.withdrawRows(msg.guild.id, { month: monthPrefix() })))] });
  },

  async 財務報表(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const f = R.financeReport(msg.guild.id);
    const rate = M.shareRate(msg.guild.id);
    // 依本月分潤（薪資）排名，沒有業績的不列
    const top = R.staffRanking(msg.guild.id)
      .filter(s => s.share > 0)
      .sort((a, b) => b.share - a.share)
      .slice(0, 10);
    const list = top.length
      ? top.map((s, i) => `第 ${i + 1} 名：${mention(s.user_id)} ➜ \`${n(s.share)}\` 元`).join('\n')
      : '本月還沒有薪資紀錄。';
    await msg.reply({ embeds: [emb(msg.guild.id, {
      title: `📊 喚雨財務淨利報表 - ${f.month}`,
      color: COLOR.money,
      fields: [
        { name: '伺服器本月淨利潤', value: `\`${n(f.net)}\` 元` },
        { name: '🏆 陪玩本月薪資 Top 5', value: list.slice(0, 1000) }
      ],
      footer: `利潤已扣除 ${rate}% 陪玩分成及代金券成本`
    })] });
  },

  async 客服業績(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const [from = '', to = ''] = args.trim().split(/\s+/).filter(Boolean);
    const fix = d => (d ? d.replace(/^(\d{1,2})\/(\d{1,2})$/,
      (_, m, dd) => `${new Date().getFullYear()}-${m.padStart(2, '0')}-${dd.padStart(2, '0')}`) : '');
    const r = R.csRanking(msg.guild.id, fix(from), fix(to));
    const short = d => (d ? d.slice(5).replace('-', '/') : '不限');
    // 客服的業績主要來自結帳（訂單上的經辦客服），客服單的接單次數只是其中一部分；
    // 只看 cs_stats 會變成「按過接單按鈕幾次」，跟實際成交完全對不起來。
    const body = r.orders.length
      ? r.orders.map((x, i) =>
          `${i + 1}. ${mention(x.cs_id)} ➜ \`${n(x.amount)}\` 元（${n(x.cnt)} 單）`).join('\n')
      : '這個區間還沒有結帳紀錄。';
    const tickets = r.tickets.length
      ? '\n\n────────────────\n🎫 **客服單接單次數**\n'
        + r.tickets.map(x => `・${mention(x.cs_id)} ➜ \`${n(x.cnt)}\` 次`).join('\n')
      : '';
    await msg.reply({ embeds: [money(msg.guild.id, '📊 喚雨｜客服業績排行榜',
      `📅 **結算區間：** \`${short(fix(from))}\` ~ \`${short(fix(to)) === '不限' ? '今天' : short(fix(to))}\`\n\n`
      + `${body}${tickets}`.slice(0, 3600))] });
  },

  async 清空客服業績(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const c = db.prepare('DELETE FROM cs_stats WHERE guild_id=?').run(orgOf(msg.guild.id)).changes;
    audit(msg.author.tag, '清空客服業績', `${c} 筆`, msg.guild.id);
    await msg.reply({ embeds: [ok(msg.guild.id, '已清空', `共清除 ${c} 筆客服獨立業績紀錄。`)] });
  },

  // ---------- 日常操作與管理 ----------
  // !結帳 @老闆 陪玩 原價 [折抵]
  async 結帳(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    // 第一個 mention／長數字是老闆，其餘依序是 陪玩 原價 折抵
    // （不能用整串 replace：陪玩若填 Discord ID 會被誤刪）
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const bossAt = tokens.findIndex(t => /^<@!?\d{15,25}>$/.test(t) || /^\d{15,25}$/.test(t));
    const target = bossAt < 0 ? null : tokens[bossAt].replace(/\D/g, '');
    const [staffKey, listRaw, discountRaw] = tokens.filter((_, i) => i !== bossAt);
    if (!target || !staffKey || listRaw === undefined)
      throw new Error('用法：`!結帳 @老闆 陪玩代號 訂單原價 [折抵]`（支付方式改由按鈕選）');
    const s = findStaff(msg.guild.id, staffKey);
    if (!s) throw new Error(`查無陪玩「${staffKey}」`);
    const list = Number(listRaw);
    const discount = discountRaw === undefined ? 0 : Number(discountRaw);
    if (!Number.isFinite(list) || !Number.isFinite(discount)) throw new Error('訂單原價與折抵必須是數字。');
    if (discount > list) throw new Error('折抵金額不可大於訂單原價。');

    // 跟 /結帳 走同一套流程：選券 → 預覽 → 現金／雨幣／取消
    const CF = require('../util/checkout-flow');
    const { payload } = CF.start({
      guildId: msg.guild.id,
      customerId: target, customerName: msg.mentions.users.first()?.username || '',
      staffId: s.user_id, staffName: s.name || s.code,
      csId: msg.author.id, csName: msg.author.tag,
      item: '陪玩服務', qty: 1, list, manualDiscount: discount,
      prefix: true   // 前綴指令的流程是公開訊息，成立後不公開拆帳明細
    });
    await msg.channel.send(payload);
    if (msg.deletable) await msg.delete().catch(() => {});
  },

  async 核銷(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const no = args.trim().split(/\s+/)[0];
    if (!no) throw new Error('請輸入訂單編號，例如 `!核銷 ORD-63876816`');
    const o = M.settleOrder(msg.guild.id, no, msg.author.tag);
    await msg.reply({ embeds: [ok(msg.guild.id, '訂單核銷成功',
      `訂單 \`${no}\` 已由 ${mention(msg.author.id)} 核銷完畢。\n`
      + `陪玩 ${mention(o.staff_id)} 的暫存薪水已轉入可提領帳戶！`)] });
  },

  async 未銷(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    await msg.reply(panels.unsettledPage(msg.guild.id, 0));
  },

  // 在訂單包廂裡打 !結單＝收掉這張單；在其他頻道打＝發今日已結單的公告
  async 結單(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const t = panels.ticketOfChannel(msg.guild.id, msg.channelId);
    if (t) {
      await panels.closeTicket(msg.guild, msg.channel, t);
      await msg.channel.send(panels.closedNotice(msg.guild.id, t.id));
      if (msg.deletable) await msg.delete().catch(() => {});
      return;
    }

    // 在名片專區打 !結單：要結的是那張正單，歸檔老闆的包廂而不是名片專區
    const c = panels.ticketOfCardChannel(msg.guild.id, msg.channelId);
    if (c) {
      const boss = await msg.guild.channels.fetch(c.channel_id).catch(() => null);
      await panels.closeTicket(msg.guild, boss, c);
      if (boss) await boss.send(panels.closedNotice(msg.guild.id, c.id)).catch(() => {});
      await msg.channel.send({ embeds: [ok(msg.guild.id, '訂單已結單',
        '已收掉老闆的包廂並歸檔，本名片專區留著給陪玩查訂單編號。')] });
      if (msg.deletable) await msg.delete().catch(() => {});
      return;
    }

    // 查不到單但頻道長得像訂單包廂（舊系統搬過來的）也照樣歸檔，不要退回去發公告
    if (panels.looksLikeOrderRoom(msg.guild.id, msg.channel)) {
      const legacy = { id: 0, guild_id: msg.guild.id, customer_id: '', card_channel_id: '', service: '', seq: 0 };
      await panels.closeTicket(msg.guild, msg.channel, legacy);
      await msg.channel.send(panels.closedNotice(msg.guild.id, 0));
      if (msg.deletable) await msg.delete().catch(() => {});
      return;
    }
    await msg.channel.send({ embeds: [emb(msg.guild.id, {
      title: '🛑 目前已結單',
      desc: '**請停止下單和聊天。**\n\n今日營業已結束，感謝各位老闆的支持 💜\n有任何問題請等待下次開單或私訊客服。',
      color: COLOR.err
    })] });
    if (msg.deletable) await msg.delete().catch(() => {});
  },

  // ---------- 喚雨星象 ----------
  async 抽籤(msg) {
    const L = require('../util/lottery');
    const r = L.draw(msg.guild.id, msg.author.id, msg.author.tag);
    await msg.reply({ embeds: [panels.lotteryEmbed(msg.guild.id, r)] });
  },

  async 離職(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const key = args.trim();
    if (!key) throw new Error('請輸入員工名稱或代號，例如 `!離職 小雨`');
    const s = findStaff(msg.guild.id, key);
    if (!s) throw new Error(`查無員工「${key}」`);
    db.transaction(() => {
      db.prepare('DELETE FROM staff WHERE id = ?').run(s.id);
      db.prepare('DELETE FROM intimacy WHERE guild_id=? AND staff_id=?').run(orgOf(msg.guild.id), s.user_id);
      db.prepare('DELETE FROM gift_logs WHERE guild_id=? AND staff_id=?').run(orgOf(msg.guild.id), s.user_id);
    })();
    audit(msg.author.tag, '離職', `${s.name}(${s.code}) ${s.user_id}`, msg.guild.id);
    await msg.reply(`🗑️ 已將員工 **${s.name || s.code}** 從正式名單中除名！`);
  },

  async 刷新人事(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const c = require('./index').refreshRoster(msg.guild.id);
    await msg.reply({ embeds: [ok(msg.guild.id, '人事名單已刷新', `目前在職：陪玩 ${c.player} 位、客服 ${c.cs} 位。`)] });
  },

  // ---------- 金庫調整（管理員）----------
  async 儲值(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    const rest = args.replace(/<@!?\d+>/g, '').trim();
    const amount = Number((rest.match(/-?\d+/) || [])[0]);
    if (!target || !Number.isFinite(amount))
      throw new Error('用法：`!儲值 @老闆 1000 匯款後五碼`');
    // 金額之後剩下的字就是匯款憑證（後五碼／匯款時間），儲值必填
    const proof = rest.replace(String(amount), '').trim();
    require('../util/money').checkTopupProof(amount, proof);
    const bal = addCoins(msg.guild.id, target, amount, '人工儲值',
      { operator: msg.author.tag, allowNegative: false, proof });
    await msg.reply({ embeds: [ok(msg.guild.id, '儲值完成', `${mention(target)} ${amount > 0 ? '+' : ''}${n(amount)} 雨幣\n`
      + `${proof ? `匯款憑證：\`${proof}\`\n` : ''}目前餘額：**${n(bal)}**`)] });
  },

  async 扣款(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    const amount = Math.abs(Number((args.replace(/<@!?\d+>/g, '').match(/-?\d+/) || [])[0]));
    if (!target || !Number.isFinite(amount)) throw new Error('用法：`!扣款 @老闆 500`');
    const bal = addCoins(msg.guild.id, target, -amount, '人工扣款', { operator: msg.author.tag });
    await msg.reply({ embeds: [ok(msg.guild.id, '扣款完成', `${mention(target)} -${n(amount)} 雨幣\n目前餘額：**${n(bal)}**`)] });
  },

  // ---------- 冠名／身份組期限 ----------
  // !冠名 名稱 @客人 @陪玩 30天 [備註...]　　!身份組 名稱 @對象 30天 [備註...]
  async 冠名(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const T = require('../util/titles');
    const users = [...msg.mentions.users.values()];
    const rest = args.replace(/<@!?\d+>/g, ' ').trim().split(/\s+/).filter(Boolean);
    const usage = '用法：`!冠名 往後餘生 @客人 @陪玩 30天 [備註]`\n'
                + '接棒（排在該陪玩目前最晚一筆之後）加上 `接棒`';
    if (users.length < 2) throw new Error(usage);

    let days = 0, queue = false; const words = [];
    for (const w of rest) {
      const m = w.match(/^(\d+)\s*天?$/);
      if (m && !days) days = Number(m[1]);
      else if (/^接棒$/.test(w)) queue = true;
      else words.push(w);
    }
    const name = words.shift();
    if (!name || !days) throw new Error(usage);
    const t = T.addTitle(msg.guild.id, {
      kind: 'title', name, days, queueAfter: queue,
      customerId: users[0].id, customerName: users[0].username,
      staffId: users[1].id, staffName: users[1].username,
      note: words.join(' '), operator: msg.author.tag, srcGuild: msg.guild.id
    });
    await msg.reply({ embeds: [ok(msg.guild.id, `冠名已建立（#${t.id}）`, T.titleBlock(t))] });
  },

  async 身份組(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const T = require('../util/titles');
    const u = msg.mentions.users.first();
    const rest = args.replace(/<@!?\d+>/g, ' ').trim().split(/\s+/).filter(Boolean);
    const usage = '用法：`!身份組 甜度超標使者 @對象 3天 [備註]`';
    if (!u) throw new Error(usage);
    let days = 0; const words = [];
    for (const w of rest) {
      const m = w.match(/^(\d+)\s*天?$/);
      if (m && !days) days = Number(m[1]); else words.push(w);
    }
    const name = words.shift();
    if (!name || !days) throw new Error(usage);
    const t = T.addTitle(msg.guild.id, {
      kind: 'role', name, days, targetId: u.id, targetName: u.username,
      note: words.join(' '), operator: msg.author.tag, srcGuild: msg.guild.id
    });
    await msg.reply({ embeds: [ok(msg.guild.id, `身份組期限已建立（#${t.id}）`, T.titleBlock(t))] });
  },

  // !冠名列表 [冠名|身份組] [關鍵字]
  async 冠名列表(msg, args) {
    const T = require('../util/titles');
    const a = args.trim();
    const kind = /身份組/.test(a) ? 'role' : (/冠名/.test(a) ? 'title' : '');
    const q = a.replace(/冠名|身份組/g, '').trim();
    const { rows, total } = T.listTitles(msg.guild.id, { kind, q, limit: 25 });
    if (!rows.length) return msg.reply({ embeds: [ok(msg.guild.id, '目前沒有進行中的紀錄', '　')] });
    const body = rows.map(t => T.titleBlock(t)).join('\n' + '─'.repeat(28) + '\n');
    await msg.reply({ embeds: [emb(msg.guild.id, {
      title: `🏷️ 冠名／身份組（進行中 ${total} 筆${total > 25 ? '，顯示前 25 筆' : ''}）`,
      desc: body.slice(0, 4000)
    })] });
  },

  async 結束冠名(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const T = require('../util/titles');
    const id = Number((args.match(/\d+/) || [])[0]);
    if (!id) throw new Error('用法：`!結束冠名 12`（編號用 `!冠名列表` 查）');
    const t = T.endTitle(msg.guild.id, id, msg.author.tag);
    await msg.reply({ embeds: [ok(msg.guild.id, '已提前結束', `#${id}　${t.name}`)] });
  },

  // 報錯單時把報單紀錄清掉，讓陪玩重新報一次
  async 取消報單(msg, args) {
    const no = (args.trim().split(/\s+/)[0] || '').toUpperCase();
    if (!no) throw new Error('用法：`!取消報單 ORD-16072444`');
    const o = M.getOrder(msg.guild.id, no);
    if (!o) throw new Error(`查無訂單 ${no}`);
    // 客服／管理員，或這張單的陪玩、原報單者本人
    const mine = [o.staff_id, o.reporter_id].filter(Boolean).includes(msg.author.id);
    if (!mine && !isCS(msg.member)) throw new Error('只有這張單的陪玩本人或客服可以取消報單。');
    M.unreportOrder(msg.guild.id, no, msg.author.tag);
    await msg.reply({ embeds: [ok(msg.guild.id, '報單已取消',
      `訂單 \`${o.order_no}\` 的報單紀錄已清除，可以重新報單了。`)] });
  },

  // 用法：!發券 @老闆 名稱 100 [滿1000] [到2026-12-31]
  // 金額寫「20%」就是打折券；同名的券會累加張數
  async 發券(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const G = require('../util/gifts');
    const target = firstId(msg, args);
    const rest = args.replace(/<@!?\d+>/g, '').replace(/\d{15,25}/, '').trim().split(/\s+/).filter(Boolean);
    const usage = '用法：`!發券 @老闆 新春折價券 100`\n'
                + '折扣券：`!發券 @老闆 週年慶 20%`\n'
                + '可選：`滿1000`（低消門檻）、`到2026-12-31`（到期日）、`x3`（張數）';
    if (!target || rest.length < 2) throw new Error(usage);

    let qty = 1, minSpend = 0, expires = null, amount = null, percent = 0;
    const nameParts = [];
    for (const w of rest) {
      let m;
      if ((m = w.match(/^滿(\d+)$/))) minSpend = Number(m[1]);
      else if ((m = w.match(/^到(\d{4}-\d{2}-\d{2})$/))) expires = m[1];
      else if ((m = w.match(/^[x×](\d+)$/i))) qty = Number(m[1]);
      else if ((m = w.match(/^(\d+)%$/))) percent = Number(m[1]);
      else if (/^\d+$/.test(w)) amount = Number(w);
      else nameParts.push(w);
    }
    const name = nameParts.join(' ');
    if (!name) throw new Error(usage);
    if (!percent && !amount) throw new Error(`請給折抵金額或折扣百分比。\n${usage}`);
    if (percent > 100) throw new Error('折扣百分比不能超過 100。');

    const key = `c${Date.now().toString(36)}`;   // 每次發券都是獨立一種，不會覆蓋既有的券
    G.addItem(msg.guild.id, target, { key, name, qty, value: amount || 0, percent, minSpend, expires });
    audit(msg.author.tag, '發券', `${mention(target)} ${name}×${qty}`, msg.guild.id);
    const detail = percent ? `折 ${percent}%` : `折抵 ${n(amount)} 元`;
    await msg.reply({ embeds: [ok(msg.guild.id, '折價券已發送',
      `${mention(target)} 收到 **${name}** ×${qty}\n`
      + `${detail}${minSpend ? `・滿 ${n(minSpend)}` : ''}${expires ? `・${expires} 到期` : ''}\n\n`
      + '老闆可到「地下金庫 → 查詢餘額」查看背包。')] });
  },

  async 退單(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const [no, ...rest] = args.trim().split(/\s+/);
    if (!no) throw new Error('用法：`!退單 訂單編號 [原因]`');
    const reason = rest.join(' ');
    const o = M.refundOrder(msg.guild.id, no, msg.author.tag, reason);
    const notice = require('../util/checkout').refundNotice(msg.guild.id, o,
      { reason, refundCoins: true, operator: msg.author.tag });
    await msg.reply({ embeds: [notice] });
    // 退單會動到錢，備份一份到金流紀錄頻道
    await require('../util/announce').financeLog(msg.guild.id, notice);
  },

  async 提領(msg, args) {
    const amount = Number((args.match(/\d+/) || [])[0]);
    if (!Number.isFinite(amount)) throw new Error('用法：`!提領 3000`');
    const w = M.requestWithdraw(msg.guild.id, msg.author.id, amount, msg.author.tag);
    await msg.reply({ embeds: [ok(msg.guild.id, '提領申請已送出', `編號 #${w.id}，金額 **${n(w.amount)}** 雨幣，等待管理員審核。`)] });
  },

  async 手冊(msg) {
    await msg.reply({ embeds: [emb(msg.guild.id, {
      title: '📖 喚雨 玩家手冊',
      desc: '下單流程、雨幣、VIP 等級、親密度、地盤、站規一次看懂：\nhttps://meow.crownai.ink/rules'
    })] });
  },

  async 指令(msg) {
    await msg.reply({ embeds: [helpEmbed(msg.guild.id)] });
  }
};

// 別名
handlers.歷史點單 = handlers.查點單;
handlers.金主榜 = handlers.消費榜;
handlers.金庫總覽 = handlers.全服雨幣;
handlers.help = handlers.指令;
handlers.玩家手冊 = handlers.手冊;
handlers.規則 = handlers.手冊;

// 面板建置指令（!sendrole / !setup-*）
Object.assign(handlers, panels.commands);

/**
 * 後台自訂的簡易指令（!售後 之類）。內建指令找不到時才會走到這裡，
 * 所以自訂指令永遠不會蓋掉系統原本的功能。
 */
function snippetHandler(guildId, name) {
  const SN = require('../util/snippets');
  const s = SN.find(guildId, name);
  if (!s) return null;
  return async msg => {
    if (s.cs_only && !isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    SN.bump(s.id);
    // 用一般訊息送，手機才複製得到（embed 在手機上選不起來）
    const chunks = SN.renderChunks(s);
    if (s.visible === 'public') {
      for (const c of chunks) await msg.channel.send({ content: c });
      return;
    }
    // 一般訊息沒有「只給一個人看」，所以改私訊本人，並把指令訊息收掉不洗版
    for (const c of chunks) {
      await msg.author.send({ content: c }).catch(() => {
        throw new Error('私訊傳送失敗，請先允許來自伺服器成員的私訊，或把這個指令改成「直接發到頻道」。');
      });
    }
    if (msg.deletable) await msg.delete().catch(() => {});
  };
}

module.exports = { handlers, snippetHandler };
