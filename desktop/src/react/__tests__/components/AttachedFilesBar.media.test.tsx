// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AttachedFilesBar } from '../../components/input/AttachedFilesBar';

describe('AttachedFilesBar media chips', () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    delete (window as unknown as { platform?: unknown }).platform;
  });

  it('renders image attachments with rounded thumbnail previews', () => {
    const onRemove = vi.fn();
    window.platform = {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;

    const { container } = render(<AttachedFilesBar
      files={[{ path: '/tmp/pasted.png', name: 'pasted.png', mimeType: 'image/png' }]}
      onRemove={onRemove}
    />);

    expect(screen.getByText('pasted.png')).toBeInTheDocument();
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'file:///tmp/pasted.png');
    expect(window.platform.getFileUrl).toHaveBeenCalledWith('/tmp/pasted.png');

    fireEvent.click(screen.getByLabelText('Remove pasted.png'));
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it('exposes image chip as a button when onChipClick is provided, and routes clicks to handler', () => {
    const onRemove = vi.fn();
    const onChipClick = vi.fn();
    window.platform = {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;

    render(<AttachedFilesBar
      files={[{ path: '/tmp/pasted.png', name: 'pasted.png', mimeType: 'image/png' }]}
      onRemove={onRemove}
      onChipClick={onChipClick}
    />);

    // chip 本体的 aria-label 是“pasted.png（点击预览）”，和 Remove 按钮可区分
    const chip = screen.getByLabelText('pasted.png（点击预览）');
    expect(chip.getAttribute('role')).toBe('button');
    fireEvent.click(chip);
    expect(onChipClick).toHaveBeenCalledTimes(1);
    expect(onChipClick.mock.calls[0][0].path).toBe('/tmp/pasted.png');

    // 点删除按钮不触发 chip click，也不改 handler
    fireEvent.click(screen.getByLabelText('Remove pasted.png'));
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(onChipClick).toHaveBeenCalledTimes(1);
  });

  it('exposes document chip as a button when onChipClick is provided and routes keyboard activation', () => {
    const onRemove = vi.fn();
    const onChipClick = vi.fn();
    window.platform = {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;

    render(<AttachedFilesBar
      files={[{ path: '/tmp/report.d', name: 'report.d' }]}
      onRemove={onRemove}
      onChipClick={onChipClick}
    />);

    const chip = screen.getByLabelText('report.d（点击打开）');
    expect(chip.getAttribute('role')).toBe('button');

    fireEvent.click(chip);
    expect(onChipClick).toHaveBeenCalledTimes(1);
    expect(onChipClick.mock.calls[0][0].name).toBe('report.d');

    fireEvent.keyDown(chip, { key: 'Enter' });
    fireEvent.keyDown(chip, { key: ' ' });
    expect(onChipClick).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByLabelText('Remove report.d'));
    expect(onRemove).toHaveBeenCalledWith(0);
    expect(onChipClick).toHaveBeenCalledTimes(3);
  });

  it('does not mark chips as interactive when onChipClick is omitted', () => {
    const onRemove = vi.fn();
    window.platform = {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;

    render(<AttachedFilesBar
      files={[
        { path: '/tmp/pasted.png', name: 'pasted.png', mimeType: 'image/png' },
        { path: '/tmp/report.d', name: 'report.d' },
      ]}
      onRemove={onRemove}
    />);

    expect(screen.queryByLabelText('pasted.png（点击预览）')).toBeNull();
    expect(screen.queryByLabelText('report.d（点击打开）')).toBeNull();
  });

  it('renders audio attachments with a play control, fake waveform, and remove action', () => {
    const onRemove = vi.fn();
    const audioInstances: Array<{ src: string; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }> = [];
    const AudioMock = vi.fn().mockImplementation(function MockAudio(this: {
      src: string;
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      onended: (() => void) | null;
      onerror: (() => void) | null;
    }, src: string) {
      this.src = src;
      this.play = vi.fn(() => Promise.resolve());
      this.pause = vi.fn();
      this.onended = null;
      this.onerror = null;
      audioInstances.push(this);
    });
    vi.stubGlobal('Audio', AudioMock);
    window.platform = {
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;

    const { container } = render(<AttachedFilesBar
      files={[{ path: '/tmp/clip.wav', name: 'clip.wav', mimeType: 'audio/wav' }]}
      onRemove={onRemove}
    />);

    expect(screen.getByTestId('audio-attachment-wave')).toBeInTheDocument();
    expect(screen.getByText('clip.wav')).toBeInTheDocument();
    expect(screen.getByLabelText('Play clip.wav')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Play clip.wav'));

    expect(AudioMock).toHaveBeenCalledWith('file:///tmp/clip.wav');
    expect(audioInstances[0].play).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Remove clip.wav'));

    expect(audioInstances[0].pause).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledWith(0);
  });
});
