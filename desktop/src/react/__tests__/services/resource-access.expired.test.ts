/**
 * @vitest-environment jsdom
 *
 * SessionRegistryFilesPanel 用的资源访问 helpers 在 expired 文件上的行为。
 */
import { describe, expect, it } from 'vitest';
import {
  canPreviewFileRef,
  canUseFileRefNativePath,
  resolveFileRefNativePath,
} from '../../services/resource-access';
import type { FileRef } from '../../types/file-ref';

function makeFileRef(overrides: Partial<FileRef> = {}): FileRef {
  return {
    id: 'sf_test',
    kind: 'file',
    name: 'demo.py',
    path: '/Users/x/OH-WorkSpace/demo.py',
    ext: 'py',
    ...overrides,
  } as FileRef;
}

const desktopContext = {
  // 当前 API：context 只带 connection；null = 本地桌面（非远端连接），
  // canUseNativeResourcePath 返回 true，语义与旧字段 canUseNativeResourcePath: true 一致。
  connection: null,
};

describe('resource-access — expired file guards', () => {
  it('canPreviewFileRef returns false when file status is expired', () => {
    const expired = makeFileRef({ status: 'expired' });
    expect(canPreviewFileRef(expired, desktopContext)).toBe(false);
  });

  it('canPreviewFileRef returns true when file is available (status undefined)', () => {
    const alive = makeFileRef();
    expect(canPreviewFileRef(alive, desktopContext)).toBe(true);
  });

  it('canUseFileRefNativePath with requireAvailable returns false for expired files', () => {
    const expired = makeFileRef({ status: 'expired' });
    expect(canUseFileRefNativePath(expired, desktopContext, { requireAvailable: true })).toBe(false);
    // open / reveal 按钮会走这条 → 自动置灰
  });

  it('canUseFileRefNativePath without requireAvailable keeps returning true for expired files (copy path still works)', () => {
    const expired = makeFileRef({ status: 'expired' });
    expect(canUseFileRefNativePath(expired, desktopContext)).toBe(true);
    // copy path 按钮走这条 → 用户能复制旧路径去外找文件
  });

  it('resolveFileRefNativePath with requireAvailable returns null for expired files', () => {
    const expired = makeFileRef({ status: 'expired' });
    expect(resolveFileRefNativePath(expired, desktopContext, { requireAvailable: true })).toBeNull();
    // openFile / revealFile 拿不到 native path，自然走不到平台 API
  });
});