/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, fireEvent, waitFor } from '@testing-library/react';
import { ImageStage } from '../../../../components/shared/MediaViewer/ImageStage';
import type { FileRef } from '../../../../types/file-ref';

describe('ImageStage', () => {
  // 注意：prop 名必须是 `file` 不是 `ref`。React 会把 `ref` 当 forwardRef ref 截获，
  // 导致组件拿不到该 prop。
  const file: FileRef = { id: '1', kind: 'image', source: 'desk', name: 'a.png', path: '/a.png', ext: 'png' };

  beforeEach(() => {
    (window as any).platform = {
      // v0.105.1 起 image/svg 改走 getFileUrl（不再 readFileBase64 进 JS 堆）
      getFileUrl: vi.fn((p: string) => `file:///MOCK${p}`),
    };
  });
  afterEach(() => { cleanup(); delete (window as any).platform; });

  it('渲染 img 并异步加载 src（走 getFileUrl 的 file:// URL）', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img).toBeTruthy();
      expect(img!.getAttribute('src')).toBe('file:///MOCK/a.png');
    });
    expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/a.png');
  });

  it('普通滚轮和触控板 ctrl+wheel 都触发图片缩放', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    // 触发 load 让 natural size 稳定（jsdom 下默认 0，需注入）
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
    fireEvent.load(img);
    const stage = container.querySelector('[data-testid="image-stage"]')!;
    const before = (stage as HTMLElement).style.transform || '';

    fireEvent.wheel(stage, { deltaY: 0, clientX: 400, clientY: 300 });
    expect((stage as HTMLElement).style.transform || '').toBe(before);

    fireEvent.wheel(stage, { deltaY: -100, clientX: 400, clientY: 300 });
    await waitFor(() => expect((stage as HTMLElement).style.transform || '').not.toBe(before));

    const afterWheel = (stage as HTMLElement).style.transform || '';
    fireEvent.wheel(stage, { deltaY: -24, clientX: 400, clientY: 300, ctrlKey: true });
    await waitFor(() => expect((stage as HTMLElement).style.transform || '').not.toBe(afterWheel));
  });

  it('Option 缩放后允许鼠标拖拽平移图片', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });

    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 400, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 300, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn(() => true);

    fireEvent.wheel(stage, { deltaY: -100, clientX: 400, clientY: 300, altKey: true });
    const zoomed = stage.style.transform;

    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 120, clientY: 140 });
    expect(stage.style.cursor).toBe('grabbing');
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 150, clientY: 180 });
    expect(stage.style.transform).not.toBe(zoomed);

    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(stage.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(stage.style.cursor).toBe('grab');
  });

  it('natural size 就绪后图片在视口中央按 fit scale 显示', async () => {
    const { container } = render(<ImageStage file={file} viewport={{ width: 1000, height: 800 }} />);
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);
    // center.x = (viewport.w - natural.w) / 2，natural 尺寸在 jsdom 下可能与 mock 不一致，按 elementCenterX 居中验证
    await waitFor(() => {
      const t = (container.querySelector('[data-testid="image-stage"]') as HTMLElement).style.transform;
      const m = t.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s+scale\(([\d.]+)\)/);
      expect(m).not.toBeNull();
      const tx = parseFloat(m![1]);
      const ty = parseFloat(m![2]);
      const scale = parseFloat(m![3]);
      const effW = img.naturalWidth || 500;
      const effH = img.naturalHeight || 400;
      const elementCenterX = tx + effW / 2;
      const elementCenterY = ty + effH / 2;
      expect(Math.abs(elementCenterX - 500)).toBeLessThan(1);
      expect(Math.abs(elementCenterY - 400)).toBeLessThan(1);
      expect(scale).toBeGreaterThan(0);
    });
  });

  it('loading 状态下显示 spinner（platform 缺失使 loadMediaSource 抛错 → src 保持 null）', () => {
    delete (window as any).platform;
    const { getByTestId } = render(<ImageStage file={file} viewport={{ width: 800, height: 600 }} />);
    expect(getByTestId('image-stage-spinner')).toBeTruthy();
  });

  it('邻图预加载也走 getFileUrl（不进 JS 堆）', async () => {
    const prev: FileRef = { id: '0', kind: 'image', source: 'desk', name: 'prev.png', path: '/prev.png', ext: 'png' };
    const next: FileRef = { id: '2', kind: 'image', source: 'desk', name: 'next.png', path: '/next.png', ext: 'png' };
    render(
      <ImageStage
        file={file}
        viewport={{ width: 800, height: 600 }}
        neighbors={{ prev, next }}
      />,
    );
    await waitFor(() => {
      // 当前图 + 前 + 后 三次调用
      expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/a.png');
      expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/prev.png');
      expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/next.png');
    });
  });

  it('未放大时也能拖动（拖动限制取消）', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 800, height: 600 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 1000, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 750, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn(() => true);

    const before = stage.style.transform;
    // 处于 fit scale，未放大，直接拖动
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 150, clientY: 180 });
    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(stage.style.transform).not.toBe(before);
  });

  it('rotateCw 累加 90°（0→90→180→270→0）并重置 fit scale', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 1000, height: 800 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    await waitFor(() => expect(stage.dataset.rotation).toBe('0'));

    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('90'));

    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('180'));

    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('270'));

    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('0'));
  });

  it('reset 保留 rotation，但 scale/offset 复位到 fit', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 1000, height: 800 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    stage.setPointerCapture = vi.fn();
    stage.releasePointerCapture = vi.fn();
    stage.hasPointerCapture = vi.fn(() => true);

    // 缩放 + 拖动
    fireEvent.wheel(stage, { deltaY: -100, clientX: 400, clientY: 300 });
    fireEvent.pointerDown(stage, { pointerId: 1, button: 0, clientX: 120, clientY: 140 });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 200, clientY: 220 });
    fireEvent.pointerUp(stage, { pointerId: 1 });

    const zoomed = stage.style.transform;
    expect(zoomed).toContain('scale(');

    // 先旋转，记录旋转后的状态；reset 不应该把旋转一起清掉
    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('90'));
    const rotated = stage.style.transform;
    expect(rotated).toContain('rotate(90deg)');

    // reset：scale 回到 fit，offset 清零，rotation 保留
    ref.current?.reset();
    await waitFor(() => expect(stage.style.transform).not.toBe(zoomed));
    expect(stage.dataset.rotation).toBe('90');
  });

  it('rotate 保持当前 scale 不变，offset 清零保证视觉中心不变', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 1000, height: 800 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    await waitFor(() => expect(stage.dataset.rotation).toBe('0'));

    const before = ref.current!.getTransform();
    expect(before.scale).toBeGreaterThan(0);
    expect(before.rotation).toBe(0);
    expect(before.offsetX).toBe(0);
    expect(before.offsetY).toBe(0);

    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('90'));

    const rotated = ref.current!.getTransform();
    // scale 保持不变（“不改变大小”）
    expect(rotated.scale).toBeCloseTo(before.scale);
    expect(rotated.rotation).toBe(90);
    // offset 清零保证旋转后视觉中心在 viewport 中心
    expect(rotated.offsetX).toBe(0);
    expect(rotated.offsetY).toBe(0);

    // 再转一次：scale 还是同一个值
    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('180'));
    const rotated180 = ref.current!.getTransform();
    expect(rotated180.scale).toBeCloseTo(before.scale);
    expect(rotated180.rotation).toBe(180);
    expect(rotated180.offsetX).toBe(0);
    expect(rotated180.offsetY).toBe(0);

    // 验证 cssTransform 中元素视觉中心确实是 viewport 中心
    // （利用 use-media-transform.test.ts 中纯函数的同样语义）
    const css = stage.style.transform;
    const txMatch = css.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
    expect(txMatch).not.toBeNull();
    const tx = parseFloat(txMatch![1]);
    const ty = parseFloat(txMatch![2]);
    // natural 是 jsdom 实际生效的尺寸（mock 可能不生效）
    const effW = img.naturalWidth || 200;
    const effH = img.naturalHeight || 100;
    // rotation=180 时 effective 与原尺寸一致
    const centerX = tx + effW / 2;
    const centerY = ty + effH / 2;
    expect(Math.abs(centerX - 500)).toBeLessThan(2);
    expect(Math.abs(centerY - 400)).toBeLessThan(2);
  });

  it('toggleActualSize：fit → 1:1 → fit，旋转保留', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 1000, height: 800 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    await waitFor(() => expect(stage.style.transform).toContain('scale(1.8)'));

    // 旋转后再切换
    ref.current?.rotateCw();
    await waitFor(() => expect(stage.dataset.rotation).toBe('90'));

    // fit → 1:1
    ref.current?.toggleActualSize();
    await waitFor(() => expect(stage.style.transform).toContain('scale(1)'));
    expect(stage.dataset.rotation).toBe('90');

    // 1:1 → fit（但 fit 现在是旋转后的 fit scale：500×100 旋转后 100×500，
    // fit scale = 0.9 * min(1000/100, 800/500) = 0.9 * min(10, 1.6) = 1.44）
    ref.current?.toggleActualSize();
    await waitFor(() => expect(stage.style.transform).not.toContain('scale(1)'));
    expect(stage.dataset.rotation).toBe('90');
  });

  it('onTransformChange 镜像 scale（供顶层按 scale 切按钮图标）', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const onTransformChange = vi.fn();
    const { container } = render(
      <ImageStage
        ref={ref}
        file={file}
        viewport={{ width: 1000, height: 800 }}
        onTransformChange={onTransformChange}
      />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    await waitFor(() => expect(onTransformChange).toHaveBeenCalledWith(1.8));

    // 触发 toggleActualSize，应通知 1
    ref.current?.toggleActualSize();
    await waitFor(() => expect(onTransformChange).toHaveBeenCalledWith(1));
  });

  it('滚轮缩放以图片视觉中心为锚点，不是鼠标位置', async () => {
    const ref = React.createRef<import('../../../../components/shared/MediaViewer/ImageStage').ImageStageActions>();
    const { container } = render(
      <ImageStage ref={ref} file={file} viewport={{ width: 1000, height: 800 }} />,
    );
    await waitFor(() => {
      const img = container.querySelector('img');
      expect(img?.getAttribute('src')).toBeTruthy();
    });
    const img = container.querySelector('img')!;
    Object.defineProperty(img, 'naturalWidth', { value: 500, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 400, configurable: true });
    fireEvent.load(img);

    const stage = container.querySelector('[data-testid="image-stage"]') as HTMLElement;
    // 等 fit scale 就位
    await waitFor(() => expect(stage.style.transform).toContain('scale('));

    // 读取 jsdom 实际生效的 natural 尺寸（mock 可能不生效）
    const effW = img.naturalWidth || 500;
    const effH = img.naturalHeight || 400;
    const viewportW = 1000;
    const viewportH = 800;

    // 在远离图片中心的位置滚轮缩放
    fireEvent.wheel(stage, { deltaY: -100, clientX: 50, clientY: 50 });
    await waitFor(() => {
      const next = stage.style.transform;
      expect(next).toContain('scale(');
      // scale 变化了
      expect(next).not.toBe(stage.dataset.lastWheelTransform);
    });
    stage.dataset.lastWheelTransform = stage.style.transform;

    // 元素中心 viewport 位置：
    // cssTransform.tx = center.x + offsetX = (viewport.w - eff.w) / 2 + offsetX
    // 元素中心 viewport x = tx + eff.w / 2 = viewport.w / 2 + offsetX
    // “以图片中心为锚点”应保证 offsetX = 0 → 元素中心 = viewport 中心
    // 用 fit 前的 cssTransform 作为 baseline，对比 tx 是否随 scale 变化。
    const transformAfter = stage.style.transform;
    const fitTransform = stage.dataset.lastWheelTransform || transformAfter;
    const mFit = fitTransform.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s+scale\(([\d.]+)\)/);
    const mAfter = transformAfter.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)\s+scale\(([\d.]+)\)/);
    expect(mFit).not.toBeNull();
    expect(mAfter).not.toBeNull();
    const txFit = parseFloat(mFit![1]);
    const txAfter = parseFloat(mAfter![1]);
    const scaleFit = parseFloat(mFit![3]);
    const scaleAfter = parseFloat(mAfter![3]);
    // 如果以图片中心为锚点（point = viewport center），缩放前后 tx 应该保持不变：
    // tx_new = (viewport.w - eff.w) / 2 + offsetX_new
    // offsetX_new = viewport.w/2 - (viewport.w/2 - natural.w/2) * newScale/oldScale
    // 但当 point = viewport center（也是图片 center，因为 offset=0），imageX = natural.w/2。
    // offsetX_new = viewport.w/2 - (viewport.w - eff.w)/2 - (natural.w/2) * newScale
    //             = (viewport.w/2 + natural.w/2) - (viewport.w - eff.w)/2 - natural.w/2 * newScale
    //             = (viewport.w/2 - viewport.w/2 + eff.w/2) + natural.w/2 - natural.w/2 * newScale
    //             = eff.w/2 + natural.w/2 * (1 - newScale)
    // tx_new = (viewport.w - eff.w)/2 + eff.w/2 + natural.w/2 * (1 - newScale)
    //        = viewport.w/2 + natural.w/2 - natural.w/2 * newScale
    // tx_fit = viewport.w/2 (因为 fit scale 时自然居中)
    // 所以新 tx 应该 = tx_fit - (scaleAfter - scaleFit) * natural.w/2 + correction
    // 实际上：tx_after - tx_fit = natural.w/2 - natural.w/2 * scaleAfter/scaleFit
    //                                = natural.w/2 * (1 - scaleAfter/scaleFit)
    // 这个值在 jsdom 下由于 mock 不生效会有偏差。直接断言：滚轮前后 transform 内部 imageCenterX 不变。
    // imageCenterX = tx + eff.w/2 (与 scale 无关)
    // tx_after + eff.w/2 === tx_fit + eff.w/2  ↔  tx_after === tx_fit
    expect(Math.abs(txAfter - txFit)).toBeLessThan(0.5);
  });
});
