/**
 * ToolCallInspector.tsx — 工具调用详情抽屉
 *
 * 当前展示：
 *   - 工具原始名称 (tool.name)
 *   - 工具调用 id (tool.id)
 *   - 状态 (running / succeeded / failed / unknown) + 成功位 + 错误文本
 *   - 完整传参 (tool.args，JSON 格式化)
 *   - 工具 details (JSON 格式化)
 *   - 执行结果：通过 fetchToolCallResult 按需拉取（待服务端接口就位，目前为 unavailable 占位）
 *
 * 交互：
 *   - 右侧 drawer 风格（覆盖在主内容之上）
 *   - ESC 关闭
 *   - 点空白背景关闭
 *   - 重新打开时 result 会重新拉取
 */

import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { spring } from '@/ui/motion';
import { useStore } from '../../stores';
import type { ToolCall } from '../../stores/chat-types';
import { fetchToolCallResult, downloadToolCallResult, type ToolResultPayload } from '../../utils/tool-result';
import styles from './Chat.module.css';

declare function t(key: string, vars?: Record<string, string | number>): string;

/** JSON 格式化：保留对象/数组结构；非对象直接 toString。 */
function formatJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * 一键复制到剪贴板。Electron renderer 环境优先用 navigator.clipboard.writeText；
 * 遇不可用（HTTP / 权限）回退到 deprecated fallback + 临时 textarea。
 */
async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fallthrough
  }
  try {
    if (typeof document === 'undefined') return false;
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** status 标签的中文翻译（覆盖协议里的 4 个枚举）。 */
function statusLabel(status: ToolCall['status']): string {
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  if (status === 'unknown') return '未知';
  return '进行中';
}

function statusClass(tool: ToolCall): string {
  const status = tool.status || (tool.done ? (tool.success ? 'succeeded' : 'failed') : 'running');
  if (status === 'succeeded') return styles.toolInspectorStatusDone ?? '';
  if (status === 'failed') return styles.toolInspectorStatusFailed ?? '';
  return styles.toolInspectorStatusRunning ?? '';
}

export function ToolCallInspector() {
  const state = useStore(s => s.toolInspector);
  const closeToolInspector = useStore(s => s.closeToolInspector);

  const [result, setResult] = useState<ToolResultPayload>({ status: 'loading' });

  const tool: ToolCall | undefined = state?.tool;
  const sessionPath: string | undefined = state?.sessionPath;

  // web 运行时没有 openFile IPC，隐藏按钮避免出现点击无效。
  const isWebRuntime = typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-platform') === 'web';
  const canOpenLocalPath = !isWebRuntime && typeof window.platform?.openFile === 'function';

  // 重新打开 / 工具变化时拉取结果；tool.id 变化时强制重新拉。
  useEffect(() => {
    if (!state || !tool) {
      setResult({ status: 'loading' });
      return;
    }
    const controller = new AbortController();
    setResult({ status: 'loading' });
    fetchToolCallResult(sessionPath!, tool, { signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        setResult(payload);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        setResult({
          status: 'unavailable',
          reason: err instanceof Error ? err.message : String(err),
        });
      });
    return () => controller.abort();
  }, [state, tool, sessionPath]);

  // ESC 关闭
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeToolInspector();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, closeToolInspector]);

  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeToolInspector();
  }, [closeToolInspector]);

  const argsText = useMemo(() => formatJson(tool?.args), [tool?.args]);
  const detailsText = useMemo(() => formatJson(tool?.details), [tool?.details]);

  if (!state || !tool) return null;

  const status = tool.status || (tool.done ? (tool.success ? 'succeeded' : 'failed') : 'running');

  return (
    <motion.div
      className={styles.toolInspectorOverlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('tool.inspector.ariaLabel', { name: tool.name })}
      onClick={handleBackdropClick}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring.paperSnap}
    >
      <motion.aside
        className={styles.toolInspectorDrawer}
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={spring.paperSnap}
        data-tool={tool.name}
        data-status={status}
      >
        {/* 顶栏 */}
        <header className={styles.toolInspectorHeader}>
          <div className={styles.toolInspectorHeaderText}>
            <span className={styles.toolInspectorEyebrow}>{t('tool.inspector.eyebrow')}</span>
            <h2 className={styles.toolInspectorName}>{tool.name}</h2>
          </div>
          <button
            type="button"
            className={styles.toolInspectorClose}
            aria-label={t('tool.inspector.close')}
            onClick={() => closeToolInspector()}
          >×</button>
        </header>

        {/* 元信息 */}
        <section className={styles.toolInspectorMeta}>
          <div className={styles.toolInspectorMetaRow}>
            <span className={styles.toolInspectorMetaKey}>{t('tool.inspector.status')}</span>
            <span className={`${styles.toolInspectorStatus} ${statusClass(tool)}`}>
              {statusLabel(status)}
            </span>
          </div>
          <div className={styles.toolInspectorMetaRow}>
            <span className={styles.toolInspectorMetaKey}>{t('tool.inspector.id')}</span>
            <code className={styles.toolInspectorMono}>{tool.id || '—'}</code>
          </div>
          <div className={styles.toolInspectorMetaRow}>
            <span className={styles.toolInspectorMetaKey}>{t('tool.inspector.session')}</span>
            {sessionPath && canOpenLocalPath ? (
              <button
                type="button"
                className={`${styles.toolInspectorMono} ${styles.toolInspectorPathButton}`}
                title={t('tool.inspector.openPathTitle', { path: sessionPath })}
                aria-label={t('tool.inspector.openPathTitle', { path: sessionPath })}
                onClick={() => window.platform?.openFile?.(sessionPath)}
              >
                {shortPath(sessionPath)}
              </button>
            ) : (
              <code className={styles.toolInspectorMono} title={sessionPath ?? undefined}>
                {sessionPath ? shortPath(sessionPath) : '—'}
              </code>
            )}
          </div>
          {tool.error && (
            <div className={styles.toolInspectorError}>
              <span className={styles.toolInspectorMetaKey}>{t('tool.inspector.error')}</span>
              <pre className={styles.toolInspectorPre}>{tool.error}</pre>
            </div>
          )}
        </section>

        {/* 内容滚动区 */}
        <div className={styles.toolInspectorBody}>
          <section className={styles.toolInspectorSection}>
            <div className={styles.toolInspectorSectionHeader}>
              <h3 className={styles.toolInspectorSectionTitle}>{t('tool.inspector.args')}</h3>
              <CopyButton text={argsText} disabled={!argsText} />
            </div>
            {argsText ? (
              <pre className={styles.toolInspectorPre}>{argsText}</pre>
            ) : (
              <p className={styles.toolInspectorEmpty}>{t('tool.inspector.empty')}</p>
            )}
          </section>

          {detailsText && (
            <section className={styles.toolInspectorSection}>
              <div className={styles.toolInspectorSectionHeader}>
                <h3 className={styles.toolInspectorSectionTitle}>{t('tool.inspector.details')}</h3>
                <CopyButton text={detailsText} />
              </div>
              <pre className={styles.toolInspectorPre}>{detailsText}</pre>
            </section>
          )}

          <section className={styles.toolInspectorSection}>
            <div className={styles.toolInspectorSectionHeader}>
              <h3 className={styles.toolInspectorSectionTitle}>{t('tool.inspector.result')}</h3>
              <CopyButton text={resultText(result)} disabled={result.status === 'loading' || result.status === 'too_large'} />
            </div>
            <ResultBlock
              result={result}
              onDownload={() => {
                if (!sessionPath) return;
                void downloadToolCallResult(sessionPath, tool).catch((err) => {
                  console.error('[tool-result] download failed', err);
                });
              }}
            />
          </section>
        </div>
      </motion.aside>
    </motion.div>
  );
}

