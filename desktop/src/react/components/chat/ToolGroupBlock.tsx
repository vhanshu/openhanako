/**
 * ToolGroupBlock — 工具调用组，含展开/折叠
 */

import { memo, useState, useCallback, useEffect, useMemo } from 'react';
import { Collapse } from '@/ui';
import { useShallow } from 'zustand/react/shallow';
import styles from './Chat.module.css';
import { extractToolDetail } from '../../utils/message-parser';
import type { ToolDetail } from '../../utils/message-parser';
import { openInternalLink } from '../../utils/link-open';
import { isToolCallHiddenFromProcessUi } from '../../utils/tool-call-visibility';
import { LinkContextMenu, type LinkContextMenuState } from '../shared/LinkContextMenu';

import type { ToolCall } from '../../stores/chat-types';
import { useStore } from '../../stores';
import { sessionScopedValue } from '../../stores/session-slice';

interface Props {
  tools: ToolCall[];
  collapsed: boolean;
  agentName?: string;
  /** 用于读 findState；任一 tool detail.text 命中 needle 时自动展开 */
  sessionPath?: string;
}

function getToolLabel(name: string, phase: string, agentName: string): string {
  const t = window.t;
  const vars = { name: agentName };
  const labelName = name === 'exec_command'
    ? 'bash'
    : name === 'write_stdin'
      ? 'terminal'
      : name;
  const val = t?.(`tool.${labelName}.${phase}`, vars);
  if (val && val !== `tool.${labelName}.${phase}`) return val;
  return t?.(`tool._fallback.${phase}`, vars) || name;
}

export const ToolGroupBlock = memo(function ToolGroupBlock({ tools: rawTools, collapsed: initialCollapsed, agentName = 'Hanako', sessionPath }: Props) {
  // 独立卡片或产物块承接状态的工具，不在工具组里重复显示。
  const tools = rawTools.filter(t => !isToolCallHiddenFromProcessUi(t));
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  useEffect(() => {
    setCollapsed(initialCollapsed);
  }, [initialCollapsed]);
  // 查找命中：任一 tool detail 包含 needle 时自动展开
  const findNeedles = useStore(useShallow((s) => {
    if (!sessionPath) return [];
    const find = sessionScopedValue(s, s.chatFindBySession, sessionPath);
    if (!find?.open) return [];
    return [...new Set(find.matches.flatMap((m) => m.needles))];
  }));
  const toolDetailText = useMemo(
    () => tools.map((t) => extractToolDetail(t.name, t.args).text || '').join('\n').toLowerCase(),
    [tools],
  );
  useEffect(() => {
    if (findNeedles.length === 0 || toolDetailText === '') return;
    if (findNeedles.some((n) => toolDetailText.includes(n.toLowerCase()))) {
      setCollapsed(false);
    }
  }, [findNeedles, toolDetailText]);
  const toggle = useCallback(() => setCollapsed(v => !v), []);

  if (tools.length === 0) return null;

  const allDone = tools.every(t => t.status ? t.status !== 'running' : t.done);
  const failCount = tools.filter(t => t.status === 'failed' || (!t.status && t.done && !t.success)).length;
  const isSingle = tools.length === 1;

  // 摘要标题
  const _t = window.t ?? ((p: string) => p);
  let summaryText = '';
  if (allDone) {
    if (failCount > 0) {
      summaryText = _t('toolGroup.countWithFail', { total: tools.length, fail: failCount });
    } else {
      summaryText = _t('toolGroup.count', { n: tools.length });
    }
  } else {
    const running = tools.filter(t => !t.done).length;
    summaryText = _t('toolGroup.running', { n: running });
  }

  return (
    <div className={`${styles.toolGroup}${isSingle ? ` ${styles.toolGroupSingle}` : ''}`}>
      {!isSingle && (
        <div
          className={`${styles.toolGroupSummary}${allDone ? ` ${styles.toolGroupSummaryClickable}` : ''}`}
          onClick={allDone ? toggle : undefined}
        >
          <span className={styles.toolGroupTitle}>{summaryText}</span>
          {allDone && <span className={styles.toolGroupArrow}>{collapsed ? '›' : '‹'}</span>}
          {!allDone && (
            <span className={styles.toolDots} />
          )}
        </div>
      )}
      {isSingle ? (
        <div className={styles.toolGroupContent}>
          {tools.map((tool, i) => (
            <ToolIndicator key={tool.id || `${tool.name}-${i}`} tool={tool} agentName={agentName} />
          ))}
        </div>
      ) : (
        <Collapse open={!collapsed}>
          <div className={styles.toolGroupContent}>
            {tools.map((tool, i) => (
              <ToolIndicator key={tool.id || `${tool.name}-${i}`} tool={tool} agentName={agentName} />
            ))}
          </div>
        </Collapse>
      )}
    </div>
  );
});

