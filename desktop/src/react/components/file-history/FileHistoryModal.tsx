/**
 * 统一历史管理弹窗：左/文件列表（含已删除分组）、中/版本时间线、右/diff 与还原。
 * 所有入口（preview 悬浮按钮、文件树右键）都只是 openFileHistoryModal 的调用方，表面唯一。
 *
 * diff 语义："当前内容 → 选中快照"，即还原后会发生什么：added 行是还原将写回的内容，
 * removed 行是将被替换的当前内容。当前内容读不到（已删除/远端 mount）时降级为与上一版本
 * 比对，再不行展示快照全文（不做假 diff）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Overlay } from '../../ui';
import { useI18n } from '../../hooks/use-i18n';
import { useStore } from '../../stores';
import {
  fetchHistoryFiles, fetchHistoryVersions, fetchHistorySnapshot, restoreHistorySnapshot,
  type FileHistoryFileEntry, type FileHistoryVersionEntry,
} from '../../utils/file-history-api';
import { diffLines, type DiffLine } from '../../utils/line-diff';
import styles from './FileHistoryModal.module.css';

export function FileHistoryModal() {
  const { t } = useI18n();
  const modal = useStore(s => s.fileHistoryModal);
  const close = useStore(s => s.closeFileHistoryModal);
  const agentId = useStore(s => s.currentAgentId);
  const nativeRoot = useStore(s => s.deskWorkspaceNativeRoot || s.deskBasePath);

  const [files, setFiles] = useState<FileHistoryFileEntry[]>([]);
  const [filter, setFilter] = useState('');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [versions, setVersions] = useState<FileHistoryVersionEntry[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [snapshotText, setSnapshotText] = useState<string | null>(null);
  const [currentText, setCurrentText] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'restoring' | 'restored' | 'error'>('idle');

  // 打开时装载文件列表 + 应用预选
  useEffect(() => {
    if (!modal.open || !agentId) return;
    setStatus('loading');
    fetchHistoryFiles(agentId)
      .then(list => {
        setFiles(list);
        setStatus('idle');
        setSelectedPath(modal.preselectRelPath && list.some(f => f.relPath === modal.preselectRelPath)
          ? modal.preselectRelPath : null);
      })
      .catch(() => setStatus('error'));
  }, [modal.open, modal.preselectRelPath, agentId]);

  // 选中文件 → 装载版本
  useEffect(() => {
    if (!modal.open || !agentId || !selectedPath) { setVersions([]); setSelectedVersion(null); return; }
    fetchHistoryVersions(agentId, selectedPath)
      .then(list => { setVersions(list); setSelectedVersion(list[0]?.id ?? null); })
      .catch(() => setStatus('error'));
  }, [modal.open, agentId, selectedPath]);

  // 选中版本 → 装载快照与当前内容
  useEffect(() => {
    if (!agentId || selectedVersion == null) { setSnapshotText(null); setCurrentText(null); return; }
    let cancelled = false;
    (async () => {
      const snapshot = await fetchHistorySnapshot(agentId, selectedVersion).catch(() => null);
      if (cancelled || !snapshot) return;
      setSnapshotText(snapshot.content);
      let current: string | null = null;
      if (nativeRoot && selectedPath) {
        const abs = `${nativeRoot.replace(/\/+$/, '')}/${selectedPath}`;
        const snap = await window.platform?.readFileSnapshot?.(abs).catch(() => null);
        current = snap?.content ?? null;
      }
      if (current == null) {
        const idx = versions.findIndex(v => v.id === selectedVersion);
        const prev = versions[idx + 1];
        if (prev) {
          const prevSnap = await fetchHistorySnapshot(agentId, prev.id).catch(() => null);
          current = prevSnap?.content ?? null;
        }
      }
      if (!cancelled) setCurrentText(current);
    })();
    return () => { cancelled = true; };
  }, [agentId, selectedVersion, selectedPath, nativeRoot, versions]);

  const diff: DiffLine[] | null = useMemo(() => {
    if (snapshotText == null) return null;
    if (currentText == null) return snapshotText.split('\n').map(text => ({ kind: 'same' as const, text }));
    return diffLines(currentText, snapshotText);
  }, [snapshotText, currentText]);

  /**
   * diff 是“当前内容 → 选中快照”语义（还原后会发生什么）：
   *   - added 行 = 快照有、当前没，oldLine 留空
   *   - removed 行 = 当前有、快照没，newLine 留空
   *   - same 行 = 两边都有，两侧行号同步递增
   * 返回的 lines 把行号付上，渲染侧只负责拼出三列。
   *
   * singleColumn：第一个版本（或当前内容读不到）时 diff 退化成快照全文，全部 same，
   * 没有对比语义——只展示一列行号，统计栏也隐藏。
   */
  const numberedDiff = useMemo(() => {
    if (!diff) return null;
    const singleColumn = currentText == null;
    let oldLine = 1;
    let newLine = 1;
    let added = 0;
    let removed = 0;
    // 显式联合类型：三种 kind 的字段集不同（added 只有 newLine、removed 只有 oldLine），
    // 统一成可选字段避免渲染侧访问 line.oldLine / line.newLine 时 TS 报错。
    type NumberedDiffLine = {
      kind: DiffLine['kind'];
      text: string;
      oldLine?: number;
      newLine?: number;
    };
    const lines: NumberedDiffLine[] = diff.map((line) => {
      if (line.kind === 'added') {
        added++;
        const result: NumberedDiffLine = { kind: line.kind, text: line.text, newLine };
        newLine++;
        return result;
      }
      if (line.kind === 'removed') {
        removed++;
        const result: NumberedDiffLine = { kind: line.kind, text: line.text, oldLine };
        oldLine++;
        return result;
      }
      const result: NumberedDiffLine = { kind: line.kind, text: line.text, oldLine, newLine };
      oldLine++;
      newLine++;
      return result;
    });
    return { lines, added, removed, singleColumn };
  }, [diff, currentText]);

  const handleRestore = useCallback(async () => {
    if (!agentId || selectedVersion == null || !selectedPath) return;
    setStatus('restoring');
    try {
      await restoreHistorySnapshot(agentId, selectedVersion);
      setStatus('restored');
      const list = await fetchHistoryVersions(agentId, selectedPath);
      setVersions(list);
    } catch {
      setStatus('error');
    }
  }, [agentId, selectedVersion, selectedPath]);

  const visibleFiles = files.filter(f => !filter || f.relPath.includes(filter));
  const activeFiles = visibleFiles.filter(f => f.deletedAt == null);
  const deletedFiles = visibleFiles.filter(f => f.deletedAt != null);

  return (
    <Overlay scope="inline" open={modal.open} onClose={close} backdrop="blur" className={styles.modal} disableContainerAnimation>
      <div className={styles.header}>
        <h2 className={styles.title}>{t('fileHistory.title')}</h2>
        <button className={styles.closeBtn} onClick={close} aria-label="Close">×</button>
      </div>
      <div className={styles.body}>
        <aside className={styles.fileList}>
          <input
            className={styles.search}
            value={filter}
            onChange={e => setFilter(e.target.value)}
            placeholder={t('fileHistory.searchPlaceholder')}
          />
          {activeFiles.map(f => (
            <button key={f.relPath} type="button"
              title={f.relPath}
              className={`${styles.fileRow}${selectedPath === f.relPath ? ` ${styles.fileRowActive}` : ''}`}
              onClick={() => setSelectedPath(f.relPath)}>
              {f.relPath}
            </button>
          ))}
          {deletedFiles.length > 0 && (
            <div className={styles.deletedGroup}>
              <div className={styles.groupLabel}>{t('fileHistory.deletedGroup')}</div>
              {deletedFiles.map(f => (
                <button key={f.relPath} type="button"
                  title={f.relPath}
                  className={`${styles.fileRow} ${styles.fileRowDeleted}${selectedPath === f.relPath ? ` ${styles.fileRowActive}` : ''}`}
                  onClick={() => setSelectedPath(f.relPath)}>
                  {f.relPath}
                </button>
              ))}
            </div>
          )}
          {files.length === 0 && status !== 'loading' && (
            <div className={styles.empty}>{t('fileHistory.empty')}</div>
          )}
        </aside>
        <section className={styles.timeline}>
          {versions.map(v => (
            <button key={v.id} type="button" data-testid={`fh-version-${v.id}`}
              className={`${styles.versionRow}${selectedVersion === v.id ? ` ${styles.versionRowActive}` : ''}`}
              onClick={() => setSelectedVersion(v.id)}>
              <span className={styles.versionTime}>{new Date(v.capturedAt).toLocaleString()}</span>
              <span className={styles.versionOrigin}>{t(`fileHistory.origin.${v.origin}`)}</span>
            </button>
          ))}
          {selectedPath && versions.length === 0 && (
            <div className={styles.empty}>{t('fileHistory.noVersions')}</div>
          )}
        </section>
        <section className={styles.diffPane}>
          {numberedDiff ? (
            <>
              {/* diff 顶部统计：一眼看出这个版本相对当前加多少减多少。
                  第一个版本（无对比语义）时隐藏。 */}
              {!numberedDiff.singleColumn && (
                <div className={styles.diffStats}>
                  <span className={styles.diffStatsAdded}>+{numberedDiff.added}</span>
                  <span className={styles.diffStatsRemoved}>-{numberedDiff.removed}</span>
                </div>
              )}
              <pre className={styles.diff} data-testid="fh-diff">
                {numberedDiff.lines.map((line, i) => {
                  const className =
                    line.kind === 'added' ? styles.lineAdded
                    : line.kind === 'removed' ? styles.lineRemoved
                    : styles.lineSame;
                  return (
                    <div key={i} className={className}>
                      {numberedDiff.singleColumn ? (
                        // 快照全文：只有新文件一侧，单列行号即可
                        <span className={styles.lineNum}>{line.newLine ?? ''}</span>
                      ) : (
                        <>
                          <span className={styles.lineNum}>{line.oldLine ?? ''}</span>
                          <span className={styles.lineNum}>{line.newLine ?? ''}</span>
                        </>
                      )}
                      <span className={styles.lineContent}>{line.text || ' '}</span>
                    </div>
                  );
                })}
              </pre>
            </>
          ) : snapshotText != null ? (
            <pre className={styles.diff}>{snapshotText}</pre>
          ) : (
            <div className={styles.empty}>{t('fileHistory.selectVersion')}</div>
          )}
          <div className={styles.actions}>
            {status === 'restored' && <span className={styles.restoredNote}>{t('fileHistory.restoreDone')}</span>}
            {status === 'error' && <span className={styles.errorNote}>{t('fileHistory.error')}</span>}
            <button type="button" data-testid="fh-restore" className={styles.restoreBtn}
              disabled={selectedVersion == null || status === 'restoring'}
              onClick={handleRestore}>
              {t('fileHistory.restore')}
            </button>
          </div>
        </section>
      </div>
    </Overlay>
  );
}
