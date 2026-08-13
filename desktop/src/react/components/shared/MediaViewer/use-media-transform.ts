import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type React from 'react';

export interface Transform {
  scale: number;
  offsetX: number;
  offsetY: number;
  /** 0 / 90 / 180 / 270，单位度。 */
  rotation: 0 | 90 | 180 | 270;
}

export interface Size {
  w: number;
  h: number;
}

export interface ScaleRange {
  min: number;
  max: number;
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * 旋转后图片的“呈现尺寸”。旋转 90/270° 后宽高对调，否则保持原样。
 * fitScale / 中心偏移计算都走这个尺寸，避免旋转后图片“看起来跑偏”。
 */
export function effectiveNaturalSize(natural: Size | null, rotation: number): Size | null {
  if (!natural) return null;
  if (rotation === 90 || rotation === 270) {
    return { w: natural.h, h: natural.w };
  }
  return { w: natural.w, h: natural.h };
}

/**
 * 以 viewport 为基准，计算让 natural 大小“适配并留 10% 边距”的 scale。
 * 旋转后传 effective 尺寸，以保证旋转后的图始终能完整出现在 viewport 里。
 */
export function computeFitScale(natural: Size | null, viewport: Size, rotation: number = 0): number {
  const eff = effectiveNaturalSize(natural, rotation);
  if (!eff || eff.w === 0 || eff.h === 0) return 1;
  const ratio = Math.min(viewport.w / eff.w, viewport.h / eff.h);
  return ratio * 0.9;
}

/**
 * fit 状态下能放大的最大倍数。1.0 原图大小同样可达（与 max 取大）。
 */
export const ZOOM_IN_FACTOR = 8;
/**
 * fit 状态下能缩小的最大倍数（即允许 min = fitScale / ZOOM_OUT_FACTOR）。
 */
export const ZOOM_OUT_FACTOR = 4;
/**
 * 缩放的硬下限。不论 fit 多大，scale 都不允许低于这个值，
 * 否则图片会缩到几乎看不见，交互体验变差。
 */
export const MIN_HARD_FLOOR = 0.1;

/**
 * 拖动结束 → 边界回弹动画的过渡时长。拖动期间始终保持“跟随手指”的瞬时响应，
 * 只在 pointer up 触发的“回弹到 viewport 内”这一动作上启用 transition。
 */
export const REBOUND_TRANSITION_MS = 280;

/**
 * 根据 fitScale 计算默认的 [min, max] 缩放范围。
 *
 * 双向区间：
 * - max: 在 fit 之上能放大 ZOOM_IN_FACTOR 倍，且不低过 1.0（确保“原图 1:1”可达）
 * - min:
 *   - 图 fit 后仍比 viewport 大（fitScale < 1）：允许缩到 fitScale / ZOOM_OUT_FACTOR，
 *     但不能低于 MIN_HARD_FLOOR。
 *   - 图 fit 后比 viewport 小（fitScale >= 1）：fit 本身已是放大版，
 *     最小只能回到原图 1:1（自然像素），不再往下。
 */
export function computeRangeForFit(fitScale: number): ScaleRange {
  const max = Math.max(fitScale * ZOOM_IN_FACTOR, 1);
  const min = fitScale >= 1
    ? 1
    : Math.max(MIN_HARD_FLOOR, fitScale / ZOOM_OUT_FACTOR);
  return { min, max };
}

/**
 * 拖动边界约束：把图片视觉中心点钳制在 viewport 范围内。
 * 允许中心点位于边界上（cx = 0 或 cx = viewport.w），不允许超出。
 * 返回校正后的中心点 + 需要的 offset 调整量（dx = cxv - cx）。
 */
export function clampImageCenterToViewport(
  center: { x: number; y: number },
  viewport: Size,
): { clamped: { x: number; y: number }; dx: number; dy: number; overflowX: boolean; overflowY: boolean } {
  const cxv = clamp(center.x, 0, viewport.w);
  const cyv = clamp(center.y, 0, viewport.h);
  return {
    clamped: { x: cxv, y: cyv },
    dx: cxv - center.x,
    dy: cyv - center.y,
    overflowX: Math.abs(cxv - center.x) > 0.5,
    overflowY: Math.abs(cyv - center.y) > 0.5,
  };
}

function computeCenterOffset(natural: Size | null, viewport: Size, _scale: number): { x: number; y: number } {
  if (!natural || natural.w === 0 || natural.h === 0) {
    // natural 还没加载到位（图片 onLoad 还没跑）。返回 viewport 中心作为占位，
    // 避免元素被贴到视口左上角；元素本身此时不可见，但布局点位置在中心。
    return { x: viewport.w / 2, y: viewport.h / 2 };
  }
  // CSS transform-origin: center center 是相对元素**未旋转**的 local 边界框中心，
  // 即 (natural.w/2, natural.h/2)，不会随 CSS rotate 而变。
  // 元素 visual center viewport 位置 = translate.x + natural.w/2（与 scale/rotation 都无关）。
  // 期望 = viewport.w/2 → translate.x = (viewport.w - natural.w)/2
  // 必须用 natural 尺寸，不能用 effective（旋转后宽高对调）。
  return {
    x: (viewport.w - natural.w) / 2,
    y: (viewport.h - natural.h) / 2,
  };
}

/**
 * 缩放并锚定鼠标位置：缩放前后鼠标点对应的图片坐标保持不变。
 * @param point viewport 相对坐标
 * @param factor 乘性因子，例如 1.1 / (1/1.1)
 */
export function zoomAtPoint(
  current: Transform,
  point: { x: number; y: number },
  factor: number,
  range: ScaleRange,
): Transform {
  const desired = current.scale * factor;
  const newScale = clamp(desired, range.min, range.max);
  if (newScale === current.scale) return current;
  const k = newScale / current.scale - 1;
  return {
    scale: newScale,
    offsetX: current.offsetX - (point.x - current.offsetX) * k,
    offsetY: current.offsetY - (point.y - current.offsetY) * k,
    rotation: current.rotation,
  };
}

function zoomAtPointCentered(
  current: Transform,
  point: { x: number; y: number },
  factor: number,
  range: ScaleRange,
  natural: Size | null,
  viewport: Size,
): Transform {
  if (!natural || natural.w === 0 || natural.h === 0) {
    return zoomAtPoint(current, point, factor, range);
  }
  const desired = current.scale * factor;
  const newScale = clamp(desired, range.min, range.max);
  if (newScale === current.scale) return current;

  // 几何：CSS canvas 上元素未旋转 local 中心 = translate + (natural.w/2, natural.h/2)。
  // 设 point 是缩放锚点，其在图片局部坐标系中相对 local 中心的偏移为 imageDelta。
  // imageDelta = (point - translate - origin) / scale
  // 缩放前后保持 point viewport 坐标不变：
  //   new_translate + origin + imageDelta * new_scale = translate + origin + imageDelta * scale
  //   new_translate = translate + imageDelta * (scale - new_scale)
  // 而 translate = center + offset，其中 center = (viewport - natural) / 2 与 scale 无关。
  // 所以 new_offset = current.offset + imageDelta * (scale - new_scale)。
  // 注意：上面 current.offset 是必加项——之前被丢掉、造成“缩放后被拉回 viewport 中心”的 bug。
  const ox = natural.w / 2;
  const oy = natural.h / 2;
  const centerX = (viewport.w - natural.w) / 2;
  const centerY = (viewport.h - natural.h) / 2;
  const tx = centerX + current.offsetX;
  const ty = centerY + current.offsetY;
  const imageDeltaX = (point.x - tx - ox) / current.scale;
  const imageDeltaY = (point.y - ty - oy) / current.scale;
  const scaleDiff = current.scale - newScale;
  return {
    scale: newScale,
    offsetX: current.offsetX + imageDeltaX * scaleDiff,
    offsetY: current.offsetY + imageDeltaY * scaleDiff,
    rotation: current.rotation,
  };
}

/**
 * “图片视觉中心”的 viewport 坐标。
 * 按钮缩放应以此为锚点，旋转/拖动后都能保证“图片中心位置不动”。
 */
export function computeImageCenterPoint(
  transform: Transform,
  natural: Size | null,
  viewport: Size,
): { x: number; y: number } {
  if (!natural || natural.w === 0 || natural.h === 0) {
    return { x: viewport.w / 2, y: viewport.h / 2 };
  }
  const center = computeCenterOffset(natural, viewport, transform.scale);
  // 元素视觉中心 = translate.x + natural.w/2（与 rotation 无关，origin 用 natural 尺寸）
  return {
    x: center.x + transform.offsetX + natural.w / 2,
    y: center.y + transform.offsetY + natural.h / 2,
  };
}

export function computeCenteredTransform(
  transform: Transform,
  natural: Size | null,
  viewport: Size,
): string {
  // 必须传 natural（不是 eff）。transform-origin 是元素未旋转 local 中心 (natural.w/2, natural.h/2)，
  // 不随 CSS rotate 变。rotate 后元素 visual center viewport 仍 = translate.x + natural.w/2。
  const center = computeCenterOffset(natural, viewport, transform.scale);
  return `translate(${center.x + transform.offsetX}px, ${center.y + transform.offsetY}px) scale(${transform.scale}) rotate(${transform.rotation}deg)`;
}

/**
 * MediaViewer 图像交互 hook。
 * 负责：transform 状态管理、滚轮/拖动/双击事件包装、reset / rotate 工具。
 */
export function useMediaTransform(opts: {
  natural: Size | null;
  viewport: Size;
  range?: ScaleRange;
}) {
  const [transform, setTransform] = useState<Transform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    rotation: 0,
  });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);

  // fitScale 依赖 natural + viewport + rotation，一起放在 useMemo 里。
  const fitScale = useMemo(
    () => computeFitScale(opts.natural, opts.viewport, transform.rotation),
    [opts.natural, opts.viewport, transform.rotation],
  );
  const range = useMemo<ScaleRange>(
    () => opts.range ?? computeRangeForFit(fitScale),
    [opts.range, fitScale],
  );

  // natural / viewport 变化时重置 transform：scale 跟新的 fitScale，offset 清零，rotation 保留。
  // 这个 effect 只看 natural/viewport，不看 rotation：旋转后 fitScale 会变但不应重置 scale。
  const resetKey = useMemo(() => `${opts.natural?.w ?? 0}x${opts.natural?.h ?? 0}@${opts.viewport.w}x${opts.viewport.h}`, [opts.natural, opts.viewport]);
  useEffect(() => {
    dragRef.current = null;
    setIsDragging(false);
    setTransform((t) => ({ scale: fitScale, offsetX: 0, offsetY: 0, rotation: t.rotation }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const onWheel = useCallback((e: React.WheelEvent<HTMLElement>) => {
    if (e.deltaY === 0) return;
    // e.preventDefault();
    // 滚轮缩放始终以“图片视觉中心”为锚点，避免偏移
    const clampedDelta = clamp(e.deltaY, -120, 120);
    const sensitivity = e.ctrlKey || e.metaKey ? 0.005 : 0.002;
    const factor = Math.exp(-clampedDelta * sensitivity);
    setTransform((t) => {
      const point = computeImageCenterPoint(t, opts.natural, opts.viewport);
      return zoomAtPointCentered(t, point, factor, range, opts.natural, opts.viewport);
    });
  }, [opts.natural, opts.viewport, range]);

  // 拖动不限制：图片任何位置、任何缩放比例下都可以拖。
  const [isRebounding, setIsRebounding] = useState(false);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: transform.offsetX,
      baseY: transform.offsetY,
      moved: false,
    };
    setIsDragging(true);
    // 拖动开始：立刻清掉“回弹”过渡标记，避免拖动手感被 transition 拖慢
    setIsRebounding(false);
  }, [transform.offsetX, transform.offsetY]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) d.moved = true;
    setTransform((t) => ({ ...t, offsetX: d.baseX + dx, offsetY: d.baseY + dy }));
  }, []);

  const finishDrag = useCallback((e: React.PointerEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (el.hasPointerCapture?.(e.pointerId)) el.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    setIsDragging(false);

    // 拖动结束 → 边界回弹。计算图片当前视觉中心，若超出 viewport 则校正 offset。
    // 回弹动作启动 CSS transition（isRebounding），拖动期间始终保持瞬时响应。
    let reboundDx = 0;
    let reboundDy = 0;
    let needRebound = false;
    setTransform((cur) => {
      const center = computeImageCenterPoint(cur, opts.natural, opts.viewport);
      const r = clampImageCenterToViewport(center, opts.viewport);
      reboundDx = r.dx;
      reboundDy = r.dy;
      if (!r.overflowX && !r.overflowY) return cur;
      needRebound = true;
      return { ...cur, offsetX: cur.offsetX + r.dx, offsetY: cur.offsetY + r.dy };
    });

    if (needRebound) {
      setIsRebounding(true);
      // transition 时长 + 一小段缓冲，再清掉标记，否则下次拖动第一帧会带上 transition
      window.setTimeout(() => setIsRebounding(false), REBOUND_TRANSITION_MS + 40);
    }
  }, [opts.natural, opts.viewport]);

  const onDoubleClick = useCallback(() => {
    setTransform((t) => {
      const target = Math.abs(t.scale - fitScale) < 0.01 ? 1 : fitScale;
      return { scale: target, offsetX: 0, offsetY: 0, rotation: t.rotation };
    });
  }, [fitScale]);

  const reset = useCallback(
    () => setTransform({ scale: fitScale, offsetX: 0, offsetY: 0, rotation: transform.rotation }),
    [fitScale, transform.rotation],
  );

  /**
   * 切换“1:1（原始像素大小）↔ fit viewport（重置）”。
   * - 旋转被保留。
   * - offsetX/Y 也保持不变：缩放按“当前图片视觉中心”为锚点，
   *   不把图片拉回 viewport 中心。若新 scale 下图片视觉中心超出 viewport，
   *   由 finishDrag 的边界回弹处理（拖动后才生效，按钮点击不会触发回弹）。
   */
  const toggleActualSize = useCallback(() => {
    setTransform((t) => {
      const atActual = Math.abs(t.scale - 1) < 0.01;
      if (atActual) {
        return { scale: fitScale, offsetX: t.offsetX, offsetY: t.offsetY, rotation: t.rotation };
      }
      return { scale: 1, offsetX: t.offsetX, offsetY: t.offsetY, rotation: t.rotation };
    });
  }, [fitScale]);

  /**
 * 向右旋转 90°。
 * - scale / offsetX / offsetY 都保持不变，图片视觉中心点原地不动。
 * - CSS transform-origin 是元素未旋转 local 中心 (natural.w/2, natural.h/2)，
 *   rotate 后元素 visual center viewport 仍 = translate.x + natural.w/2，
 *   所以不需修正任何值——只要 rotation 翻 90° 即可。
 */
  const rotateCw = useCallback(() => {
    setTransform((t) => {
      const rotation = (((t.rotation + 90) % 360) as 0 | 90 | 180 | 270);
      return { scale: t.scale, offsetX: t.offsetX, offsetY: t.offsetY, rotation };
    });
  }, []);

  /**
   * 按钮缩放：以“图片视觉中心”为锚点。
   * 拖动或旋转后图片偏离 viewport 中心时，缩放也不会让图片“跳”到别处。
   */
  const zoomIn = useCallback(
    () => setTransform((t) => {
      const point = computeImageCenterPoint(t, opts.natural, opts.viewport);
      return zoomAtPointCentered(t, point, 1.2, range, opts.natural, opts.viewport);
    }),
    [opts.natural, opts.viewport, range],
  );
  const zoomOut = useCallback(
    () => setTransform((t) => {
      const point = computeImageCenterPoint(t, opts.natural, opts.viewport);
      return zoomAtPointCentered(t, point, 1 / 1.2, range, opts.natural, opts.viewport);
    }),
    [opts.natural, opts.viewport, range],
  );

  return {
    transform,
    fitScale,
    range,
    cssTransform: computeCenteredTransform(transform, opts.natural, opts.viewport),
    /**
     * 拖动结束回弹动画的过渡样式。仅在回弹动作发生时启用，
     * 拖动期间 / 缩放 / 旋转等都不会带上 transition，保持瞬时响应。
     */
    cssTransition: isRebounding ? `transform ${REBOUND_TRANSITION_MS}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : 'none',
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp: finishDrag,
    onPointerCancel: finishDrag,
    onDoubleClick,
    reset,
    zoomIn,
    zoomOut,
    rotateCw,
    toggleActualSize,
    isDragging,
    isRebounding,
    dragMoved: () => dragRef.current?.moved ?? false,
  };
}
