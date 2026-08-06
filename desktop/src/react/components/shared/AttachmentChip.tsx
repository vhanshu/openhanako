/**
 * AttachmentChip — 统一的附件/引用胶囊组件
 *
 * 用于输入区文件标签、输入区引用标签、聊天区文件附件、聊天区引用文本。
 */

import { memo, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import styles from './AttachmentChip.module.css';

interface AttachmentChipProps {
  icon: ReactNode;
  name: string;
  onRemove?: () => void;
  onClick?: (event: MouseEvent<HTMLSpanElement>) => void;
  className?: string;
  variant?: 'normal' | 'expired';
  /** 覆盖默认 title，hint 给"预览"/"打开"等动作语义 */
  actionTitle?: string;
}

export const AttachmentChip = memo(function AttachmentChip({
  icon,
  name,
  onRemove,
  onClick,
  className,
  variant = 'normal',
  actionTitle,
}: AttachmentChipProps) {
  const interactive = Boolean(onClick);
  const label = actionTitle ?? (interactive ? `${name}（点击打开）` : name);

  const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
    onClick?.(event);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (!onClick) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick(event as unknown as MouseEvent<HTMLSpanElement>);
    }
  };

  const handleRemoveClick = (event: MouseEvent<HTMLButtonElement>) => {
    // chip 本身可能是可点击的，必须拦截冒泡，避免点删除时误触发 onClick
    event.stopPropagation();
    onRemove?.();
  };

  return (
    <span
      className={`${styles.chip}${variant === 'expired' ? ` ${styles.expired}` : ''}${interactive ? ` ${styles.interactive}` : ''}${className ? ` ${className}` : ''}`}
      title={label}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      onClick={interactive ? handleClick : undefined}
      onKeyDown={interactive ? handleKeyDown : undefined}
    >
      <span className={styles.name}>
        <span className={styles.icon}>{icon}</span>
        {name}
      </span>
      {onRemove && (
        <button
          type="button"
          className={styles.remove}
          onClick={handleRemoveClick}
          aria-label={`Remove ${name}`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      )}
    </span>
  );
});
