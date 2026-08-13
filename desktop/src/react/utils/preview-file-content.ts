import type { PreviewItem } from '../types';

export const PREVIEWABLE_EXTS: Record<string, string> = {
  // 专用预览器
  html: 'html', htm: 'html', xhtml: 'html',
  md: 'markdown', markdown: 'markdown',
  csv: 'csv', tsv: 'csv',
  pdf: 'pdf',
  docx: 'docx', xlsx: 'xlsx', xls: 'xlsx',

  // ── code 预览：一切纯文本文件走这里 ──
  // PreviewEditor 用 @codemirror/language-data 自动找语言定义；找到就有高亮，
  // 找不到就当 txt 纯文本展示（折叠/行号/查找照常工作）。
  // 这里登记的只是“知道是文本可以打开”的 ext；具体能不能高亮是 CodeMirror 的事。

  // JS / TS 全家桶
  js: 'code', mjs: 'code', cjs: 'code', jsx: 'code',
  ts: 'code', mts: 'code', cts: 'code', tsx: 'code',

  // Web 前端
  vue: 'code', svelte: 'code', astro: 'code',
  css: 'code', scss: 'code', sass: 'code', less: 'code',
  styl: 'code', stylus: 'code',

  // 模板
  hbs: 'code', handlebars: 'code', pug: 'code', jade: 'code',
  ejs: 'code', erb: 'code', liquid: 'code',
  j2: 'code', jinja: 'code', jinja2: 'code',

  // 数据 / 序列化
  json: 'code', json5: 'code', jsonld: 'code', map: 'code',
  geojson: 'code', topojson: 'code', ndjson: 'code',
  yaml: 'code', yml: 'code', toml: 'code',
  xml: 'code', xsl: 'code', xsd: 'code', rss: 'code', wsdl: 'code',

  // Shell
  sh: 'code', bash: 'code', zsh: 'code', ksh: 'code', fish: 'code',
  ps1: 'code', psd1: 'code', psm1: 'code',
  bat: 'code', cmd: 'code',

  // C/C++/系统
  c: 'code', h: 'code', ino: 'code',
  cpp: 'code', cc: 'code', cxx: 'code', hpp: 'code', hxx: 'code', hh: 'code',

  // JVM
  java: 'code', cs: 'code', csharp: 'code',
  kt: 'code', kts: 'code', scala: 'code',
  groovy: 'code', gradle: 'code',
  clj: 'code', cljc: 'code', cljx: 'code', cljs: 'code',

  // 脚本 / 动态
  py: 'code', pyw: 'code', rb: 'code', rake: 'code', rbx: 'code',
  pl: 'code', pm: 'code', perl: 'code',
  php: 'code', lua: 'code', tcl: 'code', vim: 'code',
  r: 'code', cr: 'code', crystal: 'code', dart: 'code',

  // 函数式 / 老
  hs: 'code', haskell: 'code',
  ml: 'code', mli: 'code', mll: 'code', mly: 'code', ocaml: 'code',
  fs: 'code', fsharp: 'code',
  ex: 'code', exs: 'code', erl: 'code', hrl: 'code', erlang: 'code',
  elm: 'code', cob: 'code', cobol: 'code', cpy: 'code',
  pas: 'code', pascal: 'code', pp: 'code',
  scm: 'code', ss: 'code', scheme: 'code',
  lisp: 'code', cl: 'code', el: 'code',
  edn: 'code', factor: 'code', sml: 'code', sig: 'code', fun: 'code',
  livescript: 'code', ls: 'code',
  coffee: 'code', coffeescript: 'code',
  forth: 'code', fth: 'code', '4th': 'code',

  // 现代 / 系统
  go: 'code', rs: 'code', rust: 'code',
  swift: 'code', m: 'code', mm: 'code',
  d: 'code', dylan: 'code', dyl: 'code', intr: 'code',
  haxe: 'code', hx: 'code',

  // 硬件描述
  v: 'code', verilog: 'code', sv: 'code', svh: 'code', systemverilog: 'code',
  vhd: 'code', vhdl: 'code',

  // 数据库 / 查询
  sql: 'code', cql: 'code', cypher: 'code', cyph: 'code',
  sparql: 'code', rq: 'code',
  protobuf: 'code', proto: 'code', gql: 'code', graphql: 'code',

  // 构建 / 部署
  dockerfile: 'code', docker: 'code',
  cmake: 'code', nginx: 'code',
  puppet: 'code',

  // 配置 / 纯文本
  properties: 'code', ini: 'code', in: 'code', cfg: 'code', conf: 'code',
  htaccess: 'code',
  log: 'code', txt: 'code',
  env: 'code',
  gitignore: 'code', gitattributes: 'code', dockerignore: 'code',
  editorconfig: 'code', npmrc: 'code', babelrc: 'code', prettierrc: 'code', eslintrc: 'code',

  // 字处理 / 排版
  bib: 'code', tex: 'code', dtx: 'code',
  wast: 'code', wat: 'code', webassembly: 'code',

  // 其他 CM 已注册 / 常见纯文本
  diff: 'code', patch: 'code',
  http: 'code', hxml: 'code',
  jl: 'code', julia: 'code',

  // 老 / 其他
  asm: 'code', s: 'code',
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
