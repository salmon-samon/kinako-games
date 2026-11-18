// 雑なMarkdown変換（2026-11-18）。自分が書く分だけ通ればいい。
// 対応: # ## ### 見出し、- リスト、[text](url) リンク、**太字**、`code`、```コードブロック```、段落。
function mdToHtml(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = s => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  const lines = src.split('\n');
  let html = '', inList = false, inCode = false;
  const codeBuf = [];
  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) { html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>'; inCode = false; codeBuf.length = 0; }
      else { closeList(); inCode = true; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) { closeList(); const lv = h[1].length; html += '<h' + lv + '>' + inline(h[2]) + '</h' + lv + '>'; continue; }
    if (/^\s*-\s+/.test(line)) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += '<li>' + inline(line.replace(/^\s*-\s+/, '')) + '</li>';
      continue;
    }
    closeList();
    if (line.trim() === '') continue;
    html += '<p>' + inline(line) + '</p>';
  }
  closeList();
  if (inCode) html += '<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>';
  return html;
}
