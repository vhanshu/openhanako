import { describe, expect, it } from 'vitest';
import {
  zoomAtPoint,
  computeFitScale,
  clamp,
  computeCenteredTransform,
  computeImageCenterPoint,
  effectiveNaturalSize,
  computeRangeForFit,
  clampImageCenterToViewport,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  MIN_HARD_FLOOR,
} from '../../../../components/shared/MediaViewer/use-media-transform';

describe('clamp', () => {
  it('在范围内不变', () => expect(clamp(5, 1, 10)).toBe(5));
  it('低于 min 取 min', () => expect(clamp(-1, 1, 10)).toBe(1));
  it('高于 max 取 max', () => expect(clamp(99, 1, 10)).toBe(10));
});

describe('effectiveNaturalSize', () => {
  it('旋转 0/180 返回原尺寸', () => {
    expect(effectiveNaturalSize({ w: 800, h: 600 }, 0)).toEqual({ w: 800, h: 600 });
    expect(effectiveNaturalSize({ w: 800, h: 600 }, 180)).toEqual({ w: 800, h: 600 });
  });
  it('旋转 90/270 宽高对调', () => {
    expect(effectiveNaturalSize({ w: 800, h: 600 }, 90)).toEqual({ w: 600, h: 800 });
    expect(effectiveNaturalSize({ w: 800, h: 600 }, 270)).toEqual({ w: 600, h: 800 });
  });
  it('natural 为 null 返回 null', () => {
    expect(effectiveNaturalSize(null, 90)).toBeNull();
  });
});

describe('computeRangeForFit', () => {
  it('大图（fitScale < 1）：min = fitScale / ZOOM_OUT_FACTOR 且不低于 MIN_HARD_FLOOR', () => {
    // fitScale = 0.5（典型大图），min = max(0.1, 0.5 / 4) = 0.125
    const r = computeRangeForFit(0.5);
    expect(r.min).toBeCloseTo(0.5 / ZOOM_OUT_FACTOR);
    expect(r.min).toBeGreaterThanOrEqual(MIN_HARD_FLOOR);
    expect(r.max).toBeCloseTo(0.5 * ZOOM_IN_FACTOR);
  });

  it('极大图（fitScale 极小）：min 被 MIN_HARD_FLOOR 托住，不再往下', () => {
    // fitScale = 0.02（比 MIN_HARD_FLOOR 还小得多）
    // 理论上 fitScale / ZOOM_OUT_FACTOR = 0.005，但硬下限是 0.1
    const r = computeRangeForFit(0.02);
    expect(r.min).toBe(MIN_HARD_FLOOR);
    expect(r.min).toBeGreaterThan(0.02 / ZOOM_OUT_FACTOR);
  });

  it('小图（fitScale >= 1）：min 被锁定为 1（自然像素），不再往下走', () => {
    // fitScale = 2（图比视口小，fit 是放大版）
    // 原图 1:1 已经比最小尺寸还小，不再往下
    const r = computeRangeForFit(2);
    expect(r.min).toBe(1);
    expect(r.max).toBeCloseTo(2 * ZOOM_IN_FACTOR);
  });

  it('边界 fitScale = 1：min 取 1（与上面分支一致）', () => {
    const r = computeRangeForFit(1);
    expect(r.min).toBe(1);
  });

  it('max 不低于 1.0：保证原图自然像素大小始终可达', () => {
    // 即便 fitScale 极小（fitScale * ZOOM_IN_FACTOR < 1），max 也至少为 1
    const r = computeRangeForFit(0.05);
    expect(r.max).toBeGreaterThanOrEqual(1);
  });

  it('返回值始终满足 min <= max（区间合法）', () => {
    for (const fit of [0.02, 0.1, 0.5, 0.9, 1, 1.5, 3]) {
      const r = computeRangeForFit(fit);
      expect(r.min).toBeLessThanOrEqual(r.max);
    }
  });
});

