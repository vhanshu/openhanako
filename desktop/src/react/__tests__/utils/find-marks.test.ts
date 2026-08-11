/**
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest';
import { applyFindMarks, clearFindMarks } from '../../utils/find-marks';

describe('find-marks', () => {
  it('多词高亮：每个词都包上指定 class 的 mark', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>hello world 和 你好世界</p>';
    const marks = applyFindMarks(root, ['hello', '你好'], 'chat-find-mark');
    expect(marks.length).toBe(2);
    expect(root.querySelectorAll('mark.chat-find-mark').length).toBe(2);
    expect(root.textContent).toBe('hello world 和 你好世界');
  });

  it('大小写不敏感，保留原文大小写', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>Hello HELLO hello</p>';
    const marks = applyFindMarks(root, ['hello'], 'x-mark');
    expect(marks.length).toBe(3);
    expect(marks[0].textContent).toBe('Hello');
  });

  it('clearFindMarks 还原 DOM 并合并文本节点', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>abc def</p>';
    applyFindMarks(root, ['abc'], 'x-mark');
    clearFindMarks(root, 'x-mark');
    expect(root.querySelectorAll('mark').length).toBe(0);
    expect(root.innerHTML).toBe('<p>abc def</p>');
  });

  it('重复 apply 前先自清，不嵌套', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>abc</p>';
    applyFindMarks(root, ['abc'], 'x-mark');
    applyFindMarks(root, ['ab'], 'x-mark');
    expect(root.querySelectorAll('mark.x-mark').length).toBe(1);
    expect(root.querySelector('mark.x-mark')!.textContent).toBe('ab');
  });

  it('重叠词长词优先：不产生嵌套或碎片', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>session_search 分词</p>';
    const marks = applyFindMarks(root, ['session', 'session_search'], 'x-mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('session_search');
  });

  it('scopeSelector：作用域外的文本节点不被 mark（保护 React 直渲区域）', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>outside abc</p><div data-find-markable=""><p>inside abc</p></div>';
    const marks = applyFindMarks(root, ['abc'], 'x-mark', { scopeSelector: '[data-find-markable]' });
    expect(marks.length).toBe(1);
    expect(marks[0].closest('[data-find-markable]')).not.toBeNull();
    expect(root.querySelector('p')!.querySelector('mark')).toBeNull();
    expect(root.textContent).toBe('outside abcinside abc');
  });

  it('null root 与空 terms 安全返回', () => {
    expect(applyFindMarks(null, ['a'], 'x')).toEqual([]);
    const root = document.createElement('div');
    root.innerHTML = '<p>abc</p>';
    expect(applyFindMarks(root, [], 'x')).toEqual([]);
    expect(() => clearFindMarks(null, 'x')).not.toThrow();
  });

  it('activeNeedles：mark 上 data-needle 在 activeNeedles 集合内才标 activeClass', () => {
    // 文本含 1 个独立 "go"（"go lang"）+ 2 个 "go mod" 整串 → total 3 个 mark
    const root = document.createElement('div');
    root.innerHTML = '<p>go lang.org go mod tidy go mod init</p>';
    const marks = applyFindMarks(root, ['go mod', 'go'], 'x-mark', {
      activeNeedles: ['go mod'],
      activeClass: 'x-mark-active',
    });
    expect(marks.length).toBe(3);
    const active = marks.filter((m) => m.classList.contains('x-mark-active'));
    expect(active.length).toBe(2);
    expect(active.every((m) => m.dataset.needle === 'go mod')).toBe(true);
    const inactive = marks.filter((m) => !m.classList.contains('x-mark-active'));
    expect(inactive.length).toBe(1);
    expect(inactive[0].dataset.needle).toBe('go');
  });

  it('每个 mark 都带 data-needle 属性记录其命中字符串', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>hello world</p>';
    const marks = applyFindMarks(root, ['hello', 'world'], 'x-mark');
    expect(marks.length).toBe(2);
    expect(marks[0].dataset.needle).toBe('hello');
    expect(marks[1].dataset.needle).toBe('world');
  });

  it('activeNeedles / activeClass 任一缺失则不标 active', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p>abc</p>';
    const marks = applyFindMarks(root, ['abc'], 'x-mark', { activeNeedles: ['abc'] });
    expect(marks[0].classList.contains('x-mark-active')).toBe(false);
    const marks2 = applyFindMarks(root, ['abc'], 'x-mark', { activeClass: 'x-mark-active' });
    expect(marks2[0].classList.contains('x-mark-active')).toBe(false);
  });
});
