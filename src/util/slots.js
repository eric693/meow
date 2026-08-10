// 「娛樂4場」→ { item: '娛樂', qty: 4 }；沒寫數字就當 1
function parseSlots(text) {
  const s = String(text || '').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return { item: s.replace(/\d+(?:\.\d+)?.*$/, '').trim() || s, qty: m ? Number(m[1]) : 1 };
}

module.exports = { parseSlots };
