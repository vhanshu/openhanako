import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { FileRef } from '../../../types/file-ref';
import { loadMediaSource } from './media-source';
import { fileRefVersionToken } from '../../../services/resource-url';
import { useMediaTransform } from './use-media-transform';
import styles from './MediaViewer.module.css';

// 注意：prop 名 `file` 不可改为 `ref`。React 会把 `ref` 当 forwardRef 的 ref 截获，
// 函数组件 props 里拿不到值，会导致 loadMediaSource(undefined) → 图片渲染不出来。
interface Props {
  file: FileRef;
  /** 仅作为初始 viewport 估计值。ImageStage 内部会用 ResizeObserver 读 stageWrap 真实尺寸。 */
  viewport: { width: number; height: number };
  neighbors?: { prev?: FileRef; next?: FileRef };
  zoomCmd?: { in: number; out: number; reset: number };
  onReady?: () => void;
  onError?: (e: unknown) => void;
  /** transform 状态变化时回调（供顶层按 scale 切换按钮图标等） */
  onTransformChange?: (scale: number) => void;
}

/** 顶层工具栏需要的动作。 */
export interface ImageStageActions {
  reset: () => void;
  rotateCw: () => void;
  toggleActualSize: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  getTransform: () => import('./use-media-transform').Transform;
}

