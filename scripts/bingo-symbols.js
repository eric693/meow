#!/usr/bin/env node
// 把資料夾裡的 12 張圖上傳成伺服器自訂表情，並填進 BINGO 的圖案設定。
//
// 用法：node scripts/bingo-symbols.js <資料夾>            → 試算，只列出會做什麼
//       node scripts/bingo-symbols.js <資料夾> --apply    → 實際上傳並套用
//
// 圖片會照檔名排序取前 12 張。Discord 的限制：單張 256KB 以內、
// 建議 128×128、支援 png/jpg/gif；表情名稱只能用英數與底線。
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const { db, getSetting, setSetting, orgOf } = require('../src/db');

const dir = process.argv[2];
const apply = process.argv.includes('--apply');
const GUILD = process.env.GUILD_ID;
const MAX_BYTES = 256 * 1024;
const PREFIX = 'bingo';

if (!dir) { console.log('請指定資料夾：node scripts/bingo-symbols.js <資料夾> [--apply]'); process.exit(1); }
if (!fs.existsSync(dir)) { console.log(`找不到資料夾 ${dir}`); process.exit(1); }

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

(async () => {
  const files = fs.readdirSync(dir)
    .filter(f => MIME[path.extname(f).toLowerCase()])
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

  console.log(`資料夾 ${dir}：找到 ${files.length} 張圖`);
  if (files.length < 12) {
    console.log(`❌ 需要 12 張，只找到 ${files.length} 張。不足 12 種會讓中獎機率跑掉，先不處理。`);
    process.exit(1);
  }
  const use = files.slice(0, 12);
  if (files.length > 12) console.log(`（超過 12 張，只取前 12 張：${use.join('、')}）`);

  // webp 不是 Discord 表情支援的格式，先擋下來說清楚
  const bad = use.filter(f => path.extname(f).toLowerCase() === '.webp');
  if (bad.length) { console.log(`❌ Discord 表情不支援 webp，請先轉成 png：${bad.join('、')}`); process.exit(1); }

  const oversize = use.filter(f => fs.statSync(path.join(dir, f)).size > MAX_BYTES);
  if (oversize.length) {
    console.log('❌ 這幾張超過 Discord 的 256KB 上限，請先縮圖：');
    oversize.forEach(f => console.log(`   ${f}  ${(fs.statSync(path.join(dir, f)).size / 1024).toFixed(0)} KB`));
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const existing = await rest.get(Routes.guildEmojis(GUILD));
  console.log(`伺服器目前有 ${existing.length} 個自訂表情`);

  const plan = use.map((f, i) => ({ file: f, name: `${PREFIX}${i + 1}`, old: existing.find(e => e.name === `${PREFIX}${i + 1}`) }));
  plan.forEach(p => console.log(`  ${p.file}  →  :${p.name}:${p.old ? '（會覆蓋既有的同名表情）' : ''}`));

  if (!apply) { console.log('\n（試算模式，未上傳。確定要套用請加 --apply）'); return; }

  const ids = [];
  for (const p of plan) {
    if (p.old) await rest.delete(Routes.guildEmoji(GUILD, p.old.id)).catch(() => {});
    const buf = fs.readFileSync(path.join(dir, p.file));
    const image = `data:${MIME[path.extname(p.file).toLowerCase()]};base64,${buf.toString('base64')}`;
    const made = await rest.post(Routes.guildEmojis(GUILD), { body: { name: p.name, image } });
    ids.push(`<:${made.name}:${made.id}>`);
    console.log(`  ✅ ${p.file} → <:${made.name}:${made.id}>`);
  }
  setSetting('bingo_symbols', ids.join(','), orgOf(GUILD));
  console.log(`\n✅ 已上傳 12 個表情並套用到 BINGO。現在的圖案：\n   ${ids.join(' ')}`);
  console.log('   （要改回內建 emoji：把後台「系統設定 → BINGO → 圖案」清空即可）');
})().catch(e => { console.error('失敗：', e.message); process.exit(1); });
