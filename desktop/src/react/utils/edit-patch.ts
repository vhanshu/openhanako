/**
 * edit-patch.ts — unified patch 解析与行号分配
 *
 * 后端 edit 工具 execute() 返回 details.patch（jsdiff generateUnifiedPatch 产物），
 * 形如：
 *   --- a/path/to/file
 *   +++ b/path/to/file
 *   @@ -10,7 +10,9 @@
 *    context 行
 *   -removed 行
 *   +added 行
 *
 * 这个模块把 patch 字符串解析成结构化数据：hunk header 里的起始行号 + 逐行
 * 分类（added/removed/context）+ 每行分配的行号。渲染侧只负责把结果拼成
 * 「旧行号 | 新行号 | 内容」三列。
 *
 * 不用 jsdiff 的 parsePatch：unified diff 本身就是阅读格式，hunk header 里有
 * 起始行号，按首字符分桶 + 状态机递增就能重建行号列。代码量小，依赖少。
 */

export type PatchLineKind = 'added' | 'removed' | 'context' | 'hunk' | 'header';

/** unified patch 文本中除行级内容外的两类元信息。 */
export interface FileHeaders {
  oldPath: string;
  newPath: string;
}

/** 一行带行号的结构化 patch 行：header/hunk 不计行号，added/removed/context 各计一侧或两侧。 */
export interface ParsedPatchLine {
  kind: PatchLineKind;
  text: string;
  /** 旧文件行号；added 行和纯元信息行为 undefined */
  oldLine?: number;
  /** 新文件行号；removed 行和纯元信息行为 undefined */
  newLine?: number;
}

export interface ParsedPatch {
  fileHeaders: FileHeaders | null;
  hunks: ParsedPatchLine[][];
  /** 所有 added / removed 行总数（汇总展示用） */
  totalAdded: number;
  totalRemoved: number;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseHunkHeader(line: string): { oldStart: number; oldLines: number; newStart: number; newLines: number } | null {
  const m = line.match(HUNK_HEADER_RE);
  if (!m) return null;
  return {
    oldStart: parseInt(m[1], 10),
    oldLines: m[2] ? parseInt(m[2], 10) : 1,
    newStart: parseInt(m[3], 10),
    newLines: m[4] ? parseInt(m[4], 10) : 1,
  };
}

/**
 * 把 unified patch 解析成结构化数据。
 *
 * 状态机：按行扫描，遇到 hunk header 时从 header 里重置 oldLine/newLine 计数器，
 * added 行只递增 newLine，removed 行只递增 oldLine，context 行递增两侧。
 * '\ No newline at end of file' 这类 '\' 开头的元信息行不计行号。
 * hunk header 之外的孤儿行（理论不该出现）被丢弃。
 */
export function parsePatch(rawLines: string[]): ParsedPatch {
  let fileHeaders: FileHeaders | null = null;
  const hunks: ParsedPatchLine[][] = [];
  let currentHunk: ParsedPatchLine[] | null = null;
  let oldLine = 0;
  let newLine = 0;
  let totalAdded = 0;
  let totalRemoved = 0;

  for (const raw of rawLines) {
    if (raw.startsWith('---')) {
      fileHeaders = { ...(fileHeaders || { oldPath: '', newPath: '' }), oldPath: raw.slice(4) };
      continue;
    }
    if (raw.startsWith('+++')) {
      fileHeaders = { ...(fileHeaders || { oldPath: '', newPath: '' }), newPath: raw.slice(4) };
      continue;
    }
    if (raw.startsWith('@@')) {
      if (currentHunk) hunks.push(currentHunk);
      currentHunk = [];
      const header = parseHunkHeader(raw);
      if (header) {
        oldLine = header.oldStart;
        newLine = header.newStart;
      }
      currentHunk.push({ kind: 'hunk', text: raw });
      continue;
    }
    // 以下都假定在某个 hunk 内
    if (!currentHunk) continue;

    if (raw.startsWith('+')) {
      currentHunk.push({ kind: 'added', text: raw, newLine });
      newLine++;
      totalAdded++;
    } else if (raw.startsWith('-')) {
      currentHunk.push({ kind: 'removed', text: raw, oldLine });
      oldLine++;
      totalRemoved++;
    } else if (raw.startsWith('\\')) {
      // '\ No newline at end of file'：元信息，不计行号
      currentHunk.push({ kind: 'context', text: raw });
    } else {
      currentHunk.push({ kind: 'context', text: raw, oldLine, newLine });
      oldLine++;
      newLine++;
    }
  }
  if (currentHunk) hunks.push(currentHunk);
  return { fileHeaders, hunks, totalAdded, totalRemoved };
}

/** 单个 hunk 的 added / removed 行数统计（渲染 hunk header 后的 +X -Y 用）。 */
export function hunkStats(hunk: ParsedPatchLine[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of hunk) {
    if (line.kind === 'added') added++;
    else if (line.kind === 'removed') removed++;
  }
  return { added, removed };
}
