/**
 * MoodBlock — 可折叠的 MOOD/PULSE/REFLECT 区块
 */

import { memo, useEffect, useState, useCallback } from 'react';
import { Collapse } from '@/ui';
import { useShallow } from 'zustand/react/shallow';
import { moodLabel } from '../../utils/message-parser';
import { useStore } from '../../stores';
import { sessionScopedValue } from '../../stores/session-slice';
import styles from './Chat.module.css';

interface Props {
  yuan: string;
  text: string;
  /** 可选：用于读 findState；命中 text 时自动展开。preview 场景可不传 */
  sessionPath?: string;
}

export const MoodBlock = memo(function MoodBlock({ yuan, text, sessionPath }: Props) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen(v => !v), []);
  const findNeedles = useStore(useShallow((s) => {
    if (!sessionPath) return [];
    const find = sessionScopedValue(s, s.chatFindBySession, sessionPath);
    if (!find?.open) return [];
    return [...new Set(find.matches.flatMap((m) => m.needles))];
  }));
  useEffect(() => {
    if (findNeedles.length === 0 || !text) return;
    const lower = text.toLowerCase();
    if (findNeedles.some((n) => lower.includes(n.toLowerCase()))) {
      setOpen(true);
    }
  }, [findNeedles, text]);

  return (
    <div className={styles.moodWrapper} data-yuan={yuan}>
      <div className={styles.moodSummary} onClick={toggle}>
        <span className={`${styles.moodArrow}${open ? ` ${styles.moodArrowOpen}` : ''}`}>›</span>
        {' '}{moodLabel(yuan)}
      </div>
      <Collapse open={open}>
        <div className={styles.moodBlock} data-find-markable="">{text}</div>
      </Collapse>
    </div>
  );
});
