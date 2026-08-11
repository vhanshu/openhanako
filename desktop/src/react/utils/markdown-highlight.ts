/**
 * 代码块语法高亮（React 渲染端）
 *
 * 使用 highlight.js 的 core + 静态注册常用语言，避免动态 import 跟 markdown-it
 * 同步 fence rule 不兼容。代价：~30 种语言一次性进 bundle，gz 后约 30–50KB，
 * 对 Electron 桌面应用可以接受。
 *
 * fence 内容由 markdown-it 在 `html: false` 下提前 escape 过，里面含 &lt; &amp;
 * 等实体；全局开启 `ignoreUnescapedHTML` 避免 hljs 把它当成未转义 HTML 报
 * illegal。注意 `ignoreUnescapedHTML` 是 `HLJSOptions` 字段（全局 configure 用），
 * 不是 `HighlightOptions` 字段（单次调用），所以放 configure 里。
 *
 * 单次调用再用 `ignoreIllegals: true` 兜底其他可能的语法异常。
 *
 * 截图线（src/shared/screenshot-markdown.cjs）是 CommonJS，不能直接复用本文件；
 * 那里会维护一份语义相同的语言别名表与高亮函数。
 */

import hljs from 'highlight.js/lib/core';
import type { LanguageFn } from 'highlight.js';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import swift from 'highlight.js/lib/languages/swift';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import cssLang from 'highlight.js/lib/languages/css';
import scss from 'highlight.js/lib/languages/scss';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import ini from 'highlight.js/lib/languages/ini';
import sql from 'highlight.js/lib/languages/sql';
import markdown from 'highlight.js/lib/languages/markdown';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import makefile from 'highlight.js/lib/languages/makefile';
import lua from 'highlight.js/lib/languages/lua';
import php from 'highlight.js/lib/languages/php';
import ruby from 'highlight.js/lib/languages/ruby';
import dart from 'highlight.js/lib/languages/dart';
import diff from 'highlight.js/lib/languages/diff';

// 注册到 hljs 的语言集合。key 是 highlight.js 内部名，value 是 grammar 函数。
const HLJS_LANGUAGES: Record<string, LanguageFn> = {
  typescript,
  javascript,
  json,
  bash,
  python,
  go,
  rust,
  java,
  kotlin,
  swift,
  c,
  cpp,
  cs: csharp,
  css: cssLang,
  scss,
  xml,
  yaml,
  ini,
  toml: ini,
  sql,
  markdown,
  dockerfile,
  makefile,
  lua,
  php,
  ruby,
  dart,
  diff,
};

// fence info 字符串（``` 后的内容）→ highlight.js 注册名。
// jsx/tsx/cxx/h/yml/md 等常见 markdown 用法在这里统一映射。
const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  typescript: 'typescript',
  js: 'javascript',
  javascript: 'javascript',
  jsx: 'javascript',
  tsx: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  python: 'python',
  golang: 'go',
  go: 'go',
  rs: 'rust',
  rust: 'rust',
  kt: 'kotlin',
  kotlin: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cxx: 'cpp',
  cc: 'cpp',
  csharp: 'cs',
  cs: 'cs',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  vue: 'xml',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  md: 'markdown',
  markdown: 'markdown',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  makefile: 'makefile',
  mk: 'makefile',
  lua: 'lua',
  php: 'php',
  rb: 'ruby',
  ruby: 'ruby',
  dart: 'dart',
  diff: 'diff',
  patch: 'diff',
};

let registered = false;
function ensureRegistered(): void {
  if (registered) return;
  for (const [name, fn] of Object.entries(HLJS_LANGUAGES)) {
    hljs.registerLanguage(name, fn);
  }
  hljs.configure({ ignoreUnescapedHTML: true });
  registered = true;
}

/**
 * 高亮一段已经 HTML-escape 过的代码。
 * - 指定了语言且已注册：直接 highlight
 * - 指定了语言但未注册：尝试 highlightAuto 兜底（成本较高，但能兜住冷门别名）
 * - 未给出语言：返回 null，调用方走默认 fence 输出
 *
 * 返回的字符串是 highlight.js 内部的 HTML，调用方需要再包一层 <pre><code>。
 */
export function highlightFence(content: string, info: string): { html: string; language: string } | null {
  ensureRegistered();
  const rawLang = info.trim().split(/\s+/)[0]?.toLowerCase() || '';
  if (!rawLang) return null;

  const target = LANG_ALIASES[rawLang];
  if (target && HLJS_LANGUAGES[target]) {
    try {
      const result = hljs.highlight(content, { language: target, ignoreIllegals: true });
      return { html: result.value, language: target };
    } catch {
      /* fall through */
    }
  }

  // 别名表未命中，或指定语言未注册 —— 自动检测兜底
  try {
    // highlightAuto 签名是 (code, languageSubset?: string[])，第二个参数是白名单
    // 不是 options；之前误传的 ignoreUnescapedHTML 是无效字段。
    const result = hljs.highlightAuto(content);
    if (result.language && result.language !== 'plaintext') {
      return { html: result.value, language: result.language };
    }
  } catch {
    /* ignore */
  }
  return null;
}