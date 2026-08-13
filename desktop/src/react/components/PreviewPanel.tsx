/**
 * PreviewPanel — PreviewItem 预览/编辑面板
 *
 * 从 Zustand store 读取 previewItem 内容池，以及当前 workspace 恢复出的 activeTabId / previewOpen 状态。
 * 可编辑类型（有 filePath 的 markdown/code/csv）使用 CodeMirror 编辑器。
 *
 * 架构原则：
 * - 文件系统是 source of truth，编辑器直接对接文件
 * - PreviewItem content 仅作为前端视图快照，给复制/临时渲染预览使用
 * - 独立窗口由下阶段的 viewer spawn 机制负责（单向只读副本），本面板不做 detach/dock
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useStore } from '../stores';
import { selectPreviewItems, selectActiveTabId, selectOpenTabs, selectMarkdownPreviewIds, selectPreviewReadingPositions } from '../stores/preview-slice';
import { setMarkdownPreviewActive, upsertPreviewItem, updatePreviewReadingPosition } from '../stores/preview-actions';
import { PreviewEditor, type PreviewEditorHandle, type PreviewEditorStats } from './PreviewEditor';
import { HtmlPreview, PreviewRenderer } from './preview/PreviewRenderer';
import { readFileForPreviewType } from '../utils/preview-file-content';
import { TabBar } from './preview/TabBar';
import { FloatingActions } from './preview/FloatingActions';
import { ChapterRail, ClassicFindBox, LinkDiagnosticsBadge } from './preview/MarkdownChrome';
import {
  clearSelection,
  getSelectionCommitAnchorRect,
  isContextMenuButton,
  quotePreviewRangeToChat,
  scheduleCaptureSelection,
} from '../stores/selection-actions';
import type { PreviewItem } from '../types';
import { isRemoteWorkbenchContentRef, saveRemoteWorkbenchContent } from '../utils/remote-file-preview';
import { applyFindMarks, clearFindMarks } from '../utils/find-marks';
import { OpenPreviewDocumentWatchBridge } from './app/OpenPreviewDocumentWatchBridge';
import {
  extractMarkdownHeadings,
  findCurrentHeading,
  hashMarkdownContent,
  type MarkdownHeading,
} from '../utils/markdown-document';
import type { PreviewScrollSnapshot } from '../../../../shared/preview-reading-position.ts';
import previewStyles from './Preview.module.css';

const EDITABLE_TYPES = new Set(['markdown', 'code', 'csv']);
const CHAPTER_RAIL_HOVER_ZONE_PX = 64;
const CHAPTER_RAIL_TOP_OFFSET_PX = 76;
const CHAPTER_RAIL_HEIGHT_RATIO = 0.5;

/** 提纲导轨悬停热区命中判定：右缘（与聊天页 ChatMessageSurface.handleShellPointerMove 一致）。
    抽成纯函数以便单测：PreviewPanel 渲染栈重（platform/store/resource-watch 依赖），
    直接对 pointermove 断言需要 mock 出真实 rect 尺寸，不如把几何判定单独验证。 */
export function chapterRailHoverHit(
  rect: { top: number; right: number; height: number },
  clientX: number,
  clientY: number,
): boolean {
  const xFromRight = rect.right - clientX;
  const yFromTop = clientY - rect.top;
  const inRailX = xFromRight >= 0 && xFromRight <= CHAPTER_RAIL_HOVER_ZONE_PX;
  const inRailY = yFromTop >= CHAPTER_RAIL_TOP_OFFSET_PX
    && yFromTop <= CHAPTER_RAIL_TOP_OFFSET_PX + rect.height * CHAPTER_RAIL_HEIGHT_RATIO;
  return inRailX && inRailY;
}

function isEditable(previewItem: PreviewItem | null): boolean {
  if (!previewItem) return false;
  if (previewItem.status === 'missing' || previewItem.status === 'expired') return false;
  return EDITABLE_TYPES.has(previewItem.type)
    && (!!previewItem.filePath || isRemoteWorkbenchContentRef(previewItem.remoteContentRef));
}

function isMarkdownFile(previewItem: PreviewItem | null): boolean {
  return !!previewItem
    && previewItem.status !== 'missing'
    && previewItem.status !== 'expired'
    && previewItem.type === 'markdown'
    && (!!previewItem.filePath || isRemoteWorkbenchContentRef(previewItem.remoteContentRef));
}

