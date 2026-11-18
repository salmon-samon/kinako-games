// きなこのグラス：しずくをためる。数は localStorage に保存。
// 累計（のみほしても減らない）に応じてサイトの装飾が変わる（2026-11-18追加）。
// index.html から読み込まれる（2026-11-18にファイル分割）。
const MAX = 30;
const THRESHOLDS = [10, 30, 60, 100]; // この累計で tier が上がる
const cup = document.getElementById('cup');
const water = document.getElementById('water');
const countEl = document.getElementById('count');
const totalEl = document.getElementById('total');
const tierMsg = document.getElementById('tiermsg');
const msg = document.getElementById('cupmsg');
const dropBtn = document.getElementById('dropbtn');
const drinkBtn = document.getElementById('drinkbtn');
let n = parseInt(localStorage.getItem('kinako-drops') || '0', 10);
if (isNaN(n) || n < 0) n = 0;
if (n > MAX) n = MAX;
let total = parseInt(localStorage.getItem('kinako-drops-total') || '0', 10);
if (isNaN(total) || total < 0) total = 0;
function tier() {
  return THRESHOLDS.filter(th => total >= th).length;
}
function render() {
  countEl.textContent = n;
  totalEl.textContent = total;
  water.style.height = (n / MAX * 100) + '%';
  const full = n >= MAX;
  msg.textContent = full ? 'いっぱい！' : '';
  dropBtn.style.display = full ? 'none' : '';
  drinkBtn.style.display = full ? '' : 'none';
  const t = tier();
  document.body.className = t > 0 ? 'tier' + t : '';
  const next = THRESHOLDS[t];
  tierMsg.textContent = next === undefined
    ? '装飾ぜんぶそろった。でんせつのみず。'
    : '次の装飾まで あと ' + (next - total) + ' 滴';
  localStorage.setItem('kinako-drops', String(n));
  localStorage.setItem('kinako-drops-total', String(total));
}
function drop() {
  if (n >= MAX) return;
  const d = document.createElement('div');
  d.className = 'drop';
  cup.appendChild(d);
  setTimeout(() => d.remove(), 450);
  n++;
  total++;
  render();
}
dropBtn.addEventListener('click', drop);
cup.addEventListener('click', drop);
drinkBtn.addEventListener('click', () => { n = 0; render(); });
render();
