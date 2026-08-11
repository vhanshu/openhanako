const { pathToFileUrl } = require("./path-to-file-url.cjs");

let _hljs = null;
function _getHljs() {
  if (_hljs) return _hljs;
  try {
    const hljs = require("highlight.js/lib/core");
    const languages = {
      typescript: require("highlight.js/lib/languages/typescript"),
      javascript: require("highlight.js/lib/languages/javascript"),
      json: require("highlight.js/lib/languages/json"),
      bash: require("highlight.js/lib/languages/bash"),
      python: require("highlight.js/lib/languages/python"),
      go: require("highlight.js/lib/languages/go"),
      rust: require("highlight.js/lib/languages/rust"),
      java: require("highlight.js/lib/languages/java"),
      kotlin: require("highlight.js/lib/languages/kotlin"),
      swift: require("highlight.js/lib/languages/swift"),
      c: require("highlight.js/lib/languages/c"),
      cpp: require("highlight.js/lib/languages/cpp"),
      csharp: require("highlight.js/lib/languages/csharp"),
      css: require("highlight.js/lib/languages/css"),
      scss: require("highlight.js/lib/languages/scss"),
      xml: require("highlight.js/lib/languages/xml"),
      yaml: require("highlight.js/lib/languages/yaml"),
      ini: require("highlight.js/lib/languages/ini"),
      sql: require("highlight.js/lib/languages/sql"),
      markdown: require("highlight.js/lib/languages/markdown"),
      dockerfile: require("highlight.js/lib/languages/dockerfile"),
      makefile: require("highlight.js/lib/languages/makefile"),
      lua: require("highlight.js/lib/languages/lua"),
      php: require("highlight.js/lib/languages/php"),
      ruby: require("highlight.js/lib/languages/ruby"),
      dart: require("highlight.js/lib/languages/dart"),
      diff: require("highlight.js/lib/languages/diff"),
    };
    const aliases = { cs: languages.csharp, toml: languages.ini };
    for (const name of Object.keys(languages)) hljs.registerLanguage(name, languages[name]);
    for (const [name, fn] of Object.entries(aliases)) hljs.registerLanguage(name, fn);
    hljs.configure({ ignoreUnescapedHTML: true });
    _hljs = hljs;
    return _hljs;
  } catch {
    _hljs = null;
    return null;
  }
}

// 围栏 info 字符串 → highlight.js 注册名（与 React 端 markdown-highlight.ts 保持一致）。
const LANG_ALIASES = {
  ts: "typescript", typescript: "typescript",
  js: "javascript", javascript: "javascript", jsx: "javascript", tsx: "typescript",
  mjs: "javascript", cjs: "javascript",
  sh: "bash", bash: "bash", shell: "bash", zsh: "bash",
  py: "python", python: "python",
  golang: "go", go: "go",
  rs: "rust", rust: "rust",
  kt: "kotlin", kotlin: "kotlin",
  swift: "swift",
  c: "c", h: "c",
  cpp: "cpp", cxx: "cpp", cc: "cpp",
  csharp: "cs", cs: "cs",
  css: "css", scss: "scss", sass: "scss",
  html: "xml", htm: "xml", xml: "xml", svg: "xml", vue: "xml",
  yml: "yaml", yaml: "yaml",
  toml: "toml", sql: "sql",
  md: "markdown", markdown: "markdown",
  dockerfile: "dockerfile", docker: "dockerfile",
  makefile: "makefile", mk: "makefile",
  lua: "lua", php: "php",
  rb: "ruby", ruby: "ruby",
  dart: "dart", diff: "diff", patch: "diff",
};