// ── ToolIndicator ──

function handleDetailClick(e: React.MouseEvent, detail: ToolDetail) {
  e.preventDefault();
  e.stopPropagation();
  if (!detail.href) return;
  void openInternalLink(detail.href, { origin: 'session' });
}

const ToolIndicator = memo(function ToolIndicator({ tool, agentName }: { tool: ToolCall; agentName: string }) {
  const [linkMenu, setLinkMenu] = useState<LinkContextMenuState | null>(null);
  const openToolInspector = useStore(s => s.openToolInspector);
  const currentSessionPath = useStore(s => s.currentSessionPath);

  const detail = extractToolDetail(tool.name, tool.args);
  const label = getToolLabel(tool.name, tool.done ? 'done' : 'running', agentName);
  const detailTitle = detail.title || detail.href;
  const status = tool.status || (tool.done ? (tool.success ? 'succeeded' : 'failed') : 'running');

  // 如果 args 里有 tag 类型信息（如 agent 名）
  const tag = tool.args?.agentId as string | undefined;

  const handleOpenInspector = useCallback((e: React.MouseEvent | React.KeyboardEvent) => {
    // detail link 本身已 stopPropagation，这里是兜底
    e.stopPropagation();
    if (!currentSessionPath) return;
    openToolInspector({ tool, sessionPath: currentSessionPath });
  }, [currentSessionPath, openToolInspector, tool]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleOpenInspector(e);
    }
  }, [handleOpenInspector]);

  return (
    <>
      <div
        className={`${styles.toolIndicator} ${styles.toolIndicatorInteractive}`}
        data-tool={tool.name}
        data-done={String(tool.done)}
        role="button"
        tabIndex={0}
        aria-label={label}
        title={window.t?.('tool.inspector.ariaLabel', { name: tool.name }) || tool.name}
        onClick={handleOpenInspector}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.toolDesc}>{label}</span>
        {detail.text && (
          detail.href ? (
            <span
              className={`${styles.toolDetail} ${styles.toolDetailLink}`}
              title={detailTitle}
              data-find-markable=""
              onClick={(e) => handleDetailClick(e, detail)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                if (!detail.href) return;
                setLinkMenu({
                  href: detail.href,
                  context: { origin: 'session', label: detail.text },
                  position: { x: e.clientX, y: e.clientY },
                });
              }}
            >
              {detail.text}
            </span>
          ) : (
            <span className={styles.toolDetail} title={detailTitle} data-find-markable="">{detail.text}</span>
          )
        )}
        {tool.error && (
          <span className={styles.toolDetail} title={tool.error}>{tool.error}</span>
        )}
        {tag && <span className={styles.toolTag}>{tag}</span>}
        {status !== 'running' ? (
          <span className={`${styles.toolStatus} ${status === 'succeeded' ? styles.toolStatusDone : styles.toolStatusFailed}`}>
            {status === 'succeeded' ? '✓' : status === 'failed' ? '✗' : '?'}
          </span>
        ) : (
          <span className={styles.toolDots} />
        )}
      </div>
      {linkMenu && (
        <LinkContextMenu
          state={linkMenu}
          onClose={() => setLinkMenu(null)}
        />
      )}
    </>
  );
});
