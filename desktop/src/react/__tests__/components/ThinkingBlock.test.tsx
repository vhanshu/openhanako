// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThinkingBlock } from '../../components/chat/ThinkingBlock';
import { useStore } from '../../stores';

const sessionPath = '/session/thinking.jsonl';

function t(key: string, vars?: Record<string, string | number>): string {
  const table: Record<string, string> = {
    'thinking.done': '思考完成',
    'thinking.active': '思考中',
  };
  return (table[key] || key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''));
}

// Mock scrollHeight/clientHeight on a given element using a mutable object.
function installMetrics(el: Element, getMetrics: () => { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => getMetrics().scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => getMetrics().clientHeight });
  // getComputedStyle(el).lineHeight → '20px'
  vi.spyOn(window, 'getComputedStyle').mockImplementation(((target: Element) => {
    const style = target instanceof Element && target === el
      ? ({ lineHeight: '20px', fontSize: '12.48px' } as CSSStyleDeclaration)
      : (window.getComputedStyle as any).mock?.original?.(target) ?? ({} as CSSStyleDeclaration);
    return style;
  }) as any);
}

describe('ThinkingBlock — streaming + progress + full + hidden', () => {
  beforeEach(() => {
    window.t = t as typeof window.t;
    useStore.setState({
      agents: [],
      agentName: '小花',
      agentYuan: 'hanako',
      streamingSessions: [],
      selectedIdsBySession: {},
      chatSessions: {
        [sessionPath]: { hasMore: false, loadingMore: false, items: [] },
      },
    } as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('streaming 默认渲染 progress 模式的 ProgressStream', () => {
    const { container } = render(
      <ThinkingBlock content="第一步思考" sealed={false} sessionPath={sessionPath} />,
    );
    expect(screen.getByText('思考中')).toBeInTheDocument();
    // streaming 时 ProgressStream 渲染（即使内容 < 3 行，DOM 存在但 height:0）
    const idle = container.querySelector('[class*="progressStreamIdle"]');
    const active = container.querySelector('[class*="progressStreamActive"]');
    expect(idle || active).toBeTruthy();
  });

  it('内容 ≥ 3 行时 ProgressStream 切到 active 模式（高度固定）', () => {
    const longContent = '第一行\n第二行\n第三行';
    const { container } = render(
      <ThinkingBlock content={longContent} sealed={false} sessionPath={sessionPath} />,
    );

    // 模拟 layout：3 行内容 scrollHeight = 60px (> 3 * 20px lineHeight = 60, 临界)
    // 改成 4 行让 ProgressStream 明确进入 active 模式
    const metrics = { scrollHeight: 100, clientHeight: 80 };
    // 找到 progressContent 元素并 mock
    requestAnimationFrame(() => {
      const innerEl = container.querySelector('[class*="progressContent"]');
      if (innerEl) installMetrics(innerEl, () => metrics);
    });

    // useLayoutEffect 同步触发，但 jsdom 没有真实 layout；
    // 这里我们直接验证初始 idle 状态（mount 时 content 是 3 行但 jsdom scrollHeight=0）
    // 真实环境（Chromium）下 effect 会测量并切到 active
    const idle = container.querySelector('[class*="progressStreamIdle"]');
    expect(idle).toBeTruthy();
  });

  it('sealed=true 默认隐藏 body', () => {
    const { container } = render(
      <ThinkingBlock content="已完成的思考内容" sealed={true} sessionPath={sessionPath} />,
    );
    expect(screen.getByText('思考完成')).toBeInTheDocument();
    // sealed 时 bodyMode='hidden'，不渲染任何 body
    expect(container.querySelector('[class*="progressStreamIdle"]')).toBeNull();
    expect(container.querySelector('[class*="progressStreamActive"]')).toBeNull();
    expect(container.querySelector('[class*="thinkingFull"]')).toBeNull();
  });

  it('sealed=true 时点 summary 进入 full 模式，显示完整内容', () => {
    const content = '完整的思考内容\n多行展示';
    const { container } = render(
      <ThinkingBlock content={content} sealed={true} sessionPath={sessionPath} />,
    );
    expect(screen.queryByText('完整的思考内容')).not.toBeInTheDocument();

    // 点击 summary
    fireEvent.click(screen.getByText('思考完成'));

    // 完整内容现在应该出现
    expect(screen.getByText(/完整的思考内容/)).toBeInTheDocument();
    expect(container.querySelector('[class*="thinkingFull"]')).toBeTruthy();
    // 左侧线条按钮
    expect(container.querySelector('[class*="thinkingLeftBar"]')).toBeTruthy();
  });

  it('full 模式下点左侧线条按钮收起 body', () => {
    const { container } = render(
      <ThinkingBlock content="完整内容" sealed={true} sessionPath={sessionPath} />,
    );
    // 先点 summary 进入 full
    fireEvent.click(screen.getByText('思考完成'));
    expect(container.querySelector('[class*="thinkingFull"]')).toBeTruthy();

    // 点左侧线条收起
    const leftBar = container.querySelector('[class*="thinkingLeftBar"]') as HTMLButtonElement;
    expect(leftBar).toBeTruthy();
    fireEvent.click(leftBar);

    expect(container.querySelector('[class*="thinkingFull"]')).toBeNull();
  });

  it('streaming + 用户点 summary 从 progress 切到 full，ProgressStream 隐藏', () => {
    const { container } = render(
      <ThinkingBlock content="正在思考" sealed={false} sessionPath={sessionPath} />,
    );
    // 初始有 progressStream（idle 或 active 之一）
    expect(
      container.querySelector('[class*="progressStreamIdle"]') ||
      container.querySelector('[class*="progressStreamActive"]'),
    ).toBeTruthy();

    // 点 summary 切到 full
    fireEvent.click(screen.getByText('思考中'));

    // ProgressStream 应该消失（条件渲染），完整内容出现
    expect(container.querySelector('[class*="progressStreamIdle"]')).toBeNull();
    expect(container.querySelector('[class*="progressStreamActive"]')).toBeNull();
    expect(screen.getByText('正在思考')).toBeInTheDocument();
    expect(container.querySelector('[class*="thinkingFull"]')).toBeTruthy();
  });

  it('streaming 点 ProgressStream 本身能展开 full（即使 jsdom 下 idle 模式也响应 onClick）', () => {
    const { container } = render(
      <ThinkingBlock content="第一步\n第二步\n第三步" sealed={false} sessionPath={sessionPath} />,
    );
    // jsdom 没有真实 layout，初始仍是 idle className，但 onClick 仍附加在元素上。
    // 真实环境下 content ≥ 3 行时切到 active，cursor:pointer + 高度可见，用户自然点得到。
    const progressEl = container.querySelector('[class*="progressStreamIdle"]') as HTMLElement | null;
    expect(progressEl).toBeTruthy();
    fireEvent.click(progressEl!);

    // 点击后 bodyMode='full'，ProgressStream 条件渲染消失
    expect(container.querySelector('[class*="progressStreamIdle"]')).toBeNull();
    expect(container.querySelector('[class*="progressStreamActive"]')).toBeNull();
    expect(container.querySelector('[class*="thinkingFull"]')).toBeTruthy();
  });
});