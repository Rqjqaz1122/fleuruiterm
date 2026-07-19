export type MarkdownInlineSegment =
  | { type: 'emphasis'; content: string }
  | { type: 'link'; content: string; href: string }
  | { type: 'strong'; content: string }
  | { type: 'text'; content: string }
  | { type: 'code'; content: string };

export type MarkdownBlock =
  | { type: 'blockquote'; content: string }
  | { type: 'code'; language: string; content: string }
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'paragraph'; content: string }
  | { type: 'rule' }
  | { type: 'table'; alignments: MarkdownTableAlignment[]; headers: string[]; rows: string[][] };

export type MarkdownTableAlignment = 'center' | 'left' | 'right' | null;

const fencedCodePattern = /^\s*(```|~~~)([^`]*)$/;
const fencedCodeClosingPattern = /^\s*(```|~~~)(.*)$/;
const headingPattern = /^(#{1,6})\s+(.+)$/;
const orderedListPattern = /^\s*\d+[.)]\s+(.+)$/;
const unorderedListPattern = /^\s*[-*+]\s+(.+)$/;
const blockquotePattern = /^\s*>\s?(.*)$/;
const rulePattern = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

export function parseMarkdownBlocks(content: string): MarkdownBlock[] {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fencedCodeMatch = line.match(fencedCodePattern);
    if (fencedCodeMatch) {
      const fenceMarker = fencedCodeMatch[1] ?? '```';
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length) {
        const closingMatch = (lines[index] ?? '').match(fencedCodeClosingPattern);
        if (closingMatch && closingMatch[1] === fenceMarker) {
          const trailingContent = (closingMatch[2] ?? '').trim();
          index += 1;
          if (trailingContent) {
            lines.splice(index, 0, trailingContent);
          }
          break;
        }
        codeLines.push(lines[index] ?? '');
        index += 1;
      }
      blocks.push({
        type: 'code',
        language: (fencedCodeMatch[2] ?? '').trim().split(/\s+/)[0] ?? '',
        content: codeLines.join('\n'),
      });
      continue;
    }

    const headingMatch = line.match(headingPattern);
    if (headingMatch) {
      const level = Math.min(headingMatch[1]?.length ?? 1, 6) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({
        type: 'heading',
        level,
        content: (headingMatch[2] ?? '').trim(),
      });
      index += 1;
      continue;
    }

    if (rulePattern.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (isTableHeader(lines, index)) {
      const tableRows: string[][] = [];
      const headers = splitTableRow(lines[index] ?? '');
      const alignments = splitTableAlignment(lines[index + 1] ?? '');
      index += 2;
      while (index < lines.length && isTableRow(lines[index] ?? '')) {
        tableRows.push(normalizeTableRow(splitTableRow(lines[index] ?? ''), headers.length));
        index += 1;
      }
      blocks.push({
        type: 'table',
        alignments: normalizeTableAlignments(alignments, headers.length),
        headers,
        rows: tableRows,
      });
      continue;
    }

    const unorderedListMatch = line.match(unorderedListPattern);
    const orderedListMatch = line.match(orderedListPattern);
    if (unorderedListMatch || orderedListMatch) {
      const ordered = Boolean(orderedListMatch);
      const items: string[] = [];
      while (index < lines.length) {
        const itemMatch = (lines[index] ?? '').match(
          ordered ? orderedListPattern : unorderedListPattern,
        );
        if (!itemMatch) {
          break;
        }
        items.push(itemMatch[1].trim());
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const quoteMatch = line.match(blockquotePattern);
    if (quoteMatch) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const nextQuoteMatch = (lines[index] ?? '').match(blockquotePattern);
        if (!nextQuoteMatch) {
          break;
        }
        quoteLines.push(nextQuoteMatch[1]);
        index += 1;
      }
      blocks.push({ type: 'blockquote', content: quoteLines.join('\n') });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && shouldContinueParagraph(lines[index] ?? '')) {
      paragraphLines.push(lines[index] ?? '');
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: paragraphLines.join('\n') });
  }

  return blocks;
}