function getEditorMode(previewItem: PreviewItem): 'markdown' | 'code' | 'csv' | 'text' {
  if (previewItem.type === 'markdown') return 'markdown';
  if (previewItem.type === 'csv') return 'csv';
  return 'code';
}

function countPreviewChars(text: string): number {
  return Array.from(text).length;
}

function formatMarkdownEditorStatus(stats: PreviewEditorStats): string {
  const fallback = `选中 ${stats.selectedChars} 字 · 共 ${stats.totalChars} 字`;
  const translated = window.t?.('preview.markdownEditorStatus', {
    selected: stats.selectedChars,
    total: stats.totalChars,
  });
  return translated && translated !== 'preview.markdownEditorStatus' ? translated : fallback;
}

function scrollRatio(scrollTop: number, scrollHeight: number, clientHeight: number): number {
  const max = Math.max(0, scrollHeight - clientHeight);
  return max > 0 ? Math.min(1, Math.max(0, scrollTop / max)) : 0;
}

function escapeCssId(id: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (typeof css?.escape === 'function') return css.escape(id);
  return id.replace(/["\\#.:,[\]=]/g, '\\$&');
}

function sourceFindMatches(content: string, query: string): Array<{ from: number; to: number }> {
  if (!query) return [];
  const matches: Array<{ from: number; to: number }> = [];
  const lower = content.toLowerCase();
  const needle = query.toLowerCase();
  let index = lower.indexOf(needle);
  while (index >= 0) {
    matches.push({ from: index, to: index + query.length });
    index = lower.indexOf(needle, index + Math.max(1, query.length));
  }
  return matches;
}

export function PreviewPanel() {
  const previewOpen = useStore(s => s.previewOpen);
  const activeTabId = useStore(selectActiveTabId);
  const openTabs = useStore(selectOpenTabs);
  const previewItems = useStore(selectPreviewItems);
  const markdownPreviewIds = useStore(selectMarkdownPreviewIds);
  const previewReadingPositions = useStore(selectPreviewReadingPositions);
  const [editorStats, setEditorStats] = useState<PreviewEditorStats>({ selectedChars: 0, totalChars: 0 });
  const [wordWrap, setWordWrap] = useState(false);
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  // html 文件：edit 模式（code 编辑器）vs render 模式（iframe）独立 toggle，按文件 id 存
  const [htmlEditModes, setHtmlEditModes] = useState<Record<string, boolean>>({});
  const [htmlZoomLevels, setHtmlZoomLevels] = useState<Record<string, number>>({});
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [chapterRailVisible, setChapterRailVisible] = useState(false);
  const previewBodyRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PreviewEditorHandle | null>(null);
  const previewScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredPreviewKeyRef = useRef('');
  const activeHeadingRef = useRef<string | null>(null);
  const previewFindMarksRef = useRef<HTMLElement[]>([]);

  const previewItem = previewItems.find(a => a.id === activeTabId) ?? null;
  const markdownPreviewActive = !!previewItem && markdownPreviewIds.includes(previewItem.id);
  const editable = isEditable(previewItem) && !markdownPreviewActive;
  const markdownFile = isMarkdownFile(previewItem);
  const showMarkdownEditorStatus = editable && previewItem?.type === 'markdown';
  // wrap 按钮是代码编辑器专属特性：markdown / csv 走的是居中排版规则，wrap 由 max-width 控制，不需要用户手动切换
  const isCodeFile = editable && !!previewItem && getEditorMode(previewItem) === 'code';
  // html 文件专属：edit 模式 = code 编辑器（与 html kind 一致：code mode + html 语言）；render 模式 = iframe
  const isHtmlFile = !!previewItem && previewItem.type === 'html' && previewItem.status !== 'missing' && previewItem.status !== 'expired';
  const htmlEditMode = isHtmlFile && (htmlEditModes[previewItem.id] ?? false);
  // .html 默认预览模式内容在 <iframe> 里，applyFindMarks 走不到 iframe 内部的 document，
  // 所以这块完全禁掉 find：Cmd+F 不响应、find box 不渲染。切换到编辑模式后 isHtmlFile
  // + htmlEditMode 走编辑器分支，find 正常开启。
  const findEnabled = !previewItem || !isHtmlFile || htmlEditMode;
  const htmlZoom = isHtmlFile ? (htmlZoomLevels[previewItem.id] ?? 1) : 1;
  // html 处于 edit 模式时等价为“代码编辑”，因此走编辑器分支；mode/codeTheme、语言 html
  const effectiveEditable = editable || (isHtmlFile && htmlEditMode);
  const effectiveEditorMode: 'markdown' | 'code' | 'csv' | 'text' =
    isHtmlFile && htmlEditMode ? 'code' : (previewItem ? getEditorMode(previewItem) : 'code');
  const effectiveEditorLanguage = isHtmlFile && htmlEditMode ? 'html' : (previewItem?.language ?? null);
  const contentHash = useMemo(() => previewItem?.type === 'markdown' ? hashMarkdownContent(previewItem.content) : '', [previewItem?.content, previewItem?.type]);
  const markdownHeadings = useMemo(
    () => previewItem?.type === 'markdown' ? extractMarkdownHeadings(previewItem.content, 3) : [],
    [previewItem?.content, previewItem?.type],
  );
  const readingPosition = previewItem ? previewReadingPositions[previewItem.id] || null : null;
  const saveDocument = useMemo(() => {
    const remoteRef = previewItem?.remoteContentRef;
    if (!isRemoteWorkbenchContentRef(remoteRef)) return undefined;
    return (content: string, expectedVersion?: PreviewItem['fileVersion']) =>
      saveRemoteWorkbenchContent(remoteRef, content, expectedVersion ?? null);
  }, [previewItem?.remoteContentRef]);

  const handleToggleMarkdownPreview = useCallback(() => {
    if (!previewItem || !isMarkdownFile(previewItem)) return;
    setMarkdownPreviewActive(previewItem.id, !markdownPreviewActive);
  }, [previewItem, markdownPreviewActive]);

  const handleToggleWordWrap = useCallback(() => {
    setWordWrap(current => !current);
  }, []);

  // html 文件的 edit ↔ render 模式切换（按 id 存储）
  const handleToggleHtmlEdit = useCallback((id: string) => {
    setHtmlEditModes(prev => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const handleZoomIn = useCallback((id: string) => {
    setHtmlZoomLevels(prev => {
      const current = prev[id] ?? 1;
      const next = Math.min(2, +(current + 0.25).toFixed(2));
      return { ...prev, [id]: next };
    });
  }, []);

  const handleZoomOut = useCallback((id: string) => {
    setHtmlZoomLevels(prev => {
      const current = prev[id] ?? 1;
      const next = Math.max(0.5, +(current - 0.25).toFixed(2));
      return { ...prev, [id]: next };
    });
  }, []);

  // 关闭/切换 tab 时清理失效的 html 状态，避免内存里堆一堆无用 id
  useEffect(() => {
    setHtmlEditModes(prev => {
      const next: Record<string, boolean> = {};
      for (const id of openTabs) if (prev[id] !== undefined) next[id] = prev[id];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
    setHtmlZoomLevels(prev => {
      const next: Record<string, number> = {};
      for (const id of openTabs) if (prev[id] !== undefined) next[id] = prev[id];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [openTabs]);

  const handleEditorContentChange = useCallback((content: string, fileVersion?: PreviewItem['fileVersion']) => {
    if (!previewItem) return;
    upsertPreviewItem({
      ...previewItem,
      content,
      fileVersion: fileVersion === undefined ? previewItem.fileVersion : fileVersion,
    });
  }, [previewItem]);

  const handleEditorStatsChange = useCallback((stats: PreviewEditorStats) => {
    setEditorStats(stats);
  }, []);

  const currentPreviewHeading = useCallback((): MarkdownHeading | null => {
    const body = previewBodyRef.current;
    if (!body || markdownHeadings.length === 0) return null;
    const bodyTop = body.getBoundingClientRect().top + 56;
    let current: MarkdownHeading | null = markdownHeadings[0] || null;
    for (const heading of markdownHeadings) {
      const el = body.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(heading.id)}`);
      if (!el) continue;
      if (el.getBoundingClientRect().top <= bodyTop) current = heading;
      else break;
    }
    return current;
  }, [markdownHeadings]);

  const publishPreviewScrollSnapshot = useCallback(() => {
    previewScrollTimerRef.current = null;
    if (!previewItem || !markdownFile || editable) return;
    const body = previewBodyRef.current;
    if (!body) return;
    const heading = currentPreviewHeading();
    if (heading?.id !== activeHeadingRef.current) {
      activeHeadingRef.current = heading?.id ?? null;
      setActiveHeadingId(heading?.id ?? null);
    }
    updatePreviewReadingPosition(previewItem.id, 'preview', {
      scrollTop: body.scrollTop,
      scrollLeft: body.scrollLeft,
      scrollHeight: body.scrollHeight,
      clientHeight: body.clientHeight,
      ratio: scrollRatio(body.scrollTop, body.scrollHeight, body.clientHeight),
      ...(heading ? { anchorId: heading.id, anchorText: heading.text } : {}),
      contentHash,
    }, heading ? { id: heading.id, text: heading.text } : null);
  }, [contentHash, currentPreviewHeading, editable, markdownFile, previewItem]);

  const schedulePreviewScrollSnapshot = useCallback(() => {
    if (previewScrollTimerRef.current) clearTimeout(previewScrollTimerRef.current);
    previewScrollTimerRef.current = setTimeout(publishPreviewScrollSnapshot, 160);
  }, [publishPreviewScrollSnapshot]);

  const handleEditorScrollSnapshot = useCallback((snapshot: PreviewScrollSnapshot, topVisibleLine: number) => {
    if (!previewItem || !markdownFile) return;
    const heading = findCurrentHeading(markdownHeadings, topVisibleLine);
    if (heading?.id !== activeHeadingRef.current) {
      activeHeadingRef.current = heading?.id ?? null;
      setActiveHeadingId(heading?.id ?? null);
    }
    updatePreviewReadingPosition(previewItem.id, 'edit', {
      ...snapshot,
      ...(heading ? { anchorId: heading.id, anchorText: heading.text } : {}),
      contentHash,
    }, heading ? { id: heading.id, text: heading.text } : null);
  }, [contentHash, markdownFile, markdownHeadings, previewItem]);

  const restorePreviewScroll = useCallback(() => {
    if (!previewItem || editable || !markdownFile || !readingPosition?.preview) return;
    const body = previewBodyRef.current;
    if (!body) return;
    const snapshot = readingPosition.preview;
    const key = `${previewItem.id}:preview:${contentHash}:${snapshot.updatedAt || ''}:${snapshot.scrollTop}:${snapshot.anchorId || ''}`;
    if (restoredPreviewKeyRef.current === key) return;
    restoredPreviewKeyRef.current = key;
    const restore = () => {
      if (snapshot.contentHash === contentHash && Number.isFinite(snapshot.scrollTop)) {
        body.scrollTop = Math.max(0, snapshot.scrollTop);
        body.scrollLeft = Math.max(0, snapshot.scrollLeft || 0);
        return;
      }
      if (snapshot.anchorId) {
        const el = body.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(snapshot.anchorId)}`);
        if (el) {
          body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 56;
          return;
        }
      }
      if (Number.isFinite(snapshot.ratio)) {
        body.scrollTop = Math.max(0, (snapshot.ratio || 0) * Math.max(0, body.scrollHeight - body.clientHeight));
      }
    };
    restore();
    queueMicrotask(restore);
    window.requestAnimationFrame?.(restore);
  }, [contentHash, editable, markdownFile, previewItem, readingPosition?.preview]);

  const handleJumpHeading = useCallback((heading: MarkdownHeading) => {
    if (editable) {
      editorRef.current?.scrollToLine(heading.line);
    } else {
      const body = previewBodyRef.current;
      const el = body?.querySelector<HTMLElement>(`.preview-markdown #${escapeCssId(heading.id)}`);
      if (body && el) {
        body.scrollTop += el.getBoundingClientRect().top - body.getBoundingClientRect().top - 56;
      }
    }
    activeHeadingRef.current = heading.id;
    setActiveHeadingId(heading.id);
  }, [editable]);

  const handleBodyShellPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setChapterRailVisible(chapterRailHoverHit(rect, event.clientX, event.clientY));
  }, []);

  const handleBodyShellPointerLeave = useCallback(() => {
    setChapterRailVisible(false);
  }, []);

  // DOM 模式选区捕获（非编辑模式下 mouseup 时检测选中文本）
  const handleMouseUp = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!previewItem || editable) return;
    if (isContextMenuButton(event.nativeEvent)) return;
    scheduleCaptureSelection(previewItem, undefined, getSelectionCommitAnchorRect(event.nativeEvent));
  }, [previewItem, editable]);

  // 切换 tab 时清除选区
  useEffect(() => {
    clearSelection({ sourceKind: 'preview' });
    setEditorStats({
      selectedChars: 0,
      totalChars: previewItem?.type === 'markdown' ? countPreviewChars(previewItem.content) : 0,
    });
    activeHeadingRef.current = readingPosition?.currentHeadingId || null;
    setActiveHeadingId(readingPosition?.currentHeadingId || null);
  }, [activeTabId]); // eslint-disable-line react-hooks/exhaustive-deps -- tab 切换时用当前 active previewItem 初始化状态栏，后续由 PreviewEditor 回调接管

  // 对 file-info PreviewItem 主动 stat 一次：OpenPreviewDocumentWatchBridge 只在文件
  // IO 事件触发后才走 refresh；但如果 PreviewItem 是在文件已不可用之后才挂载的
  // （例如文件被重命名后才打开预览，或重启后 PreviewItem 从 workspace 状态恢复
  // 出来却实际不可访问），watch 不会自捡拾。走一次 readFileForPreviewType 验证。
  useEffect(() => {
    if (!previewItem || previewItem.type !== 'file-info' || !previewItem.filePath) return undefined;
    const filePath = previewItem.filePath;
    let cancelled = false;
    void (async () => {
      try {
        const read = await readFileForPreviewType(filePath, 'file-info');
        if (cancelled) return;
        if (!read) {
          upsertPreviewItem({
            ...previewItem,
            status: 'expired',
            missingAt: Date.now(),
          });
        } else if (previewItem.status === 'expired' || previewItem.status === 'missing') {
          upsertPreviewItem({
            ...previewItem,
            status: undefined,
            missingAt: null,
          });
        }
      } catch {
        // 静默；watcher 后续发现会再走一遍
      }
    })();
    return () => { cancelled = true; };
  }, [previewItem?.id, previewItem?.filePath]); // eslint-disable-line react-hooks/exhaustive-deps -- 依赖 id + filePath 足以重新计算；previewItem 类型在 file-info 分支里是稳定的

  useEffect(() => {
    if (!previewOpen || !previewItem || !markdownFile || editable) return undefined;
    const body = previewBodyRef.current;
    if (!body) return undefined;
    const onScroll = () => schedulePreviewScrollSnapshot();
    body.addEventListener('scroll', onScroll, { passive: true });
    restorePreviewScroll();
    return () => {
      body.removeEventListener('scroll', onScroll);
      if (previewScrollTimerRef.current) {
        clearTimeout(previewScrollTimerRef.current);
        publishPreviewScrollSnapshot();
      }
    };
  }, [editable, markdownFile, previewItem, previewOpen, publishPreviewScrollSnapshot, restorePreviewScroll, schedulePreviewScrollSnapshot]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!previewOpen || !findEnabled) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      event.stopPropagation();
      setFindOpen(true);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [findEnabled, previewOpen]);

  useEffect(() => {
    setFindIndex(0);
  }, [findQuery, activeTabId, editable]);

  useEffect(() => {
    clearFindMarks(previewBodyRef.current, 'preview-find-mark');
    previewFindMarksRef.current = [];
    if (!findOpen || !findQuery || !previewItem || !findEnabled) {
      setFindCount(0);
      return undefined;
    }
    if (effectiveEditable) {
      const matches = sourceFindMatches(previewItem.content, findQuery);
      setFindCount(matches.length);
      const match = matches[Math.min(findIndex, Math.max(0, matches.length - 1))];
      if (match) editorRef.current?.scrollToOffset(match.from, match.to, { focus: false });
      return undefined;
    }
    const marks = applyFindMarks(previewBodyRef.current, [findQuery], 'preview-find-mark');
    previewFindMarksRef.current = marks;
    setFindCount(marks.length);
    return () => {
      clearFindMarks(previewBodyRef.current, 'preview-find-mark');
      previewFindMarksRef.current = [];
    };
  }, [activeTabId, effectiveEditable, findEnabled, findIndex, findOpen, findQuery, previewItem]);

  useEffect(() => {
    const marks = previewFindMarksRef.current;
    for (const mark of marks) mark.classList.remove('preview-find-mark-active');
    const active = marks[Math.min(findIndex, Math.max(0, marks.length - 1))];
    if (active) {
      active.classList.add('preview-find-mark-active');
      active.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
  }, [findIndex, findCount]);

  const goFind = useCallback((direction: 1 | -1) => {
    setFindIndex(index => {
      if (findCount <= 0) return 0;
      return (index + direction + findCount) % findCount;
    });
  }, [findCount]);

  return (
    <div
      className={`${previewStyles.previewPanel}${previewOpen ? '' : ` ${previewStyles.previewPanelCollapsed}`}`}
      id="previewPanel"
      data-preview-open={previewOpen ? 'true' : 'false'}
    >
      <OpenPreviewDocumentWatchBridge />
      <div className="resize-handle resize-handle-left" id="previewResizeHandle"></div>
      <div className={previewStyles.previewPanelInner} data-preview-panel-inner="">
        <TabBar />
        <div
          className={previewStyles.previewBodyShell}
          data-preview-body-shell=""
          onPointerMove={handleBodyShellPointerMove}
          onPointerLeave={handleBodyShellPointerLeave}
        >
          {previewOpen && previewItem && markdownFile && (
            <ChapterRail
              headings={markdownHeadings}
              activeHeadingId={activeHeadingId}
              railVisible={chapterRailVisible}
              onJump={handleJumpHeading}
            />
          )}
          <ClassicFindBox
            open={findOpen && findEnabled}
            query={findQuery}
            resultIndex={Math.min(findIndex, Math.max(0, findCount - 1))}
            resultCount={findCount}
            onQueryChange={setFindQuery}
            onPrevious={() => goFind(-1)}
            onNext={() => goFind(1)}
            onClose={() => setFindOpen(false)}
          />
          {previewOpen && previewItem && previewItem.status !== 'missing' && (
            <FloatingActions
              content={previewItem.content}
              filePath={previewItem.filePath}
              remoteContentRef={previewItem.remoteContentRef}
              contentType={previewItem.type}
              language={previewItem.language}
              showMarkdownPreviewToggle={isMarkdownFile(previewItem)}
              markdownPreviewActive={markdownPreviewActive}
              onToggleMarkdownPreview={handleToggleMarkdownPreview}
              wordWrap={isCodeFile || (isHtmlFile && htmlEditMode) ? wordWrap : false}
              onToggleWordWrap={isCodeFile || (isHtmlFile && htmlEditMode) ? handleToggleWordWrap : undefined}
              onZoomIn={isHtmlFile && !htmlEditMode ? () => handleZoomIn(previewItem.id) : undefined}
              onZoomOut={isHtmlFile && !htmlEditMode ? () => handleZoomOut(previewItem.id) : undefined}
              htmlEditMode={isHtmlFile ? htmlEditMode : false}
              onToggleHtmlEdit={isHtmlFile ? () => handleToggleHtmlEdit(previewItem.id) : undefined}
              expired={previewItem.status === 'expired'}
            />
          )}
          <div ref={previewBodyRef} className={`universal-card ${previewStyles.previewPanelBody}`} id="previewBody" data-preview-panel-body="" onMouseUp={handleMouseUp}>
            {previewOpen && previewItem && isHtmlFile && !htmlEditMode && (
              <HtmlPreview previewItem={previewItem} zoom={htmlZoom} />
            )}
            {previewOpen && previewItem && !effectiveEditable && !isHtmlFile && (
              <PreviewRenderer previewItem={previewItem} />
            )}
            {previewOpen && previewItem && effectiveEditable && (
              <PreviewEditor
                ref={editorRef}
                content={previewItem.content}
                filePath={previewItem.filePath}
                remoteContentRef={previewItem.remoteContentRef}
                fileVersion={previewItem.fileVersion ?? previewItem.remoteContentRef?.version ?? null}
                saveDocument={saveDocument}
                mode={effectiveEditorMode}
                language={effectiveEditorLanguage}
                onSelectionCommit={(view) => {
                  if (previewItem) scheduleCaptureSelection(previewItem, view);
                }}
                onQuoteRange={(view, range) => {
                  if (previewItem) quotePreviewRangeToChat(previewItem, view, range);
                }}
                onStatsChange={handleEditorStatsChange}
                onContentChange={handleEditorContentChange}
                initialScrollSnapshot={readingPosition?.edit ?? null}
                contentHash={contentHash}
                onScrollSnapshotChange={handleEditorScrollSnapshot}
                wordWrap={isCodeFile || (isHtmlFile && htmlEditMode) ? wordWrap : false}
              />
            )}
            {previewOpen && previewItem && editable && previewItem.type === 'markdown' && (
              <LinkDiagnosticsBadge previewItem={previewItem} headings={markdownHeadings} />
            )}
            {previewOpen && previewItem && showMarkdownEditorStatus && (
              <div
                className={previewStyles.markdownEditorStatus}
                data-testid="markdown-editor-status"
                aria-live="polite"
              >
                {formatMarkdownEditorStatus(editorStats)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