// ── 结果区段 ──

function ResultBlock({ result, onDownload }: { result: ToolResultPayload; onDownload?: () => void }) {
  if (result.status === 'loading') {
    return <p className={styles.toolInspectorEmpty}>{t('tool.inspector.resultLoading')}</p>;
  }
  if (result.status === 'available' && result.text !== undefined) {
    return <pre className={styles.toolInspectorPre}>{result.text}</pre>;
  }
  if (result.status === 'available' && result.details !== undefined) {
    return <pre className={styles.toolInspectorPre}>{formatJson(result.details)}</pre>;
  }
  if (result.status === 'too_large') {
    return (
      <div className={`${styles.toolInspectorEmpty} ${styles.toolInspectorTooLarge}`}>
        <p>
          {t('tool.inspector.resultTooLarge', {
            total: result.totalBytes ?? 0,
            limit: result.inlineLimitBytes ?? 0,
          })}
        </p>
        {onDownload && (
          <button
            type="button"
            className={styles.toolInspectorCopy}
            onClick={onDownload}
          >
            {t('tool.inspector.downloadAsTxt')}
          </button>
        )}
      </div>
    );
  }
  // unavailable / unsupported：明确告诉用户为什么拿不到
  return (
    <p className={styles.toolInspectorEmpty}>
      {result.reason || t('tool.inspector.resultUnavailable')}
    </p>
  );
}

// ── helpers ──

function shortPath(path: string): string {
  const sep = path.includes('/') ? '/' : '\\';
  const parts = path.split(sep);
  if (parts.length <= 4) return path;
  return `…${sep}${parts.slice(-3).join(sep)}`;
}

/** 把 ToolResultPayload 折成可复制的纯文本。loading / unavailable / too_large 返回空串。 */
function resultText(result: ToolResultPayload): string {
  if (result.status === 'available') {
    if (result.text !== undefined) return result.text;
    if (result.details !== undefined) return formatJson(result.details);
  }
  return '';
}

/**
 * 一键复制按钮。复制成功后短暂显示"已复制"反馈。
 * 计时器在 unmount 时清理，避免 setState-after-unmount。
 */
function CopyButton({ text, disabled }: { text: string; disabled?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
  }, []);

  const handleClick = useCallback(async () => {
    if (disabled || !text) return;
    const ok = await copyToClipboard(text);
    if (!ok) return;
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setCopied(false), 1200);
  }, [disabled, text]);

  return (
    <button
      type="button"
      className={styles.toolInspectorCopy}
      onClick={handleClick}
      disabled={disabled || !text}
      aria-label={t('tool.inspector.copy')}
      title={t('tool.inspector.copy')}
    >
      {copied ? t('tool.inspector.copied') : t('tool.inspector.copy')}
    </button>
  );
}