import { describe, expect, it } from 'vitest';

import { parseMarkdownBlocks } from './markdownRenderer';

describe('parseMarkdownBlocks', () => {
  it('renders shell logical OR and pipe operators as paragraph text', () => {
    const content =
      "<terminal-command>uname -a && echo '---' && sw_vers 2>/dev/null || uname -s | head -1";

    expect(parseMarkdownBlocks(content)).toEqual([{ type: 'paragraph', content }]);
  });

  it('renders fenced terminal blocks when the closing fence is followed by prose', () => {
    const blocks = parseMarkdownBlocks(
      '```terminal\ndir\n```已请求在当前本地终端执行 `dir` 命令。',
    );

    expect(blocks).toEqual([
      { type: 'code', language: 'terminal', content: 'dir' },
      { type: 'paragraph', content: '已请求在当前本地终端执行 `dir` 命令。' },
    ]);
  });

  it('parses markdown tables with column alignment', () => {
    const blocks = parseMarkdownBlocks(
      [
        '| Process | Memory | RSS |',
        '|---|---:|---:|',
        '| java -jar /app/fleurui-admin.jar | 13.2% | about 1.0 GiB |',
        '| mysqld | 4.2% | about 336 MiB |',
      ].join('\n'),
    );

    expect(blocks).toEqual([
      {
        type: 'table',
        headers: ['Process', 'Memory', 'RSS'],
        alignments: [null, 'right', 'right'],
        rows: [
          ['java -jar /app/fleurui-admin.jar', '13.2%', 'about 1.0 GiB'],
          ['mysqld', '4.2%', 'about 336 MiB'],
        ],
      },
    ]);
  });
});
