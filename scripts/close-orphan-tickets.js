#!/usr/bin/env node
// 把「頻道已經不存在、狀態卻還開著」的訂單標成已結單。
// 頻道被手動刪掉時沒人去更新狀態，這些列會一直卡在稽核報告裡。
// 只改 tickets.status，不碰頻道、不碰金額、不碰任何訂單帳務。
// 用法：node scripts/close-orphan-tickets.js          → 試算
//       node scripts/close-orphan-tickets.js --apply  → 寫入
require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { db, orgOf, now, audit } = require('../src/db');

const apply = process.argv.includes('--apply');
const GUILD = process.env.GUILD_ID;

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const rows = db.prepare(`SELECT id, seq, service, subject, channel_id, card_channel_id, publish, created_at
     FROM tickets WHERE guild_id=? AND src_guild=? AND status<>'closed' ORDER BY id`)
    .all(orgOf(GUILD), GUILD);

  const orphan = [], alive = [];
  for (const t of rows) {
    // 主頻道還在就是活的單，不能動；名片頻道被刪是正常的（結單流程會刪）
    const ch = t.channel_id ? await rest.get(Routes.channel(t.channel_id)).catch(() => null) : null;
    (ch ? alive : orphan).push(t);
  }

  console.log(`未結單的單共 ${rows.length} 張：頻道還在 ${alive.length} 張、頻道已不存在 ${orphan.length} 張\n`);
  alive.forEach(t => console.log(`  保留 #${t.seq} ${t.service}｜${t.subject}（${t.created_at}）`));
  if (!orphan.length) { console.log('\n✅ 沒有需要處理的殘留'); return; }
  console.log(`\n要標成已結單的 ${orphan.length} 張：`);
  orphan.forEach(t => console.log(`  #${t.seq} ${t.service}｜${t.subject}（${t.created_at}）`));

  if (!apply) { console.log('\n（試算模式，未寫入。確定要套用請加 --apply）'); return; }

  const up = db.prepare("UPDATE tickets SET status='closed', channel_id='', card_channel_id='' WHERE id=?");
  db.transaction(() => { for (const t of orphan) up.run(t.id); })();
  audit('系統維護', '結清頻道已刪除的訂單', `${orphan.length} 張`, GUILD, { source: 'script' });
  console.log(`\n✅ 已標成已結單 ${orphan.length} 張（只改狀態，未動任何頻道與帳務）`);
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
