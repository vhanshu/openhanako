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

  // transform-origin: center center = (natural.w/2, natural.h/2)（与 CSS rotate 无关）
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
    offsetX: imageDeltaX * scaleDiff,
    offsetY: imageDeltaY * scaleDiff,
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
    () => opts.range ?? { min: fitScale, max: Math.max(fitScale * 8, 1) },
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
  }, []);

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
   * 旋转被保留：这两个操作不会丢旋转状态。
   */
  const toggleActualSize = useCallback(() => {
    setTransform((t) => {
      const atActual = Math.abs(t.scale - 1) < 0.01;
      if (atActual) {
        return { scale: fitScale, offsetX: 0, offsetY: 0, rotation: t.rotation };
      }
      // fit / 任意放大状态 → 1:1。必须用 natural 算 center，不能用 effective（旋转后宽高对调）。
      const center = computeCenterOffset(opts.natural, opts.viewport, 1);
      return { scale: 1, offsetX: 0, offsetY: 0, rotation: t.rotation };
    });
  }, [fitScale, opts.natural, opts.viewport]);

  /**
 * 向右旋转 90°。
 * - scale 保持不变（“不改变大小”），
 * - offsetX/Y 清零，保证旋转后图片视觉中心仍位于 viewport 中心。
 *   用 effective 尺寸重新算 center.x/y，以适应旋转后宽高对调。
 */
  const rotateCw = useCallback(() => {
    setTransform((t) => {
      const rotation = (((t.rotation + 90) % 360) as 0 | 90 | 180 | 270);
      // 必须用 natural 算 center，不能用 effective（旋转后宽高对调，transform-origin 不变）。
      const center = computeCenterOffset(opts.natural, opts.viewport, t.scale);
      return { scale: t.scale, offsetX: 0, offsetY: 0, rotation };
    });
  }, [opts.natural, opts.viewport]);

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
    dragMoved: () => dragRef.current?.moved ?? false,
  };
}
