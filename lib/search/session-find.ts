import {
  normalizeSessionSearchText,
  tokenizeSessionSearchQuery,
} from "./session-search-tokenizer.ts";
import { buildSnippet, isSearchableToken } from "./session-search.ts";

const MAX_MATCHES = 500;

/**
 * 前置条件：entries 必须按 displayable 序号升序传入。
 * findInSessionMessages 保序不排序，输出 matches 的顺序即输入顺序。
 */
export interface SessionFindEntry {
  /** displayable 全局序号，与 /api/sessions/messages 返回的消息 id 同源 */
  index: number;
  /** 与前端可见文本尽量一致的消息文本 */
  text: string;
}

export interface SessionFindMatch {
  index: number;
  exact: boolean;
  snippet: string;
  /**
   * 实际作为命中条件的字符串集合：exact 路径下为 [normalizedQuery]；
   * token 模糊 fallback 路径下为该 entry 内所有命中过的 token。
   * 前端 mark 按此扫文本节点，保证高亮范围与匹配语义对齐（避免 query 子串误标）。
   */
  needles: string[];
}

export interface SessionFindResult {
  total: number;
  /**
   * 得分最高的命中消息序号。
   * 截断时 bestIndex 不保证出现在 matches 内，消费方需做退化处理。
   */
  bestIndex: number | null;
  tokens: string[];
  matches: SessionFindMatch[];
  truncated: boolean;
}

export function findInSessionMessages(
  entries: SessionFindEntry[],
  query: string,
): SessionFindResult {
  const normalizedQuery = normalizeSessionSearchText(query);
  if (!normalizedQuery) {
    return { total: 0, bestIndex: null, tokens: [], matches: [], truncated: false };
  }
  const tokens = tokenizeSessionSearchQuery(normalizedQuery)
    .filter((token) => token !== normalizedQuery)
    .filter(isSearchableToken);

  const candidates: Array<{ entry: SessionFindEntry; needles: string[]; exact: boolean; score: number }> = [];
  let exactCount = 0;

  // 第一遍：仅扫描整串命中（exact）。任一条命中后即标记，后续不再做 token 模糊——
  // 否则搜 "go mod" 时只含 "go" 的消息会被错杀成"命中"。
  for (const entry of Array.isArray(entries) ? entries : []) {
    const normalized = normalizeSessionSearchText(entry?.text);
    if (!normalized) continue;
    if (!normalized.includes(normalizedQuery)) continue;
    exactCount += 1;
    candidates.push({
      entry,
      needles: [normalizedQuery],
      exact: true,
      score: 1000 + Math.min(200, normalizedQuery.length * 8),
    });
  }

  // 第二遍：仅当整串零命中时退化到 token 模糊匹配，保留"无结果时按词找"能力
  // （如搜 "session_search 定位"，让 jieba 分词后的子词仍能召回）。
  // needles 收集该 entry 内所有命中过的 token，前端 mark 会按 needles 逐个扫。
  if (exactCount === 0) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      const normalized = normalizeSessionSearchText(entry?.text);
      if (!normalized) continue;
      const entryNeedles: string[] = [];
      let score = 0;
      for (const token of tokens) {
        if (!normalized.includes(token)) continue;
        entryNeedles.push(token);
        score += 80 + Math.min(60, token.length * 8);
      }
      if (score <= 0 || entryNeedles.length === 0) continue;
      candidates.push({
        entry,
        needles: entryNeedles,
        exact: false,
        score,
      });
    }
  }

  const matches: SessionFindMatch[] = [];
  let total = 0;
  let bestIndex: number | null = null;
  let bestScore = -1;
  for (const c of candidates) {
    total += 1;
    if (matches.length < MAX_MATCHES) {
      matches.push({
        index: c.entry.index,
        exact: c.exact,
        snippet: buildSnippet(c.entry.text, c.needles[0], null),
        needles: c.needles,
      });
    }
    if (c.score > bestScore) {
      bestScore = c.score;
      bestIndex = c.entry.index;
    }
  }

  return { total, bestIndex, tokens, matches, truncated: total > matches.length };
}
