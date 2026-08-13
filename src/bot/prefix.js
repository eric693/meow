// ! 前綴指令（日常操作、查詢報表、面板建置）
const { AttachmentBuilder } = require('discord.js');
const { db, getCustomer, findStaff, getStaff, addCoins, monthPrefix, getNum, audit, orgOf } = require('../db');
const { emb, ok, err, money, COLOR, n, mention } = require('../util/embed');
const M = require('../util/money');
const R = require('../util/reports');
const { isAdmin, isCS } = require('./perm');
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
    const rows = db.prepare(`SELECT staff_id, SUM(amount) amt FROM orders
                             WHERE guild_id=? AND customer_id=? AND status!='refunded'
                             GROUP BY staff_id ORDER BY amt DESC LIMIT 25`)
      .all(orgOf(msg.guild.id), target);
    const c = getCustomer(msg.guild.id, target);
    const body = rows.length
      ? rows.map(r => `・${mention(r.staff_id)}：共消費 \`${n(r.amt)}\` 元`).join('\n')
        + `\n\n────────────────\n💰 **歷史總計消費：** \`${n(c.total_spend)}\` 元`
      : '這位老闆還沒有任何點單紀錄。';
    await msg.reply({ embeds: [emb(msg.guild.id, {
      title: `📋 ${c.name || target} 的專屬點單紀錄`,
      desc: body.slice(0, 3900)
    })] });
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
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
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
    const coupons = G.listBackpack(msg.guild.id, target).filter(x => x.value > 0 || x.percent > 0);
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

  async 匯出報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    await msg.reply({ content: `✅ **${monthPrefix()} 財務報表已成功匯出！**\n，請下載附件查看。`,
      files: [csv(`喚雨財務報表_${monthPrefix()}.csv`, toCSV(R.LEDGER_COLUMNS, R.ledgerQuery(msg.guild.id, { month: monthPrefix() }).rows))] });
  },

  async 匯出提領報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    await msg.reply({ content: `✅ **${monthPrefix()} 陪玩提領明細已成功匯出！**\n請下載附件查看。`,
      files: [csv(`喚雨提領明細_${monthPrefix()}.csv`, toCSV(R.WITHDRAW_COLUMNS, R.withdrawRows(msg.guild.id, { month: monthPrefix() })))] });
  },

  async 財務報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
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
    const body = r.tickets.length
      ? r.tickets.map((x, i) => `${i + 1}. ${mention(x.cs_id)} ➜ \`${n(x.cnt)}\` 次`).join('\n')
      : '這個區間還沒有接單紀錄。';
    await msg.reply({ embeds: [money(msg.guild.id, '📊 喚雨｜客服接單排行榜',
      `📅 **結算區間：** \`${short(fix(from))}\` ~ \`${short(fix(to)) === '不限' ? '今天' : short(fix(to))}\`\n\n${body}`.slice(0, 3900))] });
  },

  async 清空客服業績(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    const c = db.prepare('DELETE FROM cs_stats WHERE guild_id=?').run(orgOf(msg.guild.id)).changes;
    audit(msg.author.tag, '清空客服業績', `${c} 筆`, msg.guild.id);
    await msg.reply({ embeds: [ok(msg.guild.id, '已清空', `共清除 ${c} 筆客服獨立業績紀錄。`)] });
  },

  // ---------- 日常操作與管理 ----------
  // !結帳 @老闆 陪玩 原價 [折抵] [支付方式]
  async 結帳(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    // 第一個 mention／長數字是老闆，其餘依序是 陪玩 原價 折抵 支付方式
    // （不能用整串 replace：陪玩若填 Discord ID 會被誤刪）
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const bossAt = tokens.findIndex(t => /^<@!?\d{15,25}>$/.test(t) || /^\d{15,25}$/.test(t));
    const target = bossAt < 0 ? null : tokens[bossAt].replace(/\D/g, '');
    const [staffKey, listRaw, discountRaw, ...payParts] = tokens.filter((_, i) => i !== bossAt);
    if (!target || !staffKey || listRaw === undefined)
      throw new Error('用法：`!結帳 @老闆 陪玩代號 訂單原價 [折抵] [支付方式]`');
    const s = findStaff(msg.guild.id, staffKey);
    if (!s) throw new Error(`查無陪玩「${staffKey}」`);
    const list = Number(listRaw);
    const discount = discountRaw === undefined ? 0 : Number(discountRaw);
    if (!Number.isFinite(list) || !Number.isFinite(discount)) throw new Error('訂單原價與折抵必須是數字。');
    if (discount > list) throw new Error('折抵金額不可大於訂單原價。');

    const o = M.createOrder({
      guildId: msg.guild.id, customerId: target, staffId: s.user_id,
      csId: msg.author.id, csName: msg.author.tag, item: '陪玩服務', qty: 1,
      unitPrice: list - discount, listPrice: list, amount: list - discount,
      source: 'ticket', operator: msg.author.tag,
      payMethod: payParts.join(' ') || '雨幣扣款'
    });
    await msg.channel.send(checkoutMessage(msg.guild.id, o));
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

  async 結單(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    await msg.channel.send({ embeds: [emb(msg.guild.id, {
      title: '🛑 目前已結單',
      desc: '**請停止下單和聊天。**\n\n今日營業已結束，感謝各位老闆的支持 💜\n有任何問題請等待下次開單或私訊客服。',
      color: COLOR.err
    })] });
    if (msg.deletable) await msg.delete().catch(() => {});
  },

  async 離職(msg, args) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
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
    const amount = Number((args.replace(/<@!?\d+>/g, '').match(/-?\d+/) || [])[0]);
    if (!target || !Number.isFinite(amount)) throw new Error('用法：`!儲值 @老闆 1000`');
    const bal = addCoins(msg.guild.id, target, amount, '人工儲值', { operator: msg.author.tag, allowNegative: false });
    await msg.reply({ embeds: [ok(msg.guild.id, '儲值完成', `${mention(target)} ${amount > 0 ? '+' : ''}${n(amount)} 雨幣\n目前餘額：**${n(bal)}**`)] });
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
    const body = rows.map(t => `\`#${t.id}\`\n${T.titleBlock(t)}`).join('\n' + '─'.repeat(28) + '\n');
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
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    const [no, ...rest] = args.trim().split(/\s+/);
    if (!no) throw new Error('用法：`!退單 訂單編號 [原因]`');
    const o = M.refundOrder(msg.guild.id, no, msg.author.tag, rest.join(' '));
    await msg.reply({ embeds: [ok(msg.guild.id, `訂單 ${no} 已退單`, `已退還老闆 **${n(o.amount)}** 雨幣，並扣回陪玩分潤。`)] });
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

module.exports = { handlers };