describe('clampImageCenterToViewport', () => {
  const vp = { w: 1000, h: 800 };

  it('中心点在 viewport 内：原样返回，dx/dy=0，未溢出', () => {
    const r = clampImageCenterToViewport({ x: 500, y: 400 }, vp);
    expect(r.clamped).toEqual({ x: 500, y: 400 });
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.overflowX).toBe(false);
    expect(r.overflowY).toBe(false);
  });

  it('中心点恰好在 viewport 边界上：原样返回，未溢出', () => {
    // 边界 case：中心点 == 边界是允许的状态
    const r1 = clampImageCenterToViewport({ x: 0, y: 0 }, vp);
    expect(r1.clamped).toEqual({ x: 0, y: 0 });
    expect(r1.overflowX).toBe(false);
    expect(r1.overflowY).toBe(false);

    const r2 = clampImageCenterToViewport({ x: 1000, y: 800 }, vp);
    expect(r2.clamped).toEqual({ x: 1000, y: 800 });
    expect(r2.overflowX).toBe(false);
    expect(r2.overflowY).toBe(false);
  });

  it('中心点超出右边界：clamp 到 x = viewport.w，dx 为负', () => {
    const r = clampImageCenterToViewport({ x: 1500, y: 400 }, vp);
    expect(r.clamped.x).toBe(1000);
    expect(r.dx).toBe(-500);
    expect(r.overflowX).toBe(true);
    expect(r.overflowY).toBe(false);
  });

  it('中心点超出左边界（x < 0）：clamp 到 x = 0，dx 为正', () => {
    const r = clampImageCenterToViewport({ x: -200, y: 400 }, vp);
    expect(r.clamped.x).toBe(0);
    expect(r.dx).toBe(200);
    expect(r.overflowX).toBe(true);
  });

  it('x/y 同时溢出：分别 clamp，overflowX/overflowY 都标记', () => {
    const r = clampImageCenterToViewport({ x: -100, y: 1000 }, vp);
    expect(r.clamped).toEqual({ x: 0, y: 800 });
    expect(r.overflowX).toBe(true);
    expect(r.overflowY).toBe(true);
  });
});

describe('computeFitScale', () => {
  it('图片小于视口 → fit 填满但不超过 0.9', () => {
    // viewport 1000x800, natural 500x400, 基础比 0.9 * min(1000/500, 800/400) = 0.9 * 2 = 1.8
    expect(computeFitScale({ w: 500, h: 400 }, { w: 1000, h: 800 })).toBeCloseTo(1.8);
  });
  it('图片大于视口 → fit 缩小', () => {
    // viewport 800x600, natural 2000x1500, 0.9 * min(800/2000, 600/1500) = 0.9 * 0.4 = 0.36
    expect(computeFitScale({ w: 2000, h: 1500 }, { w: 800, h: 600 })).toBeCloseTo(0.36);
  });
  it('natural 为 null 返回 1', () => {
    expect(computeFitScale(null, { w: 800, h: 600 })).toBe(1);
  });
  it('旋转 90° 后按交换后尺寸计算 fitScale', () => {
    // natural 200x100 在 800x600 中原始 fit = 0.9 * min(4, 6) = 3.6
    // 旋转 90° 后 effective = 100x200，fit = 0.9 * min(8, 3) = 2.7
    const a = computeFitScale({ w: 200, h: 100 }, { w: 800, h: 600 }, 0);
    const b = computeFitScale({ w: 200, h: 100 }, { w: 800, h: 600 }, 90);
    expect(a).toBeCloseTo(3.6);
    expect(b).toBeCloseTo(2.7);
  });
});