export const ImageStage = forwardRef<ImageStageActions, Props>(function ImageStage(
  { file, viewport, neighbors, zoomCmd, onReady, onError, onTransformChange },
  ref,
) {
  const [src, setSrc] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stageSize, setStageSize] = useState({ width: viewport.width, height: viewport.height });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const fileVersionToken = fileRefVersionToken(file);

  // 监听父元素 stageWrap（不是自身 `.stage`）的真实尺寸变化。
  // `.stage` 是 position:absolute，尺寸等于图片尺寸，不能拿来做 viewport。
  // 监听 stageWrap 才能让初始 mount / 全屏切换 / resize 时拿到实际可视区域。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wrap = stage.parentElement;
    if (!wrap) return;
    const update = () => {
      const rect = wrap.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setStageSize((prev) => {
          if (prev.width === rect.width && prev.height === rect.height) return prev;
          return { width: rect.width, height: rect.height };
        });
      }
    };
    update();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(update);
      ro.observe(wrap);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  // 加载当前图
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setNatural(null);
    loadMediaSource(file)
      .then((s) => { if (!cancelled) setSrc(s.url); })
      .catch((err) => { if (!cancelled) onError?.(err); });
    return () => { cancelled = true; };
    // 依赖稳定 id + version；file 是引用类型每次新建，onError 仅在错误时被调用。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id, fileVersionToken]);

  // 邻近预加载（触发浏览器缓存）
  // 仅对 image/svg 预加载：loadMediaSource 只支持这两类，其他 kind 会抛 "unsupported media kind"。
  useEffect(() => {
    const preload = async (nf?: FileRef) => {
      if (!nf || (nf.kind !== 'image' && nf.kind !== 'svg')) return;
      try {
        const s = await loadMediaSource(nf);
        const img = new Image();
        img.src = s.url;
      } catch { /* ignore */ }
    };
    preload(neighbors?.prev);
    preload(neighbors?.next);
    // 依赖稳定 id + version；邻居切换或覆盖更新时才需要重新预加载。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    neighbors?.prev?.id,
    neighbors?.prev ? fileRefVersionToken(neighbors.prev) : null,
    neighbors?.next?.id,
    neighbors?.next ? fileRefVersionToken(neighbors.next) : null,
  ]);

  const transformApi = useMediaTransform({
    natural,
    viewport: { w: stageSize.width, h: stageSize.height },
  });

  const {
    cssTransform,
    cssTransition,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onDoubleClick,
    fitScale,
    transform,
    isDragging,
  } = transformApi;

  useImperativeHandle(ref, () => ({
    reset: () => transformApi.reset(),
    rotateCw: () => transformApi.rotateCw(),
    toggleActualSize: () => transformApi.toggleActualSize(),
    zoomIn: () => transformApi.zoomIn(),
    zoomOut: () => transformApi.zoomOut(),
    /** 只读快照，供顶层/测试调试。 */
    getTransform: () => transformApi.transform,
  }), [transformApi]);

  // 守门员：natural 或 viewport 变化时首帧就要居中。使用 useLayoutEffect 在浏览器首绘前同步
  // 设置 transform，避免用户看到“在 (0,0) 闪一下再跳到中心”的过程。
  // 包括初始 mount（viewport 从占位 1×1 跳到 stageWrap 真实尺寸）和全屏切换（resize）。
  useLayoutEffect(() => {
    if (!natural) return;
    transformApi.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [natural?.w, natural?.h, viewport.width, viewport.height]);

  // 同步 scale 到顶层（供按 scale 切换按钮图标）
  useEffect(() => {
    onTransformChange?.(transform.scale);
  }, [transform.scale, onTransformChange]);

  // 用 native wheel 事件（passive: false）挂在 stageWrap（= stage 的父元素，即整个预览框），
  // 这样在预览框的任意位置滚动都能缩放，而不是只在图片可视矩形内才响应。
  // useLayoutEffect 保证 listener 在 commit 后同步挂上，避免 useEffect 异步调度窗口期里事件丢失。
  // React 合成 wheel 默认是 passive，会报 'Unable to preventDefault inside passive event listener'。
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const wrap = stage.parentElement;
    if (!wrap) return;
    const handler: EventListener = (e) => {
      const wheel = e as WheelEvent;
      onWheel({
        deltaY: wheel.deltaY,
        ctrlKey: wheel.ctrlKey,
        metaKey: wheel.metaKey,
        clientX: wheel.clientX,
        clientY: wheel.clientY,
        currentTarget: stage,
        preventDefault: () => wheel.preventDefault(),
      } as unknown as React.WheelEvent<HTMLElement>);
    };
    wrap.addEventListener('wheel', handler, { passive: false });
    return () => wrap.removeEventListener('wheel', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onWheel]);

  // 外壳的缩放命令（单调计数器）变化时触发对应动作
  const prevCmdRef = useRef({ in: 0, out: 0, reset: 0 });
  useEffect(() => {
    if (!zoomCmd) return;
    if (zoomCmd.in > prevCmdRef.current.in) transformApi.zoomIn();
    if (zoomCmd.out > prevCmdRef.current.out) transformApi.zoomOut();
    if (zoomCmd.reset > prevCmdRef.current.reset) transformApi.reset();
    prevCmdRef.current = zoomCmd;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomCmd?.in, zoomCmd?.out, zoomCmd?.reset]);

  // drag 总是可用；只有放大时 cursor 才改成 grab。
  const isZoomed = transform.scale > fitScale + 0.01;
  const cursorStyle = isDragging ? 'grabbing' : 'grab';

  return (
    <div
      ref={stageRef}
      className={styles.stage}
      data-testid="image-stage"
      data-zoom-in-seq={zoomCmd?.in ?? 0}
      data-zoom-out-seq={zoomCmd?.out ?? 0}
      data-reset-seq={zoomCmd?.reset ?? 0}
      data-rotation={transform.rotation}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      style={{
        transform: cssTransform,
        // 仅在拖动结束的回弹动作上启用 transition；拖动期间 / 缩放 / 旋转始终保持瞬时响应，
        // 否则拖动第一帧会感觉被 transition 拖慢。
        transition: cssTransition,
        cursor: cursorStyle,
        // 旋转绕图片中心而非 transform-origin 默认的左上角，否则放大后旋转会跳位。
        transformOrigin: 'center center',
      }}
    >
      {!natural && (
        // 在 natural 还没拿到之前显示 spinner（不论 src 是否设上）。
        // 原因：natural=null 时 cssTransform 给的是 `translate(viewport.w/2, viewport.h/2)` 占位，
        // 但 src 设上后 img 已被浏览器按真实自然尺寸排版，transform-origin = center center = (nw/2, nh/2)，
        // 导致元素中心被推到“viewport 中心 + 图片自然尺寸的一半”——右下角偏移出去。
        // 一旦 onLoad 拿到 natural 赋了 cssTransform 正确公式，元素中心再跳回 viewport 中心。
        // 这中间 layout 突变会被肉眼识别为“图片从右下角快速移动到中心”。
        // 修复：img 加 visibility 切换，natural 未就位时 hidden；spinner 占位到 natural 就位。
        <div className={styles.spinner} data-testid="image-stage-spinner" />
      )}
      {src && (
        <img
          ref={imgElRef}
          src={src}
          alt={file.name}
          style={{ visibility: natural ? 'visible' : 'hidden' }}
          onLoad={(e) => {
            const el = e.currentTarget;
            setNatural({ w: el.naturalWidth, h: el.naturalHeight });
            onReady?.();
          }}
          onError={() => onError?.(new Error(`image decode failed: ${file.name}`))}
          draggable={false}
          className={styles.stageImg}
        />
      )}
    </div>
  );
});
