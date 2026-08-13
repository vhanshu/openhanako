/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  openPreview: vi.fn(),
  showError: vi.fn(),
  openMediaViewerFromContext: vi.fn(),
}));

vi.mock('../../stores/preview-actions', () => ({
  openPreview: mocks.openPreview,
}));

vi.mock('../../utils/ui-helpers', () => ({
  showError: mocks.showError,
}));

vi.mock('../../utils/open-media-viewer', () => ({
  openMediaViewerFromContext: mocks.openMediaViewerFromContext,
}));

import { openFilePreview, openSkillPreview } from '../../utils/file-preview';

describe('file-preview IPC error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (window as any).platform = {
      readFile: vi.fn(),
      readFileSnapshot: vi.fn(),
      readDocxHtml: vi.fn(),
      readXlsxHtml: vi.fn(),
      readFileBase64: vi.fn(),
      getFileUrl: vi.fn((filePath: string) => `file://${filePath}`),
      openSkillViewer: vi.fn(),
    };
  });

  afterEach(() => {
    delete (window as any).platform;
  });

  it('预览读取异常时向用户报错，并且不再把 Promise 泄漏到全局', async () => {
    (window as any).platform.readFile.mockRejectedValue(new Error('preview exploded'));

    await expect(openFilePreview('/tmp/demo.md', 'demo.md', 'md', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.showError).toHaveBeenCalledWith('preview exploded');
    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect(mocks.openMediaViewerFromContext).not.toHaveBeenCalled();
  });

  it('技能预览使用既有 Skill Viewer overlay，而不是 markdown Preview 面板', async () => {
    (window as any).platform.readFile.mockResolvedValue('---\nname: demo-skill\n---\n# Demo');

    await expect(openSkillPreview('demo-skill', '/tmp/demo-skill/SKILL.md')).resolves.toBeUndefined();

    expect((window as any).platform.openSkillViewer).toHaveBeenCalledWith({
      name: 'demo-skill',
      baseDir: '/tmp/demo-skill',
      filePath: '/tmp/demo-skill/SKILL.md',
      installed: true,
    });
    expect((window as any).platform.readFile).not.toHaveBeenCalled();
    expect(mocks.openPreview).not.toHaveBeenCalled();
  });

  it('技能预览优先使用已登记的 installedSkillSource.baseDir', async () => {
    const openSkillPreviewWithSource = openSkillPreview as unknown as (
      skillName: string,
      skillFilePath: string,
      source: { skillName: string; baseDir: string; filePath: string },
    ) => Promise<void>;

    await expect(openSkillPreviewWithSource('demo-skill', '/stale/path/SKILL.md', {
      skillName: 'source-skill',
      baseDir: '/installed/source-skill',
      filePath: '/installed/source-skill/SKILL.md',
    })).resolves.toBeUndefined();

    expect((window as any).platform.openSkillViewer).toHaveBeenCalledWith({
      name: 'source-skill',
      baseDir: '/installed/source-skill',
      filePath: '/installed/source-skill/SKILL.md',
      installed: true,
    });
    expect(mocks.openPreview).not.toHaveBeenCalled();
  });

  it('技能预览缺少可用路径时显式报错', async () => {
    await expect(openSkillPreview('demo-skill', '')).resolves.toBeUndefined();

    expect(mocks.showError).toHaveBeenCalledWith('skill preview path missing');
    expect(mocks.openPreview).not.toHaveBeenCalled();
    expect((window as any).platform.openSkillViewer).not.toHaveBeenCalled();
  });

  it('PDF 预览使用本地 file URL，不因 base64 读取失败回退成文件信息卡', async () => {
    (window as any).platform.readFileBase64.mockResolvedValue(null);

    await expect(openFilePreview('/tmp/Report.PDF', 'Report.PDF', 'PDF', { origin: 'desk' })).resolves.toBeUndefined();

    expect((window as any).platform.getFileUrl).toHaveBeenCalledWith('/tmp/Report.PDF');
    expect((window as any).platform.readFileBase64).not.toHaveBeenCalled();
    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-/tmp/Report.PDF',
      type: 'pdf',
      title: 'Report.PDF',
      content: '',
      filePath: '/tmp/Report.PDF',
      ext: 'pdf',
      sourceUrl: 'file:///tmp/Report.PDF',
    }));
  });

  it('代码预览读不到内容时，打开带 status=expired 的 file-info 预览', async () => {
    // 模拟文件被重命名 / 删除 / 临时 IO 失败：readFileSnapshot 返回 null
    (window as any).platform.readFileSnapshot.mockResolvedValue(null);

    await expect(openFilePreview('/tmp/duplicate_finder.py', 'duplicate_finder.py', 'py', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-/tmp/duplicate_finder.py',
      type: 'file-info',
      title: 'duplicate_finder.py',
      filePath: '/tmp/duplicate_finder.py',
      ext: 'py',
      status: 'expired',
      missingAt: expect.any(Number),
    }));
  });

  it('HTML 预览保留调用方提供的安全资源根', async () => {
    (window as any).platform.readFile.mockResolvedValue('<img src="../assets/pic.png">');

    await expect(openFilePreview(
      '/workspace/pages/demo.html',
      'demo.html',
      'HTML',
      { origin: 'desk', sourceRootPath: '/workspace' } as Parameters<typeof openFilePreview>[3] & { sourceRootPath: string },
    )).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-/workspace/pages/demo.html',
      type: 'html',
      title: 'demo.html',
      content: '<img src="../assets/pic.png">',
      filePath: '/workspace/pages/demo.html',
      ext: 'html',
      sourceRootPath: '/workspace',
    }));
  });

  it('无扩展名的纯文本文件（如 Dockerfile）走 code 预览，language 透传给 PreviewEditor 高亮', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue({
      content: 'FROM node:20\nWORKDIR /app\n',
      version: { mtimeMs: 100, size: 30, sha256: 'abc' },
    });

    await expect(openFilePreview('/repo/Dockerfile', 'Dockerfile', '', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-/repo/Dockerfile',
      type: 'code',
      title: 'Dockerfile',
      content: 'FROM node:20\nWORKDIR /app\n',
      filePath: '/repo/Dockerfile',
      ext: '',
      language: 'dockerfile',
      fileVersion: { mtimeMs: 100, size: 30, sha256: 'abc' },
    }));
    expect((window as any).platform.readFileSnapshot).toHaveBeenCalledWith('/repo/Dockerfile');
  });

  it('无扩展名但含点的文件名（Dockerfile.local）按 txt 处理，不传 language', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue({
      content: 'local override\n',
      version: { mtimeMs: 100, size: 15, sha256: 'abc' },
    });

    await expect(openFilePreview('/repo/Dockerfile.local', 'Dockerfile.local', '', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      type: 'code',
      title: 'Dockerfile.local',
      ext: '',
      language: undefined,
    }));
  });

  it('无扩展名文件探测不到纯文本（readFileSnapshot 返 null）走 file-info', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue(null);

    await expect(openFilePreview('/repo/blob', 'blob', '', { origin: 'desk' })).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      id: 'file-/repo/blob',
      type: 'file-info',
      title: 'blob',
      filePath: '/repo/blob',
      ext: '',
    }));
    expect(mocks.openPreview).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'expired' }));
  });

  it('路径含混合分隔符的无扩展名文件，basename 提取仍能正确传 language', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue({
      content: 'build\n',
      version: { mtimeMs: 100, size: 6, sha256: 'abc' },
    });

    await expect(openFilePreview(
      'C:\\repo\\sub\\Jenkinsfile',
      'C:\\repo\\sub\\Jenkinsfile',
      '',
      { origin: 'desk' },
    )).resolves.toBeUndefined();

    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      type: 'code',
      title: 'C:\\repo\\sub\\Jenkinsfile',
      ext: '',
      language: 'jenkinsfile',
    }));
  });

  it('ext 为 undefined（workbench 路径传过来）走空 ext 探测分支，不会抛 TypeError', async () => {
    (window as any).platform.readFileSnapshot.mockResolvedValue({
      content: 'FROM node:20\n',
      version: { mtimeMs: 100, size: 14, sha256: 'abc' },
    });

    await expect(openFilePreview(
      '/repo/Dockerfile',
      'Dockerfile',
      undefined as unknown as string,
      { origin: 'desk' },
    )).resolves.toBeUndefined();

    expect(mocks.showError).not.toHaveBeenCalled();
    expect(mocks.openPreview).toHaveBeenCalledWith(expect.objectContaining({
      type: 'code',
      title: 'Dockerfile',
      ext: '',
      language: 'dockerfile',
    }));
  });
});
