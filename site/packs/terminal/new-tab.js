/* 拡張パック「ターミナル」: 新規タブ機能。
   パックが有効なページにだけ build-site.mjs が読み込ませる。
   やること: 保存済みカスタムタブをタブバーに足す / 「＋ 新規タブ」ボタンで
   タブを作る（種類: ターミナル or メモ）。保存は localStorage。
   このスクリプトの置き場所（packs/terminal/）を自分の src から割り出すので、
   サイト本体のページからでもパック内のページからでも同じコードで動く。 */
(function () {
  var KEY = 'kinako-custom-tabs';
  var script = document.querySelector('script[src$="new-tab.js"]');
  var packDir = '';
  if (script) {
    var src = script.getAttribute('src');
    packDir = src.slice(0, src.length - 'new-tab.js'.length);
  }
  function loadTabs() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || '[]');
      return Array.isArray(v) ? v : [];
    } catch (e) { return []; }
  }
  function saveTabs(tabs) { localStorage.setItem(KEY, JSON.stringify(tabs)); }
  function tabUrl(tab) {
    if (tab.type === 'terminal') return packDir + 'terminal.html';
    return packDir + 'viewer.html?id=' + encodeURIComponent(tab.id);
  }
  function renderCustomTabs() {
    var nav = document.querySelector('nav.tabs');
    if (!nav) return;
    var old = nav.querySelectorAll('a.custom-tab');
    for (var i = 0; i < old.length; i++) old[i].remove();
    var btn = nav.querySelector('#pack-new-tab-btn');
    loadTabs().forEach(function (tab) {
      var a = document.createElement('a');
      a.className = 'tab custom-tab';
      a.href = tabUrl(tab);
      a.textContent = tab.name;
      a.setAttribute('data-tab-id', tab.id);
      nav.insertBefore(a, btn || null);
    });
  }
  function buildPanel() {
    var panel = document.createElement('div');
    panel.className = 'new-tab-panel hidden';
    panel.id = 'new-tab-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '新規タブを作成');
    var h = document.createElement('h3');
    h.textContent = '新規タブを作成（拡張パック）';
    panel.appendChild(h);
    var row = document.createElement('div');
    row.className = 'new-tab-row';
    var nameLabel = document.createElement('label');
    nameLabel.textContent = '名前';
    nameLabel.setAttribute('for', 'new-tab-name');
    var nameInput = document.createElement('input');
    nameInput.className = 'new-tab-input';
    nameInput.id = 'new-tab-name';
    nameInput.type = 'text';
    nameInput.maxLength = 20;
    nameInput.placeholder = 'あたらしいタブ';
    var typeLabel = document.createElement('label');
    typeLabel.textContent = '種類';
    typeLabel.setAttribute('for', 'new-tab-type');
    var typeSelect = document.createElement('select');
    typeSelect.className = 'new-tab-select';
    typeSelect.id = 'new-tab-type';
    var optT = document.createElement('option');
    optT.value = 'terminal'; optT.textContent = 'ターミナル';
    var optM = document.createElement('option');
    optM.value = 'memo'; optM.textContent = 'メモ';
    typeSelect.appendChild(optT);
    typeSelect.appendChild(optM);
    var createBtn = document.createElement('button');
    createBtn.className = 'new-tab-create';
    createBtn.type = 'button';
    createBtn.textContent = '作成して開く';
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'new-tab-cancel';
    cancelBtn.type = 'button';
    cancelBtn.textContent = '閉じる';
    row.appendChild(nameLabel); row.appendChild(nameInput);
    row.appendChild(typeLabel); row.appendChild(typeSelect);
    row.appendChild(createBtn); row.appendChild(cancelBtn);
    panel.appendChild(row);
    var list = document.createElement('ul');
    list.className = 'new-tab-list';
    panel.appendChild(list);
    function renderList() {
      list.textContent = '';
      var tabs = loadTabs();
      if (!tabs.length) {
        var li = document.createElement('li');
        li.className = 'new-tab-empty';
        li.textContent = 'カスタムタブはまだない。';
        list.appendChild(li);
        return;
      }
      tabs.forEach(function (tab) {
        var li = document.createElement('li');
        var span = document.createElement('span');
        span.textContent = tab.name + '（' + (tab.type === 'terminal' ? 'ターミナル' : 'メモ') + '）';
        var del = document.createElement('button');
        del.className = 'new-tab-del';
        del.type = 'button';
        del.textContent = '削除';
        del.addEventListener('click', function () {
          saveTabs(loadTabs().filter(function (t) { return t.id !== tab.id; }));
          try { localStorage.removeItem('kinako-custom-tab-content:' + tab.id); } catch (e) {}
          renderCustomTabs();
          renderList();
        });
        li.appendChild(span); li.appendChild(del);
        list.appendChild(li);
      });
    }
    createBtn.addEventListener('click', function () {
      var name = nameInput.value.trim() || 'あたらしいタブ';
      var tab = { id: 'ct-' + Date.now().toString(36), name: name, type: typeSelect.value };
      var tabs = loadTabs();
      tabs.push(tab);
      saveTabs(tabs);
      location.href = tabUrl(tab);
    });
    cancelBtn.addEventListener('click', function () { panel.classList.add('hidden'); });
    panel._renderList = renderList;
    return panel;
  }
  function init() {
    renderCustomTabs();
    var btn = document.getElementById('pack-new-tab-btn');
    if (!btn) return; // ボタンが無いページ（=パック無効の生成結果）ではここまで
    var header = document.querySelector('header.tabbar');
    if (!header) return;
    var panel = buildPanel();
    header.appendChild(panel);
    btn.addEventListener('click', function () {
      panel._renderList();
      panel.classList.toggle('hidden');
      var input = panel.querySelector('#new-tab-name');
      if (input && !panel.classList.contains('hidden')) input.focus();
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
