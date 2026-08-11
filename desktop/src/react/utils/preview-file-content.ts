import type { PreviewItem } from '../types';

export const PREVIEWABLE_EXTS: Record<string, string> = {
  html: 'html', htm: 'html',
  md: 'markdown', markdown: 'markdown',
  js: 'code', ts: 'code', jsx: 'code', tsx: 'code',
  py: 'code', css: 'code', json: 'code', yaml: 'code', yml: 'code',
  xml: 'code', sql: 'code', sh: 'code', bash: 'code',
  txt: 'code',
  c: 'code', cpp: 'code', h: 'code', java: 'code',
  rs: 'code', go: 'code', rb: 'code', php: 'code',
  csv: 'csv', pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', xls: 'xlsx',
};

export const BINARY_PREVIEW_TYPES = new Set(['pdf']);

export interface PreviewReadResult {
  content: string;
  sourceUrl?: string;
  fileVersion?: PreviewItem['fileVersion'];
}

export async function readFileForPreviewType(filePath: string, previewType: string): Promise<PreviewReadResult | null> {
  const p = window.platform;
  if (!p) return null;
  if (previewType === 'file-info') {
    // file-info PreviewItem 用于“无法预览”或“读不到内容”的场景。它本身不渲染正文，
    // 但 OpenPreviewDocumentWatchBridge 的 refresh 路径会调本函数判断文件 IO 是否可用。
    // 不校验 filePath 时 react-effect 也能静默当成不可用，但为了负负得正、二进制
    // （比如 .exe）也不被误标，仍旧走一次 IPC。
    if (!filePath) return { content: '' };
    // 二选一：readFileSnapshot 拿到就认为文件存在（文本场景）；拿不到可能是二进制 / 超大，
    // 兑底 readFileBase64 确认文件存在与否（二进制场景）。
    try {
      const snapshot = await p.readFileSnapshot?.(filePath);
      if (snapshot) return { content: '', fileVersion: snapshot.version };
    } catch { /* ignore */ }
    try {
      const base64 = await p.readFileBase64?.(filePath);
      if (base64 != null) return { content: '' };
    } catch { /* ignore */ }
    return null;
  }
  if (previewType === 'docx') {
    const content = await p.readDocxHtml?.(filePath);
    return content == null ? null : { content };
  }
  if (previewType === 'xlsx') {
    const content = await p.readXlsxHtml?.(filePath);
    return content == null ? null : { content };
  }
  if (BINARY_PREVIEW_TYPES.has(previewType)) {
    const sourceUrl = p.getFileUrl?.(filePath);
    if (sourceUrl) return { content: '', sourceUrl };
    const content = await p.readFileBase64?.(filePath);
    return content == null ? null : { content };
  }

  const snapshot = await p.readFileSnapshot?.(filePath);
  if (snapshot) return { content: snapshot.content, fileVersion: snapshot.version };

  const content = await p.readFile?.(filePath);
  return content == null ? null : { content };
}

export async function readFileForPreviewWithVersion(filePath: string, ext: string): Promise<PreviewReadResult | null> {
  const normalizedExt = ext.replace(/^\./, '').toLowerCase();
  const previewType = PREVIEWABLE_EXTS[normalizedExt];
  if (!previewType) return null;
  return readFileForPreviewType(filePath, previewType);
}

export async function readFileForPreview(filePath: string, ext: string): Promise<string | null> {
  return (await readFileForPreviewWithVersion(filePath, ext))?.content ?? null;
}
