// 一次性修正：backpack.percent 存的是「折掉幾 %」，但有一批券被填成「打幾折」
// （九折填 90，於是被算成折 90%、只付一折）。把 90/93/95 翻回 10/7/5。
// percent=1 的兩張是「指定稱呼」標記券，原意不明，不動。
const { db } = require('../src/db');

const stat = () => db.prepare(
  'SELECT percent, COUNT(*) c, SUM(qty) q FROM backpack WHERE percent>0 GROUP BY percent ORDER BY percent'
).all();

const before = stat();
db.transaction(() => {
  for (const p of [90, 93, 95]) db.prepare('UPDATE backpack SET percent=? WHERE percent=?').run(100 - p, p);
})();

console.log('before', before);
console.log('after ', stat());
