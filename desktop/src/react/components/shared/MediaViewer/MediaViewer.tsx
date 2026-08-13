import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { spring } from '@/ui/motion';
import { useStore } from '../../../stores';
import { isMediaKind } from '../../../utils/file-kind';
import { fileRefVersionToken } from '../../../services/resource-url';
import { ImageStage, type ImageStageActions } from './ImageStage';
import { VideoStage } from './VideoStage';
import styles from './MediaViewer.module.css';

declare function t(key: string, vars?: Record<string, string | number>): string;

export function MediaViewer() {
  const state = useStore(s => s.mediaViewer);
  const closeMediaViewer = useStore(s => s.closeMediaViewer);
  const setMediaViewerCurrent = useStore(s => s.setMediaViewerCurrent);

  const containerRef = useRef<HTMLDivElement>(null);
  const stageWrapRef = useRef<HTMLDivElement>(null);
  const imageStageRef = useRef<ImageStageActions | null>(null);
  const [chromeVisible, setChromeVisible] = useState(true);
  const idleTimerRef = useRef<number | null>(null);
  // 初始值同步读 window 尺寸，避免 mount 后第一帧 stageSize 拿不到真实值时 fit scale 算成 1×1
  // 导致图片贴到 (0,0) / 缩到看不见。stageWrap 实际尺寸由后续 ResizeObserver 覆盖。
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1,
    height: typeof window !== 'undefined' ? window.innerHeight : 1,
  }));
  const [zoomCmd, setZoomCmd] = useState({ in: 0, out: 0, reset: 0 });
  /** 镜像 ImageStage 的 scale，让顶层工具栏能决定“1:1 / fit”图标。 */
  const [imageScale, setImageScale] = useState<number>(1);

  // 只关心 open/close 切换，不关心 state 内容变化，提成布尔以满足 exhaustive-deps
  const isOpen = !!state;

  // 尺寸追踪：用 stageWrap 实际尺寸（不是 window），避免顶栏占用上下空间后
  // fit scale 算出“图片超出可视区”的结果。
  useEffect(() => {
    if (!isOpen) return;
    const stageWrap = stageWrapRef.current;
    if (!stageWrap) return;
    const update = () => {
      const rect = stageWrap.getBoundingClientRect();
      // width/height 可能为 0（该节点刚 mount 还没布局）。保留上次的值，不滥用默认值。
      if (rect.width > 0 && rect.height > 0) {
        setViewport({ width: rect.width, height: rect.height });
      }
    };
    update();
    // jsdom 测试环境不提供 ResizeObserver，仅用 window.resize 兜底。
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(stageWrap);
      window.addEventListener('resize', update);
      return () => {
        ro.disconnect();
        window.removeEventListener('resize', update);
      };
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  // 控件淡出
  const kickIdleTimer = useCallback(() => {
    setChromeVisible(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => setChromeVisible(false), 2500);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    kickIdleTimer();
    const onMove = () => kickIdleTimer();
    window.addEventListener('mousemove', onMove);
    return () => {
      window.removeEventListener('mousemove', onMove);
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [isOpen, kickIdleTimer]);

  // 切换逻辑
  const currentIndex = useMemo(() => {
    if (!state) return -1;
    return state.files.findIndex(f => f.id === state.currentId);
  }, [state]);

  const canPrev = currentIndex > 0;
  const canNext = state ? currentIndex >= 0 && currentIndex < state.files.length - 1 : false;

  const goPrev = useCallback(() => {
    if (!state || !canPrev) return;
    setMediaViewerCurrent(state.files[currentIndex - 1].id);
  }, [state, canPrev, currentIndex, setMediaViewerCurrent]);

  const goNext = useCallback(() => {
    if (!state || !canNext) return;
    setMediaViewerCurrent(state.files[currentIndex + 1].id);
  }, [state, canNext, currentIndex, setMediaViewerCurrent]);

  // 键盘快捷键（window 级，挂 `useEffect`）
  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      // 避免和原生 <video> 冲突：video focus 时 Space 留给原生
      if (e.key === ' ' && document.activeElement instanceof HTMLVideoElement) return;
      switch (e.key) {
        case 'Escape': e.preventDefault(); closeMediaViewer(); break;
        case 'ArrowLeft': e.preventDefault(); goPrev(); break;
        case 'ArrowRight': e.preventDefault(); goNext(); break;
        case '+':
        case '=':
          e.preventDefault();
          setZoomCmd((c) => ({ ...c, in: c.in + 1 }));
          break;
        case '-':
          e.preventDefault();
          setZoomCmd((c) => ({ ...c, out: c.out + 1 }));
          break;
        case '0':
          e.preventDefault();
          setZoomCmd((c) => ({ ...c, reset: c.reset + 1 }));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, closeMediaViewer, goPrev, goNext]);

  // 自动关闭：当前文件丢失或非媒体类型
  useEffect(() => {
    if (!state) return;
    const current = state.files.find(f => f.id === state.currentId);
    if (!current || !isMediaKind(current.kind)) {
      closeMediaViewer();
    }
  }, [state, closeMediaViewer]);

  if (!state) return null;

  const current = state.files[currentIndex];
  if (!current || !isMediaKind(current.kind)) return null;
  const prev = canPrev ? state.files[currentIndex - 1] : undefined;
  const next = canNext ? state.files[currentIndex + 1] : undefined;
  const multi = state.files.length > 1;
  const isActualSize = Math.abs(imageScale - 1) < 0.01;

  // 仅 X 按钮 / ESC 键可关闭，点空白不再响应。

  return (
    <motion.div
      ref={containerRef}
      className={styles.overlay}
      role="dialog"
      aria-modal="true"
      aria-label={t('mediaViewer.ariaLabel')}
      data-testid="media-viewer-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={spring.paperSnap}
    >
      {/* 顶栏：左侧文件名 + 序号，右侧操作按钮 */}
      <div className={`${styles.topbar} ${chromeVisible ? '' : styles.hidden}`}>
        <div className={styles.topbarInfo} data-testid="media-viewer-topbar-info">
          {multi && (
            <span className={styles.index} data-testid="media-viewer-index">
              {currentIndex + 1} / {state.files.length}
            </span>
          )}
          <span className={styles.topbarName} data-testid="media-viewer-name" title={current.name}>
            {current.name}
          </span>
        </div>
        <div className={styles.topbarActions}>
          {current.kind !== 'video' && (
            <>
              <button
                className={styles.iconBtn}
                data-testid="media-viewer-actual-size"
                aria-label={isActualSize ? t('mediaViewer.fit') : t('mediaViewer.actualSize')}
                title={isActualSize ? t('mediaViewer.fit') : t('mediaViewer.actualSize')}
                onClick={(e) => { e.stopPropagation(); imageStageRef.current?.toggleActualSize(); }}
              >
                {isActualSize ? <FitToScreenIcon /> : <ActualSizeIcon />}
              </button>
              <button
                className={styles.iconBtn}
                data-testid="media-viewer-rotate"
                aria-label={t('mediaViewer.rotateCw')}
                title={t('mediaViewer.rotateCw')}
                onClick={(e) => { e.stopPropagation(); imageStageRef.current?.rotateCw(); }}
              >
                <RotateCwIcon />
              </button>
            </>
          )}
          <button
            className={styles.closeBtn}
            data-testid="media-viewer-close"
            aria-label={t('mediaViewer.close')}
            onClick={(e) => { e.stopPropagation(); closeMediaViewer(); }}
          >×</button>
        </div>
      </div>

      {/* 左右箭头（仅多张时） */}
      {multi && (
        <>
          <button
            className={`${styles.navBtn} ${styles.navPrev}`}
            data-testid="media-viewer-prev"
            aria-label={t('mediaViewer.prev')}
            disabled={!canPrev}
            onClick={(e) => { e.stopPropagation(); goPrev(); }}
          >‹</button>
          <button
            className={`${styles.navBtn} ${styles.navNext}`}
            data-testid="media-viewer-next"
            aria-label={t('mediaViewer.next')}
            disabled={!canNext}
            onClick={(e) => { e.stopPropagation(); goNext(); }}
          >›</button>
        </>
      )}

      {/* Stage */}
      <div
        ref={stageWrapRef}
        className={styles.stageWrap}
        data-testid="media-viewer-stage-wrap"
      >
        {current.kind === 'video' ? (
          <VideoStage file={current} viewport={viewport} />
        ) : (
          <ImageStage
            ref={imageStageRef}
            file={current}
            viewport={viewport}
            neighbors={{ prev, next }}
            zoomCmd={zoomCmd}
            onTransformChange={setImageScale}
            key={`${current.id}:${fileRefVersionToken(current) || ''}`}
          />
        )}
      </div>
    </motion.div>
  );
}

function RotateCwIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function ActualSizeIcon() {
  // 1:1 原始大小：直角矩形 + 数字 1:1
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" />
      <text x="12" y="14.5" textAnchor="middle" fontSize="7.5" fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace" fontWeight="600" stroke="none" fill="currentColor">1:1</text>
    </svg>
  );
}

function FitToScreenIcon() {
  // 适应屏幕：四角括号
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="4 9 4 4 9 4" />
      <polyline points="15 4 20 4 20 9" />
      <polyline points="20 15 20 20 15 20" />
      <polyline points="9 20 4 20 4 15" />
    </svg>
  );
}
