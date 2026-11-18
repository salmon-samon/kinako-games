// md.js のテスト。実行: node md.test.mjs（全部通れば OK と出す）
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mdToHtml } = require('./md.js');

let failed = 0;
function eq(name, md, expected) {
  const got = mdToHtml(md);
  if (got !== expected) {
    failed++;
    console.error('FAIL:', name);
    console.error('  md      :', JSON.stringify(md));
    console.error('  expected:', JSON.stringify(expected));
    console.error('  got     :', JSON.stringify(got));
  }
}
function includes(name, md, part) {
  const got = mdToHtml(md);
  if (!got.includes(part)) {
    failed++;
    console.error('FAIL:', name, '—', JSON.stringify(part), 'not in', JSON.stringify(got));
  }
}

eq('h1', '# 見出し', '<h1>見出し</h1>');
eq('h4', '#### 小見出し', '<h4>小見出し</h4>');
eq('段落', 'あいうえお', '<p>あいうえお</p>');
eq('段落の連結', '1行目\n2行目', '<p>1行目<br>2行目</p>');
eq('空行で段落分割', 'A\n\nB', '<p>A</p><p>B</p>');
includes('太字', '**太**', '<strong>太</strong>');
includes('斜体', '*斜*', '<em>斜</em>');
includes('太字斜体', '***両***', '<strong><em>両</em></strong>');
includes('打ち消し', '~~消~~', '<del>消</del>');
includes('インラインコード', '`x<y`', '<code>x&lt;y</code>');
includes('コード内は変換しない', '`**太字にならない**`', '<code>**太字にならない**</code>');
includes('リンク', '[例](https://example.com)', '<a href="https://example.com">例</a>');
includes('画像', '![alt](a.png)', '<img src="a.png" alt="alt">');
includes('自動リンク', '<https://example.com>', '<a href="https://example.com">https://example.com</a>');
includes('HTMLエスケープ', '<script>alert(1)</script>', '&lt;script&gt;');
eq('箇条書き', '- a\n- b', '<ul><li>a</li><li>b</li></ul>');
eq('番号リスト', '1. a\n2. b', '<ol><li>a</li><li>b</li></ol>');
includes('タスクリスト未', '- [ ] やる', '<li class="task"><input type="checkbox" disabled> やる</li>');
includes('タスクリスト済', '- [x] した', '<input type="checkbox" disabled checked> した</li>');
includes('入れ子リスト', '- a\n  - b', '<ul><li>a<ul><li>b</li></ul></li></ul>');
eq('引用', '> 引用文', '<blockquote><p>引用文</p></blockquote>');
eq('水平線', '---', '<hr>');
eq('コードブロック', '```\n<b>太字にならない</b>\n```', '<pre><code>&lt;b&gt;太字にならない&lt;/b&gt;</code></pre>');
includes('表ヘッダ', '| a | b |\n|---|---|\n| 1 | 2 |', '<table><thead><tr><th>a</th><th>b</th></tr></thead>');
includes('表セル', '| a | b |\n|---|---|\n| 1 | 2 |', '<td>1</td><td>2</td>');
includes('表右寄せ', '| a |\n|---:|\n| 1 |', '<td style="text-align:right">1</td>');
includes('表中央', '| a |\n|:---:|\n| 1 |', '<td style="text-align:center">1</td>');

if (failed) { console.error(failed + '件失敗'); process.exit(1); }
console.log('MD_TEST_ALL_OK');