function highlightScreenshotFence(content, info) {
  const hljs = _getHljs();
  if (!hljs) return null;
  const rawLang = String(info || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
  if (!rawLang) return null;
  const target = LANG_ALIASES[rawLang];
  if (target && hljs.getLanguage(target)) {
    try {
      const result = hljs.highlight(content, { language: target, ignoreIllegals: true });
      return { html: result.value, language: target };
    } catch { /* fall through */ }
  }
  try {
    const result = hljs.highlightAuto(content);
    if (result.language && result.language !== "plaintext") {
      return { html: result.value, language: result.language };
    }
  } catch { /* ignore */ }
  return null;
}

const EXPLICIT_PROTOCOL_RE = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;
const SAFE_IMAGE_URL_PROTOCOLS = new Set(["http:", "https:", "file:", "data:"]);
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function normalizePathSeparators(value) {
  return String(value).replace(/\\/g, "/");
}

function dirnamePortable(filePath) {
  const normalized = normalizePathSeparators(filePath);
  const slash = normalized.lastIndexOf("/");
  if (slash < 0) return null;
  if (slash === 0) return "/";
  return normalized.slice(0, slash);
}

function isAbsoluteLocalPath(value) {
  return value.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(value)
    || value.startsWith("\\\\")
    || value.startsWith("//");
}

function normalizeJoinedPath(pathname) {
  const normalized = normalizePathSeparators(pathname);
  const prefixMatch = normalized.match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+|\/)?/);
  const prefix = prefixMatch?.[0] || "";
  const rest = normalized.slice(prefix.length);
  const parts = [];

  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length > 0 && parts[parts.length - 1] !== "..") {
        parts.pop();
      } else if (!prefix) {
        parts.push(part);
      }
      continue;
    }
    parts.push(part);
  }

  if (!prefix) return parts.join("/");
  if (prefix.endsWith("/")) return `${prefix}${parts.join("/")}`;
  return parts.length ? `${prefix}/${parts.join("/")}` : prefix;
}

function decodeMarkdownPath(rawPath) {
  try {
    return decodeURI(rawPath);
  } catch {
    return rawPath;
  }
}

function splitResourceSuffix(raw) {
  const hash = raw.indexOf("#");
  const query = raw.indexOf("?");
  const indexes = [hash, query].filter(index => index >= 0);
  const splitAt = indexes.length ? Math.min(...indexes) : -1;
  if (splitAt < 0) return { pathname: raw, suffix: "" };
  return { pathname: raw.slice(0, splitAt), suffix: raw.slice(splitAt) };
}

function sanitizeImageUrl(raw) {
  const value = String(raw || "").trim();
  if (!value || !EXPLICIT_PROTOCOL_RE.test(value)) return null;
  try {
    const parsed = new URL(value);
    return SAFE_IMAGE_URL_PROTOCOLS.has(parsed.protocol) ? value : null;
  } catch {
    return null;
  }
}

function resolveLocalImagePath(rawPath, sourceFilePath) {
  const decodedPath = decodeMarkdownPath(String(rawPath || "").trim());
  if (!decodedPath) return null;
  if (isAbsoluteLocalPath(decodedPath)) return normalizeJoinedPath(decodedPath);

  const baseDir = dirnamePortable(sourceFilePath);
  if (!baseDir) return null;
  return normalizeJoinedPath(`${baseDir}/${decodedPath}`);
}

function resolveScreenshotMarkdownImageSrc(src, options = {}) {
  const trimmed = String(src || "").trim();
  if (!trimmed) return src;

  const safeUrl = sanitizeImageUrl(trimmed);
  if (safeUrl) return safeUrl;
  if (EXPLICIT_PROTOCOL_RE.test(trimmed)) return "";
  if (!options.sourceFilePath) return src;

  const { pathname, suffix } = splitResourceSuffix(trimmed);
  const resolvedPath = resolveLocalImagePath(pathname, options.sourceFilePath);
  if (!resolvedPath) return src;
  return `${pathToFileUrl(resolvedPath)}${suffix}`;
}

function markdownTableScrollWrapper(md) {
  const defaultTableOpen = md.renderer.rules.table_open
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  const defaultTableClose = md.renderer.rules.table_close
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.table_open = (tokens, idx, options, env, self) => (
    `<div class="markdown-table-scroll">\n${defaultTableOpen(tokens, idx, options, env, self)}`
  );

  md.renderer.rules.table_close = (tokens, idx, options, env, self) => (
    `${defaultTableClose(tokens, idx, options, env, self)}</div>\n`
  );
}

function decorateScreenshotMarkdownIt(md) {
  markdownTableScrollWrapper(md);
  screenshotCodeHighlight(md);
  const defaultImage = md.renderer.rules.image
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.image = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const src = token.attrGet("src");
    if (src) {
      token.attrSet("src", resolveScreenshotMarkdownImageSrc(src, {
        sourceFilePath: env?.sourceFilePath || null,
      }));
    }
    return defaultImage(tokens, idx, options, env, self);
  };
}