export function parseMarkdownInline(content: string): MarkdownInlineSegment[] {
  const segments: MarkdownInlineSegment[] = [];
  let cursor = 0;

  while (cursor < content.length) {
    const codeEnd = content[cursor] === '`' ? content.indexOf('`', cursor + 1) : -1;
    if (codeEnd > cursor + 1) {
      segments.push({ type: 'code', content: content.slice(cursor + 1, codeEnd) });
      cursor = codeEnd + 1;
      continue;
    }

    const link = readLink(content, cursor);
    if (link !== null) {
      segments.push(link.segment);
      cursor = link.nextCursor;
      continue;
    }

    const strongEnd = content.startsWith('**', cursor) ? content.indexOf('**', cursor + 2) : -1;
    if (strongEnd > cursor + 2) {
      segments.push({ type: 'strong', content: content.slice(cursor + 2, strongEnd) });
      cursor = strongEnd + 2;
      continue;
    }

    const emphasisEnd =
      content[cursor] === '*' && content[cursor + 1] !== '*'
        ? content.indexOf('*', cursor + 1)
        : -1;
    if (emphasisEnd > cursor + 1) {
      segments.push({ type: 'emphasis', content: content.slice(cursor + 1, emphasisEnd) });
      cursor = emphasisEnd + 1;
      continue;
    }

    const nextSpecial = findNextSpecial(content, cursor + 1);
    segments.push({
      type: 'text',
      content: content.slice(cursor, nextSpecial === -1 ? content.length : nextSpecial),
    });
    cursor = nextSpecial === -1 ? content.length : nextSpecial;
  }

  return segments.length > 0 ? segments : [{ type: 'text', content }];
}

function readLink(
  content: string,
  cursor: number,
): { segment: MarkdownInlineSegment; nextCursor: number } | null {
  if (content[cursor] !== '[') {
    return null;
  }
  const labelEnd = content.indexOf(']', cursor + 1);
  if (labelEnd <= cursor + 1 || content[labelEnd + 1] !== '(') {
    return null;
  }
  const hrefEnd = content.indexOf(')', labelEnd + 2);
  if (hrefEnd <= labelEnd + 2) {
    return null;
  }
  const href = sanitizeMarkdownHref(content.slice(labelEnd + 2, hrefEnd).trim());
  if (!href) {
    return null;
  }
  return {
    segment: { type: 'link', content: content.slice(cursor + 1, labelEnd), href },
    nextCursor: hrefEnd + 1,
  };
}

function sanitizeMarkdownHref(href: string): string {
  return /^(https?:|mailto:)/i.test(href) ? href : '';
}

function findNextSpecial(content: string, cursor: number): number {
  const nextIndexes = ['`', '[', '*']
    .map((marker) => content.indexOf(marker, cursor))
    .filter((index) => index !== -1);
  return nextIndexes.length > 0 ? Math.min(...nextIndexes) : -1;
}

function shouldContinueParagraph(line: string): boolean {
  if (!line.trim()) {
    return false;
  }
  return !(
    fencedCodePattern.test(line) ||
    headingPattern.test(line) ||
    isTableRow(line) ||
    orderedListPattern.test(line) ||
    unorderedListPattern.test(line) ||
    blockquotePattern.test(line) ||
    rulePattern.test(line)
  );
}

function isTableHeader(lines: string[], index: number): boolean {
  const header = lines[index] ?? '';
  const separator = lines[index + 1] ?? '';
  return isTableRow(header) && splitTableRow(header).length > 1 && isTableSeparator(separator);
}

function isTableRow(line: string): boolean {
  return line.includes('|') && line.trim().replace(/\|/g, '').trim().length > 0;
}

function isTableSeparator(line: string): boolean {
  const cells = splitTableRow(line);
  return (
    cells.length > 1 &&
    cells.every((cell) => {
      const normalized = cell.trim();
      return /^:?-{3,}:?$/.test(normalized);
    })
  );
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim();
  const withoutOuterPipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  return withoutOuterPipes.split('|').map((cell) => cell.trim());
}

function splitTableAlignment(line: string): MarkdownTableAlignment[] {
  return splitTableRow(line).map((cell) => {
    const normalized = cell.trim();
    const left = normalized.startsWith(':');
    const right = normalized.endsWith(':');
    if (left && right) {
      return 'center';
    }
    if (right) {
      return 'right';
    }
    if (left) {
      return 'left';
    }
    return null;
  });
}

function normalizeTableAlignments(
  alignments: MarkdownTableAlignment[],
  columnCount: number,
): MarkdownTableAlignment[] {
  return Array.from({ length: columnCount }, (_, index) => alignments[index] ?? null);
}

function normalizeTableRow(cells: string[], columnCount: number): string[] {
  return Array.from({ length: columnCount }, (_, index) => cells[index] ?? '');
}
