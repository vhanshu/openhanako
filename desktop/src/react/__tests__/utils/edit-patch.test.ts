import { describe, expect, it } from 'vitest';
import { parsePatch, hunkStats, parseHunkHeader } from '../../utils/edit-patch';

/** 把带尾换行的多行模板字符串转成行数组（去掉 JS 模板字符串自己带的缩进和首尾空行）。 */
function linesOf(raw: string): string[] {
  const lines = raw.replace(/^\n/, '').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  // 去掉公共前导缩进
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length));
  return lines.map(l => l.slice(indent));
}

describe('parseHunkHeader', () => {
  it('parses the four line counts', () => {
    expect(parseHunkHeader('@@ -10,7 +10,9 @@')).toEqual({
      oldStart: 10, oldLines: 7, newStart: 10, newLines: 9,
    });
  });

  it('defaults missing count to 1 (single-line hunk)', () => {
    expect(parseHunkHeader('@@ -5 +5 @@')).toEqual({
      oldStart: 5, oldLines: 1, newStart: 5, newLines: 1,
    });
  });

  it('returns null for non-hunk lines', () => {
    expect(parseHunkHeader('--- a/foo')).toBeNull();
    expect(parseHunkHeader(' context')).toBeNull();
  });
});

describe('parsePatch', () => {
  it('assigns line numbers: context advances both, added only new, removed only old', () => {
    const parsed = parsePatch(linesOf(`
      --- a/notes/a.md
      +++ b/notes/a.md
      @@ -3,5 +3,6 @@
       context
      -gone
      +fresh
       more
    `));
    expect(parsed.fileHeaders).toEqual({ oldPath: 'a/notes/a.md', newPath: 'b/notes/a.md' });
    expect(parsed.hunks).toHaveLength(1);
    const [hunk] = parsed.hunks;
    // hunk header 行：不计行号
    expect(hunk[0]).toEqual({ kind: 'hunk', text: '@@ -3,5 +3,6 @@' });
    expect(hunk.slice(1)).toEqual([
      { kind: 'context', text: ' context', oldLine: 3, newLine: 3 },
      { kind: 'removed', text: '-gone', oldLine: 4 },
      { kind: 'added', text: '+fresh', newLine: 4 },
      { kind: 'context', text: ' more', oldLine: 5, newLine: 5 },
    ]);
    expect(parsed.totalAdded).toBe(1);
    expect(parsed.totalRemoved).toBe(1);
  });

  it('does not advance line numbers on the no-newline marker', () => {
    const parsed = parsePatch(linesOf(`
      @@ -1,2 +1,2 @@
       a
      -b
      \\ No newline at end of file
      +c
      \\ No newline at end of file
    `));
    const [hunk] = parsed.hunks;
    expect(hunk.slice(1)).toEqual([
      { kind: 'context', text: ' a', oldLine: 1, newLine: 1 },
      { kind: 'removed', text: '-b', oldLine: 2 },
      { kind: 'context', text: '\\ No newline at end of file' },
      { kind: 'added', text: '+c', newLine: 2 },
      { kind: 'context', text: '\\ No newline at end of file' },
    ]);
    expect(parsed.totalAdded).toBe(1);
    expect(parsed.totalRemoved).toBe(1);
  });

  it('resets line numbers per hunk from each hunk header', () => {
    const parsed = parsePatch(linesOf(`
      @@ -1,2 +1,2 @@
       a
      -x
      +y
      @@ -10,1 +11,1 @@
       tail
    `));
    expect(parsed.hunks).toHaveLength(2);
    const [first, second] = parsed.hunks;
    // a(context 1/1) → x(removed old=2) → y(added new=2)
    expect(first.slice(1).map(l => l.oldLine ?? l.newLine)).toEqual([1, 2, 2]);
    expect(second[1]).toEqual({ kind: 'context', text: ' tail', oldLine: 10, newLine: 11 });
  });

  it('keeps hunk header even when its range cannot be parsed', () => {
    const parsed = parsePatch(['@@ -nope @@', ' a']);
    expect(parsed.hunks[0][0]).toEqual({ kind: 'hunk', text: '@@ -nope @@' });
  });

  it('returns empty result for empty input', () => {
    const parsed = parsePatch([]);
    expect(parsed.hunks).toEqual([]);
    expect(parsed.fileHeaders).toBeNull();
    expect(parsed.totalAdded).toBe(0);
    expect(parsed.totalRemoved).toBe(0);
  });
});

describe('hunkStats', () => {
  it('counts added and removed lines, ignoring hunk header and context', () => {
    const parsed = parsePatch(linesOf(`
      @@ -1,4 +1,4 @@
       a
      -b
      +c
      +d
       e
    `));
    expect(hunkStats(parsed.hunks[0])).toEqual({ added: 2, removed: 1 });
  });
});
