/* 拡張パック「ターミナル」: カスタムタブのビューワー。
   メモタブはここで開く（内容は localStorage に自動保存）。
   ターミナル種別のタブがここに来たらターミナルへ送り返す。 */
(function () {
  var params = new URLSearchParams(location.search);
  var id = params.get('id') || '';
  var tabs = [];
  try {
    var v = JSON.parse(localStorage.getItem('kinako-custom-tabs') || '[]');
    if (Array.isArray(v)) tabs = v;
  } catch (e) {}
  var tab = null;
  for (var i = 0; i < tabs.length; i++) if (tabs[i].id === id) tab = tabs[i];
  var titleEl = document.getElementById('viewer-title');
  var msgEl = document.getElementById('viewer-msg');
  var memoEl = document.getElementById('memo');
  var delBtn = document.getElementById('viewer-delete');
  if (!tab) {
    if (titleEl) titleEl.textContent = 'タブが見つからない';
    if (msgEl) msgEl.textContent = 'このカスタムタブは消されたか、まだ作られていない。';
    if (memoEl) memoEl.classList.add('hidden');
    if (delBtn) delBtn.classList.add('hidden');
    return;
  }
  if (tab.type === 'terminal') { location.replace('terminal.html'); return; }
  document.title = tab.name + ' - きなこのサイト';
  if (titleEl) titleEl.textContent = tab.name;
  var key = 'kinako-custom-tab-content:' + tab.id;
  if (memoEl) {
    memoEl.value = localStorage.getItem(key) || '';
    memoEl.addEventListener('input', function () { localStorage.setItem(key, memoEl.value); });
  }
  if (delBtn) delBtn.addEventListener('click', function () {
    var next = tabs.filter(function (t) { return t.id !== tab.id; });
    localStorage.setItem('kinako-custom-tabs', JSON.stringify(next));
    try { localStorage.removeItem(key); } catch (e) {}
    location.href = '../../index.html';
  });
})();
