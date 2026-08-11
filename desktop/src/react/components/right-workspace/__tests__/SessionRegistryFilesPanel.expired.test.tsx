/**
 * @vitest-environment jsdom
 *
 * SessionRegistryFilesPanel 在文件 expired 时的视觉与交互行为：
 * - 文件图标右下角叠加红色三角警告 badge
 * - preview / open / reveal / download 按钮置灰（HTML <a> 用 aria-disabled + pointer-events）
 * - copy path 仍可用（让用户能复制旧路径去外查找文件）
 * - 文件名 title 提示过期 tooltip
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistryFilesPanel } from '../SessionRegistryFilesPanel';
import { useStore } from '../../../stores';

vi.mock('../../../hooks/use-hana-fetch', () => ({
  hanaFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  hanaUrl: (path: string) => `http://127.0.0.1:3210${path}`,
}));

const tMap: Record<string, string> = {
  'rightWorkspace.sessionFiles.status.expired': '已过期',
  'rightWorkspace.sessionFiles.status.available': '可用',
  'rightWorkspace.sessionFiles.expiredTooltip': '本机文件已不可用',
  'chat.fileExpired': '文件已过期',
  'desk.openWithDefault': '用默认应用打开',
  'rightWorkspace.sessionFiles.actions.preview': '预览',
  'rightWorkspace.sessionFiles.actions.open': '打开',
  'rightWorkspace.sessionFiles.actions.reveal': '定位',
  'rightWorkspace.sessionFiles.actions.downloadToDevice': '下载',
  'rightWorkspace.sessionFiles.actions.copyPath': '复制路径',
  'rightWorkspace.sessionFiles.list': '对话文件',
  'rightWorkspace.sessionFiles.sort.label': '排序',
  'common.screenshotShare': '分享截图',
  'rightWorkspace.sessionFiles.sendToBridge': '发送到桥梁',
  'rightWorkspace.sessionFiles.sendToBridgeEmpty': '无可用桥梁目标',
};

describe('SessionRegistryFilesPanel — expired file presentation', () => {
  beforeEach(() => {
    window.t = ((key: string) => tMap[key] || key) as typeof window.t;
    window.platform = {
      openFile: vi.fn(),
      showInFinder: vi.fn(),
      getFileUrl: vi.fn((path: string) => `file://${path}`),
    } as unknown as typeof window.platform;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: vi.fn(async () => undefined) },
    });
    useStore.setState({
      currentSessionPath: '/sessions/main.jsonl',
      currentAgentId: 'hana',
      agentName: 'Hana',
      agents: [{ id: 'hana', name: 'Hana' }],
      deskBasePath: '/Users/x/Desktop/OH-WorkSpace',
      deskWorkspaceMountId: null,
      deskWorkspaceNativeRoot: null,
      studioWorkspaces: [],
      activeServerConnection: { studioId: 'default' },
      sessionRegistryFilesByPath: {
        '/sessions/main.jsonl': [
          {
            id: 'sf_expired',
            fileId: 'sf_expired',
            kind: 'file',
            name: 'duplicate_finder.py',
            path: '/Users/x/OH-WorkSpace/duplicate_finder.py',
            ext: 'py',
            status: 'expired',
            missingAt: 1234,
            sessionPath: '/sessions/main.jsonl',
          },
          {
            id: 'sf_alive',
            fileId: 'sf_alive',
            kind: 'file',
            name: '小薇.md',
            path: '/Users/x/OH-WorkSpace/小薇.md',
            ext: 'md',
            sessionPath: '/sessions/main.jsonl',
          },
        ],
      },
    } as any);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('marks expired row with data-expired and shows status label + warning badge icon', () => {
    const { container: root } = render(<SessionRegistryFilesPanel />);

    const expiredRow = root.querySelector('[data-file-id="sf_expired"]');
    expect(expiredRow).not.toBeNull();
    expect(expiredRow?.getAttribute('data-expired')).toBe('true');
    // 三角警告 badge：在 expired row 的 fileIcon 下渲染
    expect(root.querySelector('[data-file-id="sf_expired"] .fileIconExpiredBadge, [data-file-id="sf_expired"] [class*="fileIconExpiredBadge"]'))
      .not.toBeNull();
    // status meta 显示"已过期"
    expect(screen.getByText('已过期')).toBeInTheDocument();
    // 正常文件没有 badge
    const aliveRow = root.querySelector('[data-file-id="sf_alive"]');
    expect(aliveRow?.getAttribute('data-expired')).toBe('false');
    expect(root.querySelector('[data-file-id="sf_alive"] [class*="fileIconExpiredBadge"]'))
      .toBeNull();
  });

  it('disables preview/open/reveal/download actions on expired row; copy path stays enabled', () => {
    const { container: root } = render(<SessionRegistryFilesPanel />);

    const expiredRow = root.querySelector('[data-file-id="sf_expired"]') as HTMLElement;
    const buttons = Array.from(expiredRow.querySelectorAll('button')) as HTMLButtonElement[];
    const anchors = Array.from(expiredRow.querySelectorAll('a')) as HTMLAnchorElement[];

    const previewBtn = buttons.find(b => b.getAttribute('title')?.startsWith('预览'));
    const openBtn = buttons.find(b => b.getAttribute('title')?.startsWith('打开'));
    const revealBtn = buttons.find(b => b.getAttribute('title')?.startsWith('定位'));
    const copyBtn = buttons.find(b => b.getAttribute('title')?.startsWith('复制路径'));
    const downloadLink = anchors.find(a => a.getAttribute('title')?.startsWith('下载'));

    expect(previewBtn).toBeDefined();
    expect(previewBtn?.disabled).toBe(true);
    expect(openBtn?.disabled).toBe(true);
    expect(revealBtn?.disabled).toBe(true);
    // download 是 <a>：expired 时不能跳转，aria-disabled + 阻止 click
    expect(downloadLink?.getAttribute('aria-disabled')).toBe('true');
    expect(downloadLink?.getAttribute('href')).toBeNull();
    // copy path 在 expired 时仍可用（用户可能想复制旧路径去外找文件）
    expect(copyBtn?.disabled).toBe(false);
  });

  it('keeps non-expired file actions enabled', () => {
    const { container: root } = render(<SessionRegistryFilesPanel />);

    const aliveRow = root.querySelector('[data-file-id="sf_alive"]') as HTMLElement;
    const buttons = Array.from(aliveRow.querySelectorAll('button')) as HTMLButtonElement[];
    const anchors = Array.from(aliveRow.querySelectorAll('a')) as HTMLAnchorElement[];

    const previewBtn = buttons.find(b => b.getAttribute('title')?.startsWith('预览'));
    const downloadLink = anchors.find(a => a.getAttribute('title')?.startsWith('下载'));
    expect(previewBtn?.disabled).toBe(false);
    expect(downloadLink?.getAttribute('aria-disabled')).toBeNull();
    expect(downloadLink?.getAttribute('href')).not.toBeNull();
  });
});