function screenshotCodeHighlight(md) {
  const defaultFence = md.renderer.rules.fence
    || ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info = token.info || "";
    if (info.trim().split(/\s+/)[0]?.toLowerCase() === "mermaid") {
      // mermaid 走截图自身的占位渲染，截图产物不内嵌 mermaid 图，这里原样交给默认规则。
      return defaultFence(tokens, idx, options, env, self);
    }
    const highlighted = highlightScreenshotFence(token.content, info);
    if (!highlighted) return defaultFence(tokens, idx, options, env, self);
    return `<div class="screenshot-code-block" data-lang="${highlighted.language}"><pre class="hljs"><code class="hljs language-${highlighted.language}">${highlighted.html}</code></pre></div>\n`;
  };
}

function splitMarkdownFrontMatter(markdown) {
  const text = String(markdown || "");
  const match = text.match(FRONT_MATTER_RE);
  if (!match) return { frontMatter: "", body: text };
  return { frontMatter: match[1] || "", body: text.slice(match[0].length) };
}

function parseCoverScalar(value) {
  const trimmed = String(value || "").trim().replace(/^["']|["']$/g, "");
  if (!trimmed) return undefined;
  if (/^-?\d+(?:\.\d+)?$/.test(trimmed)) {
    const number = Number(trimmed);
    if (Number.isFinite(number)) return number;
  }
  return trimmed;
}

function parseScreenshotMarkdownCover(markdown) {
  const { frontMatter } = splitMarkdownFrontMatter(markdown);
  if (!frontMatter) return null;
  const lines = frontMatter.split(/\r?\n/);
  const start = lines.findIndex(line => /^cover:\s*$/.test(line));
  if (start < 0) return null;
  const cover = {};
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() && !/^\s/.test(line)) break;
    const match = line.match(/^\s{2}([A-Za-z][A-Za-z0-9_]*):\s*(.*?)\s*$/);
    if (!match) continue;
    cover[match[1]] = parseCoverScalar(match[2]);
  }
  return typeof cover.image === "string" && cover.image.trim() ? cover : null;
}

function clampPercent(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(100, Math.max(0, number));
}

function clampHeight(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 320;
  return Math.min(720, Math.max(160, Math.round(number)));
}

function renderScreenshotMarkdownCover(cover, sourceFilePath) {
  if (!cover?.image) return "";
  const src = resolveScreenshotMarkdownImageSrc(cover.image, { sourceFilePath });
  if (!src) return "";
  const height = clampHeight(cover.displayHeight);
  const positionX = clampPercent(cover.positionX, 50);
  const positionY = clampPercent(cover.positionY, 50);
  return `<figure class="screenshot-cover screenshot-cover-bleed-x screenshot-cover-top" style="--screenshot-cover-height:${height}px"><div class="screenshot-cover-frame"><img src="${escapeAttr(src)}" style="object-position:${positionX}% ${positionY}%" /></div></figure>`;
}

function renderScreenshotMarkdownArticle(md, markdown, options = {}) {
  const parts = splitMarkdownFrontMatter(markdown);
  const cover = parseScreenshotMarkdownCover(markdown);
  const coverHTML = cover ? renderScreenshotMarkdownCover(cover, options.sourceFilePath || null) : "";
  return `${coverHTML}${md.render(parts.body, { sourceFilePath: options.sourceFilePath || null })}`;
}

function renderScreenshotCodeArticle(source, language) {
  const lang = typeof language === "string" && /^[A-Za-z0-9_+.-]+$/.test(language)
    ? ` class="language-${escapeAttr(language)}"`
    : "";
  return `<pre><code${lang}>${escapeHtml(source)}</code></pre>`;
}

module.exports = {
  decorateScreenshotMarkdownIt,
  escapeAttr,
  highlightScreenshotFence,
  parseScreenshotMarkdownCover,
  renderScreenshotMarkdownArticle,
  renderScreenshotCodeArticle,
  resolveScreenshotMarkdownImageSrc,
};