describe('zoomAtPoint', () => {
  it('缩放前后鼠标锚点对应的图片坐标不变', () => {
    // 起始：scale=1, offset=(100,100)，鼠标点在 viewport (200, 200)
    // 该点对应图片坐标 = (200-100)/1 = (100, 100)
    const next = zoomAtPoint(
      { scale: 1, offsetX: 100, offsetY: 100, rotation: 0 },
      { x: 200, y: 200 },
      2, // 放大到 2x
      { min: 0.1, max: 8 },
    );
    expect(next.scale).toBe(2);
    // 新 offset 应让鼠标点 (200,200) 仍对应图片 (100,100)
    // viewport(200,200) = offsetX + imageCoord * newScale → 200 = offsetX + 100*2 → offsetX = 0
    expect(next.offsetX).toBeCloseTo(0);
    expect(next.offsetY).toBeCloseTo(0);
    expect(next.rotation).toBe(0);
  });

  it('超过 max 被 clamp，offset 同步按实际 newScale 修正', () => {
    const next = zoomAtPoint(
      { scale: 4, offsetX: 0, offsetY: 0, rotation: 0 },
      { x: 100, y: 100 },
      4, // 想放 4x 到 16，但 max=8
      { min: 0.5, max: 8 },
    );
    expect(next.scale).toBe(8);
  });

  it('低于 min 被 clamp', () => {
    const next = zoomAtPoint(
      { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      { x: 0, y: 0 },
      0.01,
      { min: 0.5, max: 8 },
    );
    expect(next.scale).toBe(0.5);
  });
});

describe('computeCenteredTransform', () => {
  it('把 fit 后的图片居中，再叠加用户拖动偏移', () => {
    // viewport=1000×800, natural=500×400 → center.x=(1000-500)/2=250, center.y=(800-400)/2=200
    // offsetX=10, offsetY=-5 → translate=(260, 195)
    const css = computeCenteredTransform(
      { scale: 1.8, offsetX: 10, offsetY: -5, rotation: 0 },
      { w: 500, h: 400 },
      { w: 1000, h: 800 },
    );
    expect(css).toBe('translate(260px, 195px) scale(1.8) rotate(0deg)');
  });

  it('natural 缺失时元素中心占位到 viewport 中心（避免闪到 0,0）', () => {
    const css = computeCenteredTransform(
      { scale: 1, offsetX: 12, offsetY: 24, rotation: 0 },
      null,
      { w: 1000, h: 800 },
    );
    // natural 缺失时中心点放在 viewport 中心，offsetX/Y 叠加上去（图片加载后才可见）。
    expect(css).toBe('translate(512px, 424px) scale(1) rotate(0deg)');
  });

  it('rotation 90 时 center offset 仍按 natural 尺寸（不变）', () => {
    // natural 200x100，旋转 90° 后 effective 100x200
    // viewport 1000x800
    // center 用 natural (200, 100) 算：center.x = (1000 - 200)/2 = 400
    // center.y = (800 - 100)/2 = 350
    // 不能用 effective，否则旋转后视觉中心偏 (eff.w - natural.w)/2
    const css = computeCenteredTransform(
      { scale: 1.8, offsetX: 0, offsetY: 0, rotation: 90 },
      { w: 200, h: 100 },
      { w: 1000, h: 800 },
    );
    expect(css).toBe('translate(400px, 350px) scale(1.8) rotate(90deg)');
  });
});

describe('computeImageCenterPoint', () => {
  it('offset 为 0 时，返回 viewport 中心加上“图片自身中心偏移”', () => {
    // natural 200x100，viewport 1000x800，scale 1
    // center.x = (1000 - 200) / 2 = 400
    // center.y = (800 - 100) / 2 = 350
    // image center viewport x = 400 + 0 + 200/2 = 500
    // image center viewport y = 350 + 0 + 100/2 = 400
    const pt = computeImageCenterPoint(
      { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      { w: 200, h: 100 },
      { w: 1000, h: 800 },
    );
    expect(pt).toEqual({ x: 500, y: 400 });
  });

  it('拖动后返回“图片视觉中心”而非 viewport 中心', () => {
    // 用户拖动图片向右 50，offsetX=50
    // image center viewport x = 400 + 50 + 200/2 = 550
    const pt = computeImageCenterPoint(
      { scale: 1, offsetX: 50, offsetY: 0, rotation: 0 },
      { w: 200, h: 100 },
      { w: 1000, h: 800 },
    );
    expect(pt).toEqual({ x: 550, y: 400 });
  });

  it('旋转 90° 时按交换后尺寸计算', () => {
    // natural 200x100，旋转 90° 后 effective 100x200
    // scale 1
    // center.x = (1000 - 100) / 2 = 450
    // center.y = (800 - 200) / 2 = 300
    // image center viewport x = 450 + 0 + 100/2 = 500
    // image center viewport y = 300 + 0 + 200/2 = 400
    const pt = computeImageCenterPoint(
      { scale: 1, offsetX: 0, offsetY: 0, rotation: 90 },
      { w: 200, h: 100 },
      { w: 1000, h: 800 },
    );
    expect(pt).toEqual({ x: 500, y: 400 });
  });

  it('natural 缺失时返回 viewport 中心', () => {
    const pt = computeImageCenterPoint(
      { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
      null,
      { w: 1000, h: 800 },
    );
    expect(pt).toEqual({ x: 500, y: 400 });
  });

it('computeCenterOffset：natural 缺失时返回 viewport 中心占位（不是 0,0）', () => {
  // 避免元素在图片加载前被贴到 viewport 左上角
  const css = computeCenteredTransform(
    { scale: 1, offsetX: 0, offsetY: 0, rotation: 0 },
    null,
    { w: 1000, h: 800 },
  );
  expect(css).toBe('translate(500px, 400px) scale(1) rotate(0deg)');
});
});

describe('rotation: 旋转后元素视觉中心保持在 viewport 中心', () => {
  // 旋转后 offsetX/Y 清零，cssTransform 中 translate = 新 effective center.x/y。
  // 元素视觉中心 viewport x = translate.x + eff.w * scale / 2 = viewport.w / 2 + offsetX = viewport.w / 2
  // （offsetX = 0 时）。不论旋转角度、natural 尺寸如何，这一点都成立。
  const cases = [
    { label: '瘦高图 200x100', natural: { w: 200, h: 100 }, viewport: { w: 1000, h: 800 }, scale: 2 },
    { label: '正方形 500x500', natural: { w: 500, h: 500 }, viewport: { w: 1200, h: 900 }, scale: 1.5 },
    { label: '胖图 800x400', natural: { w: 800, h: 400 }, viewport: { w: 1000, h: 1000 }, scale: 1.2 },
  ];

  for (const { label, natural, viewport, scale } of cases) {
    for (const rotation of [0, 90, 180, 270] as const) {
      it(`${label} rotation=${rotation} offset=0 下元素中心仍位于 viewport 中心`, () => {
        const css = computeCenteredTransform(
          { scale, offsetX: 0, offsetY: 0, rotation },
          natural,
          viewport,
        );
        const m = css.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s+scale\(([\d.]+)\)/);
        expect(m).not.toBeNull();
        const tx = parseFloat(m![1]);
        const ty = parseFloat(m![2]);
        const s = parseFloat(m![3]);
        const eff = rotation === 90 || rotation === 270
          ? { w: natural.h, h: natural.w }
          : natural;
        // CSS transform-origin: center center 是元素未旋转 local 中心 (natural.w/2, natural.h/2)，
        // 不随 CSS rotate 变。元素 visual center viewport = tx + natural.w/2。
        const centerX = tx + natural.w / 2;
        const centerY = ty + natural.h / 2;
        expect(Math.abs(centerX - viewport.w / 2)).toBeLessThan(0.01);
        expect(Math.abs(centerY - viewport.h / 2)).toBeLessThan(0.01);
      });
    }
  }
});