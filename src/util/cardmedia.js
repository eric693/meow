// 影音名片的檔案處理
// Discord CDN 連結會過期（?ex=&hm= 簽章），存進資料庫幾天後就變成「This content is no longer
// available」，直接拿去重傳會上傳到一個 36 bytes 的錯誤頁。這裡負責：
//   1. 過期連結用官方 refresh-urls API 換一條新的
//   2. 檔案下載到本機 uploads/cards 快取，之後就不再依賴那條連結
//   3. 影片用 ffmpeg 抽一張封面圖，名片卡才看得到畫面
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const DIR = path.join(__dirname, '..', '..', 'uploads', 'cards');
fs.mkdirSync(DIR, { recursive: true });

const isDiscordCdn = u => /^https?:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//i.test(u || '');
const key = u => crypto.createHash('md5').update(u).digest('hex').slice(0, 16);
const extOf = u => { try { return (path.extname(new URL(u).pathname) || '.bin').slice(0, 8).toLowerCase(); }
                     catch (_) { return '.bin'; } };
const CT = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm'
};

/** 過期的 Discord 附件連結換一條新的（換不到就原樣回傳） */
async function refreshUrl(url) {
  if (!isDiscordCdn(url) || !process.env.DISCORD_TOKEN) return url;
  try {
    const r = await fetch('https://discord.com/api/v10/attachments/refresh-urls', {
      method: 'POST',
      headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ attachment_urls: [url] })
    });
    if (!r.ok) return url;
    const j = await r.json();
    return j?.refreshed_urls?.[0]?.refreshed || url;
  } catch (_) { return url; }
}

/**
 * 把名片檔抓到本機並回傳 { file, poster }：
 *   file   本機檔案路徑（抓不到回 null，呼叫端就退回貼連結）
 *   poster 影片封面圖路徑（抽不出來回 null）
 */
async function fetchCard(url, { video = false } = {}) {
  if (!url) return { file: null, poster: null };
  const k = key(url);
  // 已經抓過就直接用（副檔名以第一次抓到的為準）
  let base = fs.readdirSync(DIR).filter(f => f.startsWith(k) && !f.includes('.poster.'))
    .map(f => path.join(DIR, f))[0] || '';

  if (!base) {
    let res = await fetch(url).catch(() => null);
    if (!res || !res.ok) {
      const fresh = await refreshUrl(url);
      res = fresh === url ? res : await fetch(fresh).catch(() => null);
    }
    if (!res || !res.ok) return { file: null, poster: null };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1024) return { file: null, poster: null };   // 錯誤頁不是檔案
    // Discord 會用 ?format=webp 之類的參數轉檔，副檔名以實際回傳的型別為準，
    // 不然貼上去的 .png 其實是 webp，embed 會顯示不出來
    base = path.join(DIR, k + (CT[(res.headers.get('content-type') || '').split(';')[0].trim()] || extOf(url)));
    fs.writeFileSync(base, buf);
  }
  const posterPath = base.replace(/\.[^.]+$/, '') + '.poster.jpg';

  if (!video) return { file: base, poster: null };
  if (!fs.existsSync(posterPath)) await makePoster(base, posterPath).catch(() => {});
  return { file: base, poster: fs.existsSync(posterPath) ? posterPath : null };
}

/** 用 ffmpeg 抽第 1 秒的畫面當封面（沒裝 ffmpeg 就當作沒有封面） */
function makePoster(video, out) {
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-ss', '1', '-i', video, '-frames:v', '1', '-vf', 'scale=640:-2', out],
      { timeout: 20000 }, err => (err ? reject(err) : resolve(out)));
  });
}

module.exports = { refreshUrl, fetchCard, isDiscordCdn };
