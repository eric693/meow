#!/usr/bin/env node
// 比對每張已發布訂單「看得到頻道的身分組」與「派單規則算出來該標的身分組」。
// 唯讀，只列出差異。用法：node scripts/check-order-visibility.js [要看幾張，預設 30]
require('dotenv').config();
const { REST, Routes, PermissionsBitField } = require('discord.js');
const { db, getSetting, orgOf } = require('../src/db');
const P = require('../src/bot/panels');

const LIMIT = Number(process.argv[2]) || 30;
const GUILD = process.env.GUILD_ID;
const VIEW = PermissionsBitField.Flags.ViewChannel;

(async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const roles = await rest.get(Routes.guildRoles(GUILD));
  const byId = new Map(roles.map(r => [r.id, r]));
  const nameOf = id => (byId.get(id) || {}).name || `(已刪除的身分組 ${id})`;
  const cache = {
    find: f => roles.find(f),
    filter: f => { const m = new Map(roles.filter(f).map(r => [r.id, r])); m.map = fn => [...m.values()].map(fn); return m; },
    map: fn => roles.map(fn), get: id => byId.get(id), has: id => byId.has(id)
  };
  const guild = { id: GUILD, roles: { cache } };
  // 客服／管理／培訓這些本來就看得到，不算差異
  const staffish = new Set(['role_cs', 'role_admin', 'role_trainer']
    .flatMap(k => getSetting(k, '', GUILD).split(',')).map(x => x.trim()).filter(Boolean));

  // 只看這個群、還沒結單的單：結單會刪掉名片頻道並清空欄位，拿已結單的來比一定不一致。
  // 跨群開的單頻道在別的伺服器，身分組也是別群的，一起排除。
  const tickets = db.prepare(`SELECT * FROM tickets WHERE guild_id=? AND src_guild=?
                              AND publish IN ('public','anon') AND status<>'closed'
                              ORDER BY id DESC LIMIT ?`).all(orgOf(GUILD), GUILD, LIMIT);
  console.log(`比對最近 ${tickets.length} 張已發布的單\n`);
  let bad = 0, gone = 0;
  for (const t of tickets) {
    // 匿名單要看的是名片專區，不是老闆的包廂（包廂本來就不該讓陪玩看到）
    const chId = t.publish === 'anon' ? t.card_channel_id : t.channel_id;
    if (!chId) { console.log(`#${t.seq} ${t.service}｜${t.subject}：匿名單但沒有名片專區，陪玩看不到這張單`); bad++; continue; }
    const ch = await rest.get(Routes.channel(chId)).catch(() => null);
    if (!ch) { gone++; continue; }   // 頻道已被手動刪掉
    const canSee = new Set((ch.permission_overwrites || [])
      .filter(o => o.type === 0 && (BigInt(o.allow) & VIEW) === VIEW)   // type 0 = 身分組
      .map(o => o.id).filter(id => !staffish.has(id) && id !== GUILD));
    const should = new Set(P.routedPlayerRoles(guild, t));
    const extra = [...canSee].filter(x => !should.has(x));
    const missing = [...should].filter(x => !canSee.has(x));
    if (!extra.length && !missing.length) continue;
    bad++;
    console.log(`#${t.seq} ${t.service}｜${t.subject}｜${t.gender}｜${t.want_rank || '—'}  (${t.publish})`);
    if (extra.length) console.log(`   多看到：${extra.map(nameOf).join('、')}`);
    if (missing.length) console.log(`   看不到：${missing.map(nameOf).join('、')}`);
  }
  console.log(`\n${bad ? `❌ ${bad} 張單的頻道權限與該標的身分組不一致` : '✅ 全部一致'}`
    + (gone ? `（另有 ${gone} 張的頻道已刪除，略過）` : ''));
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
