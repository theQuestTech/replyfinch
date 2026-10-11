// A small, safe Markdown subset for help articles: headings, paragraphs, lists, quotes,
// rules, **bold**, *italic*, `code`, [links](https://…) and ![images](https://…).
// Everything is HTML-escaped first, so article text can never inject markup or scripts.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function inline(text: string): string {
  let out = esc(text);
  // `code` first, kept aside so nothing inside it is formatted.
  const codes: string[] = [];
  out = out.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(`<code>${c}</code>`) - 1}\u0000`);
  out = out.replace(/!\[([^\]]*)\]\((https:\/\/[^\s)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  out = out.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  out = out.replace(/\*\*(?!\s)(.+?)(?<!\s)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*\w])\*(?![\s*])(.+?)(?<![\s*])\*(?![*\w])/g, '$1<em>$2</em>');
  out = out.replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1<em>$2</em>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i: string) => codes[Number(i)]!);
}

/** Article Markdown → safe HTML. `#` becomes <h2> (the page title is the <h1>). */
export function renderMarkdown(src: string): string {
  const out: string[] = [];
  let para: string[] = [];
  type List = { tag: 'ul' | 'ol'; items: string[] };
  let list = null as List | null; // widened: the flush helpers reassign it
  const flushPara = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flush = () => (flushPara(), flushList());

  for (const raw of src.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    let m: RegExpExecArray | null;
    if (!line.trim()) {
      flush();
    } else if ((m = /^(#{1,3})\s+(.+)$/.exec(line))) {
      flush();
      const level = m[1]!.length + 1;
      out.push(`<h${level}>${inline(m[2]!)}</h${level}>`);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      out.push('<hr>');
    } else if ((m = /^\s*[-*+]\s+(.*)$/.exec(line)) || (m = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line))) {
      const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
      flushPara();
      if (list?.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list!.items.push(m[1]!);
    } else if ((m = /^>\s?(.*)$/.exec(line))) {
      flush();
      out.push(`<blockquote>${inline(m[1]!)}</blockquote>`);
    } else if (list) {
      // A wrapped line continues the last list item.
      list.items[list.items.length - 1] += ` ${line.trim()}`;
    } else {
      para.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/** Plain text of an article, for search excerpts. */
export function markdownToText(src: string): string {
  return src
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*(#{1,3}|>|[-*+]|\d{1,3}[.)])\s+/gm, '')
    .replace(/^\s*(-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/(\*\*|\*|_|`)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function excerpt(src: string, max = 160): string {
  const t = markdownToText(src);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 20)).trimEnd()}…`;
}
