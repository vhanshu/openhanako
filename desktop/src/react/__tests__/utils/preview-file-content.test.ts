/**
 * @vitest-environment jsdom
 *
 * readFileForPreviewType 对 file-info PreviewItem 的 stat 行为：
 *  OpenPreviewDocumentWatchBridge 的 refresh 路径会调本函数判断文件 IO 状态。
 *  如果对 file-info 类型永远 return { content: '' }，则文件被删 / 重命名后
 *  watch 触发的 refresh 永远把 PreviewItem 标 available，导致"陈旧 PreviewItem
 *  永远不会被识别为过期"。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileForPreviewType } from '../../utils/preview-file-content';

describe('readFileForPreviewType — file-info stat verification', () => {
  beforeEach(() => {
    (window as any).platform = {
      readFileSnapshot: vi.fn(),
      readFile: vi.fn(),
      readFileBase64: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).platform;
  });

  it('returns null when both readFileSnapshot and readFileBase64 fail (file missing)', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue(null);
    (window as any).platform.readFileBase64.mockResolvedValue(null);

    const result = await readFileForPreviewType('/tmp/renamed.py', 'file-info');

    expect(result).toBeNull();
    expect((window as any).platform.readFileSnapshot).toHaveBeenCalledWith('/tmp/renamed.py');
    expect((window as any).platform.readFileBase64).toHaveBeenCalledWith('/tmp/renamed.py');
  });

  it('returns a snapshot-bearing result when readFileSnapshot succeeds', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue({
      content: '# hello',
      version: { mtimeMs: 123, size: 7, sha256: 'abc' },
    });

    const result = await readFileForPreviewType('/tmp/alive.py', 'file-info');

    expect(result).toEqual({
      content: '',
      fileVersion: { mtimeMs: 123, size: 7, sha256: 'abc' },
    });
    expect((window as any).platform.readFileBase64).not.toHaveBeenCalled();
  });

  it('falls back to readFileBase64 when readFileSnapshot rejects binary files', async () => {
    // 模拟 .exe / .zip 等二进制：readFileSnapshot 内部检测到 NUL 字节返回 null，
    // 但文件本身存在。readFileBase64 仍能读到 → 视为文件可用，避免误标 expired。
    (window as any).platform.readFileSnapshot.mockResolvedValue(null);
    (window as any).platform.readFileBase64.mockResolvedValue('AAABBB');

    const result = await readFileForPreviewType('/tmp/binary.exe', 'file-info');

    expect(result).toEqual({ content: '' });
    expect((window as any).platform.readFileBase64).toHaveBeenCalledWith('/tmp/binary.exe');
  });

  it('returns empty content without IPC when filePath is empty', async () => {
    const result = await readFileForPreviewType('', 'file-info');

    expect(result).toEqual({ content: '' });
    expect((window as any).platform.readFileSnapshot).not.toHaveBeenCalled();
    expect((window as any).platform.readFileBase64).not.toHaveBeenCalled();
  });
});