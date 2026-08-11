/**
 * ThinkingBlock — 可折叠的思考过程区块
 */

import { memo, useEffect, useState, useCallback } from 'react';
import { Collapse } from '@/ui';
import { useShallow } from 'zustand/react/shallow';
import { useStore } from '../../stores';
import { sessionScopedValue } from '../../stores/session-slice';
import styles from './Chat.module.css';

interface Props {
  content: string;
  sealed: boolean;
  /** 可选：用于读 findState；命中 content 时自动展开。preview / 无 session 场景可不传 */
  sessionPath?: string;
}

export const ThinkingBlock = memo(function ThinkingBlock({ content, sealed, sessionPath }: Props) {
  const t = window.t ?? ((p: string) => p);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  // 查找命中：自动展开（不反向折叠，避免覆盖用户手动折叠状态）
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
      setOpen(true);
    }
  }, [findNeedles, content]);

  return (
    <details className={styles.thinkingBlock} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className={styles.thinkingBlockSummary} onClick={(e) => { e.preventDefault(); toggle(); }}>
        <span className={`${styles.thinkingBlockArrow}${open ? ` ${styles.thinkingBlockArrowOpen}` : ''}`}>›</span>
        {' '}{sealed ? t('thinking.done') : (
          <>{t('thinking.active')}<span className={styles.thinkingDots} /></>
        )}
      </summary>
      <Collapse open={open && !!content}>
        <div className={styles.thinkingBlockBody} data-find-markable="">{content}</div>
      </Collapse>
    </details>
  );
});
