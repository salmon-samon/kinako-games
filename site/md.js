// Markdown変換（2026-11-18に仕上げた版）。外部ライブラリなし、単体で動く。
// 対応記法:
//   見出し # 〜 ######、段落（空行区切り、行の連結あり）
//   **太字** *斜体* ***太字斜体*** ~~打ち消し~~ `コード` ```コードブロック```
//   [リンク](url) ![画像](src) <https://自動リンク>
//   - 箇条書き（入れ子対応）、1. 番号リスト、- [ ] / - [x] タスクリスト
//   > 引用（中身も再帰で変換）、--- 水平線、| 表 |（GFM式、:--- で左/中央/右寄せ）
// テストは md.test.mjs。直したら必ずテストを通すこと。

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// インライン変換。コードスパンの中身は変換しないよう、先に退避して最後に戻す。
function inlineHtml(s) {
  const codes = [];
  s = s.replace(/`([^`\n]+)`/g, (m, c) => {
    codes.push('<code>' + escapeHtml(c) + '</code>');
    return '\u0000' + (codes.length - 1) + '\u0000';
  });
  s = escapeHtml(s);
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img src="$2" alt="$1">');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, '<a href="$1">$1</a>');
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_([^_\n]+)_/g, '$1<em>$2</em>');
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => codes[Number(i)]);
  return s;
}

// リスト項目の並びをHTMLにする。indent（空白数）で入れ子を判定する簡易版。
function listHtml(items) {
  // items: [{ indent, ordered, num, checked(null|bool), text }]
  let html = '';
  const stack = []; // { indent, tag }
  const closeTo = (indent) => {
    while (stack.length && stack[stack.length - 1].indent > indent) {
      html += '</li></' + stack.pop().tag + '>';
    }
  };
  for (const it of items) {
    const tag = it.ordered ? 'ol' : 'ul';
    if (!stack.length || it.indent > stack[stack.length - 1].indent) {
      html += '<' + tag + '>';
      stack.push({ indent: it.indent, tag });
    } else {
      closeTo(it.indent);
      if (stack.length && stack[stack.length - 1].tag !== tag) {
        html += '</li></' + stack.pop().tag + '><' + tag + '>';
        stack.push({ indent: it.indent, tag });
      } else {
        html += '</li>';
      }
      if (!stack.length) { html += '<' + tag + '>'; stack.push({ indent: it.indent, tag }); }
    }
    let inner = inlineHtml(it.text);
    if (it.checked !== null) {
      inner = '<input type="checkbox" disabled' + (it.checked ? ' checked' : '') + '> ' + inner;
      html += '<li class="task">' + inner;
    } else {
      html += '<li>' + inner;
    }
  }
  while (stack.length) html += '</li></' + stack.pop().tag + '>';
  return html;
}

function mdToHtml(src) {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let i = 0;
  const isBlank = (l) => /^\s*$/.test(l);
  const startsBlock = (l) =>
    /^```/.test(l) || /^#{1,6}\s/.test(l) || /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(l) ||
    /^>/.test(l) || /^(\s*)([-*+]|\d+[.)])\s/.test(l);

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }

    // コードブロック
    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // 閉じフェンス
      html += '<pre><code>' + escapeHtml(buf.join('\n')) + '</code></pre>';
      continue;
    }

    // 表（次の行が区切り行なら表）
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
        /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
      const splitRow = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map(c =>
        /^:-+:$/.test(c) ? 'center' : /^-+:$/.test(c) ? 'right' : /^:-+$/.test(c) ? 'left' : '');
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) { rows.push(splitRow(lines[i])); i++; }
      const cell = (tag, txt, a) =>
        '<' + tag + (a ? ' style="text-align:' + a + '"' : '') + '>' + inlineHtml(txt) + '</' + tag + '>';
      html += '<table><thead><tr>' + head.map((h, j) => cell('th', h, aligns[j])).join('') + '</tr></thead><tbody>';
      for (const r of rows) html += '<tr>' + head.map((_, j) => cell('td', r[j] ?? '', aligns[j])).join('') + '</tr>';
      html += '</tbody></table>';
      continue;
    }

    // 見出し
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { const lv = h[1].length; html += '<h' + lv + '>' + inlineHtml(h[2].trim()) + '</h' + lv + '>'; i++; continue; }

    // 水平線
    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { html += '<hr>'; i++; continue; }

    // 引用（連続行をまとめて再帰変換）
    if (/^>/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      html += '<blockquote>' + mdToHtml(buf.join('\n')) + '</blockquote>';
      continue;
    }

    // リスト（連続する項目をまとめる）
    if (/^(\s*)([-*+]|\d+[.)])\s/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (!m) break;
        const ordered = /\d/.test(m[2]);
        let text = m[3], checked = null;
        const t = text.match(/^\[([ xX])\]\s+(.*)$/);
        if (!ordered && t) { checked = t[1].toLowerCase() === 'x'; text = t[2]; }
        items.push({ indent: m[1].length, ordered, checked, text });
        i++;
      }
      html += listHtml(items);
      continue;
    }

    // 段落（空行かブロック開始まで連結）
    const buf = [line];
    i++;
    while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines[i]) &&
           !(/^\s*\|.*\|\s*$/.test(lines[i]) && i + 1 < lines.length && /-/.test(lines[i + 1] || ''))) {
      buf.push(lines[i]); i++;
    }
    html += '<p>' + inlineHtml(buf.join('\n')).replace(/\n/g, '<br>') + '</p>';
  }
  return html;
}

// node（build-notes.mjs / md.test.mjs）からも使えるように
if (typeof module !== 'undefined') module.exports = { mdToHtml };
