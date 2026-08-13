/**
 * ThinkingBlock — 可折叠的思考过程区块
 *
 * 显示策略（按 sealed 分两阶段）：
 *
 * sealed=false（streaming）：
 *   - summary "思考中..." 始终可见
 *   - body 默认为 progress 模式：渲染独立的 ProgressStream 子组件，
 *     固定 3 行高度，内部内容用 translateY 向上偏移，
 *     平滑滚动展示最后 3 行；内容 < 3 行时整个组件隐藏
 *   - 用户点 summary 切到 full 模式：立即隐藏 ProgressStream，显示完整思考内容
 *   - 用户再点 summary 切回 progress 模式
 *   - full 模式下，用户可点击 body 左侧线条收起整个 body
 *
 * sealed=true（已完成）：
 *   - 默认 body 隐藏（hidden 模式）；用户点 summary 切到 full 显示完整内容
 *   - full 模式下同样可点击 body 左侧线条收起
 *
 * 因此 bodyMode 三态：
 *   progress — streaming 默认，渲染 ProgressStream（仅内容 ≥ 3 行时可见）
 *   full     — 显示完整内容，body 左侧线条可点击收起
 *   hidden   — body 完全不渲染
 */

import { memo, useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../stores';
import { sessionScopedValue } from '../../stores/session-slice';
import styles from './Chat.module.css';

type BodyMode = 'progress' | 'full' | 'hidden';

interface Props {
  content: string;
  sealed: boolean;
  /** 可选：用于读 findState；命中 content 时切到 full 完整展开。preview / 无 session 场景可不传 */
  sessionPath?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, sealed, sessionPath }: Props) {
  const t = window.t ?? ((p: string) => p);
  // streaming 默认 progress；sealed 默认 hidden
  const [bodyMode, setBodyMode] = useState<BodyMode>(sealed ? 'hidden' : 'progress');
  // sealed 翻转时强制隐藏一次
  useEffect(() => {
    if (sealed) setBodyMode('hidden');
  }, [sealed]);

  const onSummaryClick = useCallback(() => {
    setBodyMode((prev) => {
      if (prev === 'full') return sealed ? 'hidden' : 'progress';
      return 'full';
    });
  }, [sealed]);

  const collapse = useCallback(() => setBodyMode('hidden'), []);

  // 查找命中：自动切到 full（不反向折叠，避免覆盖用户手动状态）
  const findNeedles = useStore(useShallow((s) => {
    if (!sessionPath) return [];
    const find = sessionScopedValue(s, s.chatFindBySession, sessionPath);
    if (!find?.open) return [];
    return [...new Set(find.matches.flatMap((m) => m.needles))];
  }));
  useEffect(() => {
    if (findNeedles.length === 0 || !content) return;
    const lower = content.toLowerCase();
    if (findNeedles.some((n) => lower.includes(n.toLowerCase()))) {
      setBodyMode('full');
    }
  }, [findNeedles, content]);

  const showProgress = bodyMode === 'progress';
  const showFull = bodyMode === 'full';
  const arrowOpen = showProgress || showFull;

  return (
    <details open className={styles.thinkingBlock}>
      <summary
        className={styles.thinkingBlockSummary}
        onClick={(e) => {
          e.preventDefault();
          onSummaryClick();
        }}
      >
        <span className={`${styles.thinkingBlockArrow}${arrowOpen ? ` ${styles.thinkingBlockArrowOpen}` : ''}`}>›</span>
        {' '}{sealed ? t('thinking.done') : (
          <>{t('thinking.active')}<span className={styles.thinkingDots} /></>
        )}
      </summary>
      {showProgress && <ProgressStream content={content} onExpand={() => setBodyMode('full')} />}
      {showFull && (
        <div className={styles.thinkingFull}>
          <button
            type="button"
            className={styles.thinkingLeftBar}
            onClick={collapse}
            aria-label="收起"
            title="收起"
          />
          <div className={styles.thinkingFullContent} data-find-markable="">{content}</div>
        </div>
      )}
    </details>
  );
});

/**
 * ProgressStream — streaming 进度展示组件
 *
 * 固定 3 行高度视窗，内部 content 用 translateY 平滑向上偏移到最底。
 * 内容实际行数 < 3 时用 height:0 隐藏（不能用 display:none，
 * 否则子元素 scrollHeight=0 永远测不到“3 行”条件，会陷入死循环）。
 *
 * 点击该组件 → onExpand（跳到 full 模式看完整内容）。
 */
const ProgressStream = memo(function ProgressStream({
  content,
  onExpand,
}: {
  content: string;
  onExpand: () => void;
}) {
  const innerRef = useRef<HTMLDivElement>(null);
  const [isLong, setIsLong] = useState(false);

  // 测量内容是否 ≥ 3 行：决定是否展示 progressStream
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
    if (!lineHeight) return;
    const lines = el.scrollHeight / lineHeight;
    setIsLong(lines >= 3);
  }, [content]);

  // 内容增长时把 inner 向上偏移到最底，让"最后 3 行"始终可见；
  // translateY 由 CSS transition 平滑过渡（看起来像"持续向上滚动"）。
  //
  // 注意：parent.clientHeight 包含 padding，但 inner 的可视区是
  // content box（不含 padding）。所以偏移量要扣掉父 paddingY，
  // 否则最后一行底部会被 padding 区盖住，视觉上像"被截断"。
  useLayoutEffect(() => {
    if (!isLong) return;
    const inner = innerRef.current;
    if (!inner || !inner.parentElement) return;
    const cs = getComputedStyle(inner.parentElement);
    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const visible = inner.parentElement.clientHeight - padY;
    const overflow = inner.scrollHeight - visible;
    inner.style.transform = overflow > 0 ? `translateY(-${overflow}px)` : 'translateY(0)';
  }, [content, isLong]);

  return (
    <div
      className={isLong ? styles.progressStreamActive : styles.progressStreamIdle}
      onClick={onExpand}
      role="button"
      tabIndex={isLong ? 0 : -1}
    >
      <div ref={innerRef} className={styles.progressContent}>
        {content}
      </div>
    </div>
  );
});