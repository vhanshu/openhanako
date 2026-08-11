import { describe, expect, it, vi } from "vitest";
import { findInSessionMessages } from "../lib/search/session-find.ts";
import {
  SessionSearchTokenizerUnavailableError,
  tokenizeSessionSearchQuery,
} from "../lib/search/session-search-tokenizer.ts";

vi.mock("../lib/search/session-search-tokenizer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/search/session-search-tokenizer.ts")>();
  return {
    ...actual,
    tokenizeSessionSearchQuery: vi.fn(actual.tokenizeSessionSearchQuery),
  };
});

const entries = [
  { index: 0, text: "今天调试了 session_search 的分词逻辑" },
  { index: 2, text: "better-sqlite3 的 ABI 问题解决了" },
  { index: 5, text: "明天继续看聊天记录的搜索定位" },
  { index: 7, text: "Session Search 大小写与全角ＡＢＣ规整" },
];

describe("findInSessionMessages", () => {
  it("整句命中标记 exact 并给出 bestIndex", () => {
    const r = findInSessionMessages(entries, "聊天记录");
    expect(r.total).toBe(1);
    expect(r.matches[0]).toMatchObject({ index: 5, exact: true, needles: ["聊天记录"] });
    expect(r.bestIndex).toBe(5);
    expect(r.matches[0].snippet).toContain("聊天记录");
  });

  it("exact 命中：needles 等于 query 整串，前端按此 mark 避免子串误标", () => {
    const r = findInSessionMessages(entries, "聊天记录");
    expect(r.matches.every((m) => m.needles.length === 1 && m.needles[0] === "聊天记录"))
      .toBe(true);
  });

  it("exact 优先：整串命中数 ≥ 1 时不跑 token 模糊，单 token 命中被丢弃", () => {
    const e = [
      { index: 1, text: "go mod init jwt-demo" },           // 整串命中
      { index: 2, text: "go get github.com/golang-jwt/jwt/v5" }, // 只含 "go"
      { index: 3, text: "go run main.go" },                  // 只含 "go"
      { index: 4, text: "go lang.org/x/crypto/bcrypt" },    // 只含 "go"
    ];
    const r = findInSessionMessages(e, "go mod");
    expect(r.total).toBe(1);
    expect(r.matches.map((m) => m.index)).toEqual([1]);
    expect(r.matches[0].exact).toBe(true);
    expect(r.bestIndex).toBe(1);
  });

  it("exact 优先：多个整串命中时全部返回", () => {
    const e = [
      { index: 1, text: "go mod tidy" },
      { index: 2, text: "go mod init jwt-demo" },
      { index: 3, text: "go run main.go" }, // 只含 "go"，应被丢弃
    ];
    const r = findInSessionMessages(e, "go mod");
    expect(r.total).toBe(2);
    expect(r.matches.map((m) => m.index)).toEqual([1, 2]);
  });

  it("normalize：大小写不敏感 + NFKC 全角规整", () => {
    const r = findInSessionMessages(entries, "session search 大小写与全角abc");
    expect(r.matches.some((m) => m.index === 7 && m.exact)).toBe(true);
  });

  it("整句不中时 token 命中（exact=false），命中含 0 和 5，bestIndex 取最高分", () => {
    const r = findInSessionMessages(entries, "session_search 定位");
    expect(r.total).toBeGreaterThanOrEqual(2);
    expect(r.matches.every((m) => m.exact === false)).toBe(true);
    expect(r.matches.map((m) => m.index)).toContain(0);
    expect(r.matches.map((m) => m.index)).toContain(5);
    expect(r.bestIndex).toBe(0);
  });

  it("fallback token 命中：needles 是该 entry 内所有命中过的 token（前端 mark 按逐个标）", () => {
    const r = findInSessionMessages(entries, "session_search 定位");
    const byIndex = new Map(r.matches.map((m) => [m.index, m.needles]));
    // entries[0] 含 "session_search" → needles 含 "session_search"
    expect(byIndex.get(0)).toContain("session_search");
    // entries[5] 含 "定位" → needles 含 "定位"
    expect(byIndex.get(5)).toContain("定位");
  });

  it("token 可搜索性门槛：单字符 ASCII 与裸数字不进入 tokens、不产生误命中", () => {
    const r = findInSessionMessages(entries, "调试 x 3");
    expect(r.tokens).not.toContain("x");
    expect(r.tokens).not.toContain("3");
    expect(r.matches.map((m) => m.index)).not.toContain(2);
  });

  it("matches 按 index 升序", () => {
    const r = findInSessionMessages(entries, "的");
    const idx = r.matches.map((m) => m.index);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });

  it("保序不排序：乱序输入按输入顺序原样输出", () => {
    const shuffled = [entries[2], entries[0]];
    const r = findInSessionMessages(shuffled, "的");
    expect(r.matches.map((m) => m.index)).toEqual([5, 0]);
  });

  it("空查询与空文本返回空结果", () => {
    expect(findInSessionMessages(entries, "  ").total).toBe(0);
    expect(findInSessionMessages([], "abc").total).toBe(0);
    expect(findInSessionMessages(entries, "  ").bestIndex).toBeNull();
  });

  it("命中数超 MAX_MATCHES 截断但 total 保留真实值", () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ index: i, text: `hello world ${i}` }));
    const r = findInSessionMessages(many, "hello");
    expect(r.total).toBe(600);
    expect(r.matches.length).toBe(500);
    expect(r.truncated).toBe(true);
  });

  it("tokenizer 不可用错误原样上抛不吞", () => {
    const err = new SessionSearchTokenizerUnavailableError(new Error("boom"));
    vi.mocked(tokenizeSessionSearchQuery).mockImplementationOnce(() => {
      throw err;
    });
    let caught: unknown;
    try {
      findInSessionMessages(entries, "聊天记录");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(err);
    expect(caught).toBeInstanceOf(SessionSearchTokenizerUnavailableError);
  });
});
