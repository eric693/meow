// ! 前綴指令（日常操作、查詢報表、面板建置）
const { AttachmentBuilder } = require('discord.js');
const { db, getCustomer, findStaff, getStaff, addCoins, monthPrefix, audit, orgOf } = require('../db');
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
    await msg.reply({ embeds: [money(msg.guild.id, '💰 消費紀錄', mention(target), [
      { name: '本月消費', value: `${n(s.month)} 雨幣（${s.month_count} 單）`, inline: true },
      { name: '歷史累計', value: `${n(s.total)} 雨幣（${s.total_count} 單）`, inline: true },
      { name: '禮物累計', value: `${n(s.gift_total)} 雨幣`, inline: true },
      { name: '雨幣餘額', value: n(s.coins), inline: true },
      { name: 'VIP 等級', value: `Lv.${s.vip_level}`, inline: true }
    ])] });
  },

  async 查點單(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    if (!target) throw new Error('請標記要查詢的老闆，例如 `!查點單 @老闆`');
    const rows = R.customerOrders(msg.guild.id, target, 25);
    const body = rows.length
      ? rows.map(o => `\`${o.order_no}\` ${o.created_at.slice(5, 16)} ${o.item || '—'} ×${o.qty} **${n(o.amount)}** ${o.status === 'settled' ? '✅' : o.status === 'refunded' ? '↩️' : '🕗'} <@${o.staff_id}>`).join('\n')
      : '這位老闆還沒有任何點單紀錄。';
    await msg.reply({ embeds: [emb(msg.guild.id, { title: '🧾 歷史點單', desc: `${mention(target)}\n\n${body.slice(0, 3800)}` })] });
  },

  async 消費榜(msg) {
    const r = R.spendRanking(msg.guild.id, 10);
    await msg.reply({ embeds: [money(msg.guild.id, '👑 金主榜', null, [
      { name: '全服歷史 VIP 總榜', value: rankLine(r.history, x => `${mention(x.user_id)} — **${n(x.total_spend)}**（VIP ${x.vip_level}）`) },
      { name: '本月消費大戶', value: rankLine(r.month, x => `${mention(x.user_id)} — **${n(x.amount)}**`) }
    ])] });
  },

  async 匯出消費總表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    await msg.reply({ content: '📤 全服金主消費總表與 VIP 等級紀錄：',
      files: [csv(`金主消費總表-${monthPrefix()}.csv`, toCSV(R.PATRON_COLUMNS, R.patronBoard(msg.guild.id)))] });
  },

  async 薪資查詢(msg, args) {
    const target = firstId(msg, args) || msg.author.id;
    if (target !== msg.author.id && !isCS(msg.member)) throw new Error('只有客服／管理員可以查詢他人薪資。');
    const s = getStaff(msg.guild.id, target);
    if (!s) throw new Error('查無此人的員工資料。');
    await msg.reply({ embeds: [money(msg.guild.id, '💵 薪資查詢', `**${s.name || s.code}**（${mention(target)}）`, [
      { name: '可提領 Income', value: n(s.income), inline: true },
      { name: '暫存 PendingIncome', value: n(s.pending_income), inline: true },
      { name: '歷史累計入帳', value: n(s.total_income), inline: true }
    ])] });
  },

  async 全服雨幣(msg) {
    const t = R.totalCoins(msg.guild.id);
    const pend = db.prepare("SELECT COALESCE(SUM(pending_income),0) p, COALESCE(SUM(income),0) i FROM staff WHERE guild_id=?").get(orgOf(msg.guild.id));
    await msg.reply({ embeds: [money(msg.guild.id, '🏦 地下金庫總覽', null, [
      { name: '流通雨幣總額', value: `${n(t.c)} 雨幣`, inline: true },
      { name: '持有人數', value: `${t.n} 位`, inline: true },
      { name: '陪玩可提領總額', value: n(pend.i), inline: true },
      { name: '陪玩暫存薪水總額', value: n(pend.p), inline: true }
    ])] });
  },

  async 雨幣查詢(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const target = firstId(msg, args);
    if (!target) throw new Error('請標記要查詢的老闆。');
    const c = getCustomer(msg.guild.id, target);
    await msg.reply({ embeds: [money(msg.guild.id, '🪙 雨幣餘額', `${mention(target)}\n\n**${n(c.coins)}** 雨幣`)] });
  },

  async 業績查詢(msg) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const rows = R.staffRanking(msg.guild.id);
    const body = rows.length
      ? rows.map((s, i) => `\`${String(i + 1).padStart(2)}\` **${s.name || s.code}** — 業績 ${n(s.amount)}（${s.cnt} 單）／分潤 ${n(s.share)}／可提領 ${n(s.income)}`).join('\n')
      : '本月還沒有業績。';
    await msg.reply({ embeds: [money(msg.guild.id, `📈 ${monthPrefix()} 陪玩業績結算`, body.slice(0, 3900))] });
  },

  async 匯出報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    await msg.reply({ content: `📤 ${monthPrefix()} 財務流水帳（含訂單／退單／系統調整）：`,
      files: [csv(`財務流水帳-${monthPrefix()}.csv`, toCSV(R.LEDGER_COLUMNS, R.ledgerQuery(msg.guild.id, { month: monthPrefix() }).rows))] });
  },

  async 匯出提領報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    await msg.reply({ content: `📤 ${monthPrefix()} 陪玩提領薪資明細：`,
      files: [csv(`提領明細-${monthPrefix()}.csv`, toCSV(R.WITHDRAW_COLUMNS, R.withdrawRows(msg.guild.id, { month: monthPrefix() })))] });
  },

  async 財務報表(msg) {
    if (!isAdmin(msg.member)) throw new Error('僅限管理員使用。');
    const f = R.financeReport(msg.guild.id);
    await msg.reply({ embeds: [money(msg.guild.id, `🧮 ${f.month} 財務淨利對帳單`, null, [
      { name: '實收營收', value: `${n(f.revenue)}（${f.order_count} 筆）`, inline: true },
      { name: '其中禮物', value: `${n(f.gift_revenue)}（${f.gift_count} 筆）`, inline: true },
      { name: '折扣讓利', value: `-${n(f.discount)}`, inline: true },
      { name: '陪玩抽成', value: `-${n(f.staff_share)}`, inline: true },
      { name: '退單', value: `-${n(f.refund)}（${f.refund_count} 筆）`, inline: true },
      { name: '已提領', value: `${n(f.withdrawn)}（${f.withdraw_count} 筆）`, inline: true },
      { name: '伺服器淨利', value: `**${n(f.net)}** 雨幣`, inline: true },
      { name: '本月陪玩業績 Top 3', value: rankLine(f.top3, s => `**${s.name || s.code}** — ${n(s.amount)}`) }
    ])] });
  },

  async 客服業績(msg, args) {
    if (!isCS(msg.member)) throw new Error('僅限客服／管理員使用。');
    const [from = '', to = ''] = args.trim().split(/\s+/).filter(Boolean);
    const r = R.csRanking(msg.guild.id, from, to);
    const range = from || to ? `${from || '不限'} ~ ${to || '今天'}` : '全部區間';
    await msg.reply({ embeds: [money(msg.guild.id, '🎧 客服接單排行榜', `區間：${range}`, [
      { name: '接單傳票數', value: rankLine(r.tickets, x => `${mention(x.cs_id)} — **${x.cnt}** 單`) },
      { name: '經辦成交金額', value: rankLine(r.orders, x => `${x.cs_name || mention(x.cs_id)} — **${n(x.amount)}**（${x.cnt} 筆）`) }
    ])] });
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
    const rows = R.unsettled(msg.guild.id, 25);
    const body = rows.length
      ? rows.map(o => `\`${o.order_no}\` ${o.created_at.slice(5, 16)} ${mention(o.customer_id)} → <@${o.staff_id}> **${n(o.amount)}**`).join('\n')
      : '🎉 目前沒有未核銷的訂單。';
    await msg.reply({ embeds: [emb(msg.guild.id, { title: `🕗 未核銷訂單（前 ${rows.length} 筆）`, desc: body.slice(0, 3900), color: COLOR.warn })] });
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
    await msg.reply({ embeds: [ok(msg.guild.id, '已辦理離職',
      `**${s.name || s.code}** 已從公司名單移除，相關資料庫紀錄已永久刪除。\n（訂單流水帳保留供對帳）`)] });
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
