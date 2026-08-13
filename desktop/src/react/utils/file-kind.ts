import type { FileKind, FileSource } from '../types/file-ref';

export const EXT_TO_KIND: Record<string, FileKind> = {
  // image（包含老格式 ico / tiff / heic，统一归入 image；SVG 因走 XML 渲染单独一类）
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image',
  webp: 'image', bmp: 'image', avif: 'image', ico: 'image',
  tiff: 'image', tif: 'image', heic: 'image', heif: 'image',
  svg: 'svg',
  // video
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video', mkv: 'video',
  // audio
  mp3: 'audio', wav: 'audio', ogg: 'audio', flac: 'audio', m4a: 'audio', weba: 'audio',
  // docs
  pdf: 'pdf',
  docx: 'doc', xlsx: 'doc', xls: 'doc',
  md: 'markdown', markdown: 'markdown',
  // ── code / plain text ──
  // 任何非二进制的纯文本文件都映射到 'code'，由 PreviewEditor 用 language-data 自动判定高亮。
  // 未知 ext（如 .log / .env / .gitignore）也归入 'code'，language 取 ext 本身，匹配不到就当 txt。
  // JS/TS
  js: 'code', mjs: 'code', cjs: 'code', jsx: 'code',
  ts: 'code', mts: 'code', cts: 'code', tsx: 'code',
  // Web 前端
  html: 'code', htm: 'code', xhtml: 'code', vue: 'code', svelte: 'code', astro: 'code',
  css: 'code', scss: 'code', sass: 'code', less: 'code', styl: 'code', stylus: 'code',
  // 模板
  hbs: 'code', handlebars: 'code', pug: 'code', jade: 'code',
  ejs: 'code', erb: 'code', liquid: 'code',
  j2: 'code', jinja: 'code', jinja2: 'code',
  // 数据/序列化
  json: 'code', json5: 'code', jsonld: 'code', map: 'code', geojson: 'code', topojson: 'code', ndjson: 'code',
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
  kt: 'code', kts: 'code', scala: 'code', groovy: 'code', gradle: 'code',
  clj: 'code', cljc: 'code', cljx: 'code', cljs: 'code',
  // 脚本/动态
  py: 'code', pyw: 'code', rb: 'code', rake: 'code', rbx: 'code',
  pl: 'code', pm: 'code', perl: 'code',
  php: 'code', lua: 'code', tcl: 'code', vim: 'code',
  r: 'code', cr: 'code', crystal: 'code', dart: 'code',
  // 函数式/老
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
  // 现代/系统
  go: 'code', rs: 'code', rust: 'code',
  swift: 'code', m: 'code', mm: 'code',
  d: 'code', dylan: 'code', dyl: 'code', intr: 'code',
  haxe: 'code', hx: 'code',
  // 硬件描述
  v: 'code', verilog: 'code', sv: 'code', svh: 'code', systemverilog: 'code',
  vhd: 'code', vhdl: 'code',
  // 数据库/查询
  sql: 'code', cql: 'code', cypher: 'code', cyph: 'code',
  sparql: 'code', rq: 'code',
  protobuf: 'code', proto: 'code', gql: 'code', graphql: 'code',
  // 构建/部署
  dockerfile: 'code', docker: 'code',
  cmake: 'code', nginx: 'code',
  puppet: 'code',
  // 配置/纯文本（无高亮或 Properties files）
  properties: 'code', ini: 'code', in: 'code', cfg: 'code', conf: 'code', htaccess: 'code',
  log: 'code', tsv: 'code', txt: 'code',
  env: 'code',
  gitignore: 'code', gitattributes: 'code', dockerignore: 'code',
  editorconfig: 'code', npmrc: 'code', babelrc: 'code', prettierrc: 'code', eslintrc: 'code',
  // 字处理/老格式（纯文本路径，CM language-data 未注册，按 txt 展示）
  bib: 'code', tex: 'code', dtx: 'code',
  // 字节码/中间产物（CM 未注册的当 txt 展示）
  wat: 'code', wast: 'code', webassembly: 'code',
  // 其他 CM 已注册但常见场景
  diff: 'code', patch: 'code',
  csv: 'code',
  http: 'code', hxml: 'code',
  jl: 'code', julia: 'code',
  // 老
  asm: 'code', s: 'code',
};

export function inferKindByExt(ext: string | undefined): FileKind {
  if (!ext) return 'other';
  return EXT_TO_KIND[ext.toLowerCase()] ?? 'other';
}

export function kindOfFileName(name: string, mimeType?: string): FileKind {
  const lowerMime = String(mimeType || '').toLowerCase();
  if (lowerMime.startsWith('image/')) return lowerMime === 'image/svg+xml' ? 'svg' : 'image';
  if (lowerMime.startsWith('video/')) return 'video';
  if (lowerMime.startsWith('audio/')) return 'audio';
  return inferKindByExt(extOfName(name));
}

export function isMarkdownFileName(name: string | undefined): boolean {
  return inferKindByExt(extOfName(name || '')) === 'markdown';
}

const MEDIA_KINDS: ReadonlySet<FileKind> = new Set(['image', 'svg', 'video']);

export function isMediaKind(kind: FileKind): boolean {
  return MEDIA_KINDS.has(kind);
}

/**
 * 图片或 SVG —— 用于渲染侧 "这个扩展名是否要展示成 img" 的判断。
 * 中心表 EXT_TO_KIND 是唯一源，禁止组件自己维护 IMAGE_EXTS 私有表。
 */
export function isImageOrSvgExt(ext: string | undefined): boolean {
  if (!ext) return false;
  const kind = inferKindByExt(ext);
  return kind === 'image' || kind === 'svg';
}

export function isAudioFileName(name: string, mimeType?: string): boolean {
  return kindOfFileName(name, mimeType) === 'audio';
}

/**
 * 从文件名取扩展名（小写、不带点）。扩展名缺失返回 undefined。
 */
export function extOfName(name: string): string | undefined {
  if (!name) return undefined;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * 统一构造 FileRef.id。selector 和调用方共用同一算法，避免 id 分叉。
 * - desk：desk:<path>
 * - session-attachment：sess:<sessionKey>:<messageId>:att:<path>
 * - session-registry：sess:<sessionKey>:registry:<path>
 * - session-block-file：sess:<sessionKey>:<messageId>:block:<blockIdx>:<path>
 * - session-block-legacy-artifact：sess:<sessionKey>:<messageId>:legacy-artifact:<blockIdx>:<path>
 * - session-block-screenshot：sess:<sessionKey>:<messageId>:block:<blockIdx>:screenshot
 */
export function buildFileRefId(parts: {
  source: FileSource;
  sessionKey?: string;
  sessionPath?: string;
  messageId?: string;
  blockIdx?: number;
  path: string;
}): string {
  const sessionKey = parts.sessionKey || parts.sessionPath;
  switch (parts.source) {
    case 'desk':
      return `desk:${parts.path}`;
    case 'session-attachment':
      return `sess:${sessionKey}:${parts.messageId}:att:${parts.path}`;
    case 'session-registry':
      return `sess:${sessionKey}:registry:${parts.path}`;
    case 'session-block-file':
      return `sess:${sessionKey}:${parts.messageId}:block:${parts.blockIdx}:${parts.path}`;
    case 'session-block-legacy-artifact':
      return `sess:${sessionKey}:${parts.messageId}:legacy-artifact:${parts.blockIdx}:${parts.path}`;
    case 'session-block-screenshot':
      return `sess:${sessionKey}:${parts.messageId}:block:${parts.blockIdx}:screenshot`;
  }
}
