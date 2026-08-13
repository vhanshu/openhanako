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
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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
  /** 按文件名找文件行（data-file-id 是 buildFileRefId 生成的语义化 id，不是 mock 的 sf_*） */
  function rowsByFileName(root: HTMLElement): { expired: Element | null; alive: Element | null } {
    const rows = Array.from(root.querySelectorAll('[data-session-file-row]'));
    return {
      expired: rows.find(r => r.textContent?.includes('duplicate_finder.py')) || null,
      alive: rows.find(r => r.textContent?.includes('小薇.md')) || null,
    };
  }
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
      activeServerConnection: {
        studioId: 'default',
        // local-owner 连接：canUseNativeResourcePath 依赖 kind/credentialKind
        kind: 'local',
        credentialKind: 'loopback_token',
        baseUrl: 'http://127.0.0.1:3210',
      },
      sessionRegistryFilesByPath: {
        '/sessions/main.jsonl': [
          {
            id: 'sf_expired',
            fileId: 'sf_expired',
            kind: 'file',
            name: 'duplicate_finder.py',
            // SessionRegistryFile 的路径字段是 filePath，不是 path
            filePath: '/Users/x/OH-WorkSpace/duplicate_finder.py',
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
            filePath: '/Users/x/OH-WorkSpace/小薇.md',
            ext: 'md',
            sessionPath: '/sessions/main.jsonl',
            // 带 resource content link：fileRefDownloadUrl 走远端 URL（本地文件无 resource 时返回 null，下载按钮不渲染）
            resource: {
              schemaVersion: 1,
              resourceId: 'res_sf_alive',
              name: '小薇.md',
              studioId: 'default',
              type: 'file',
              source: 'session_file',
              links: { self: '/api/resources/res_sf_alive', content: '/api/resources/res_sf_alive/content' },
            },
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

    const expiredRow = rowsByFileName(root).expired;
    expect(expiredRow).not.toBeNull();
    expect(expiredRow?.getAttribute('data-expired')).toBe('true');
    // 三角警告 badge：在 expired row 的 fileIcon 下渲染
    expect(expiredRow?.querySelector('[class*="fileIconExpiredBadge"]'))
      .not.toBeNull();
    // status meta 显示"已过期"
    expect(screen.getByText('已过期')).toBeInTheDocument();
    // 正常文件没有 badge
    const aliveRow = rowsByFileName(root).alive;
    expect(aliveRow?.getAttribute('data-expired')).toBe('false');
    expect(aliveRow?.querySelector('[class*="fileIconExpiredBadge"]')).toBeNull();
  });

  it('disables preview/open/reveal/download actions on expired row; copy path stays enabled', () => {
    const { container: root } = render(<SessionRegistryFilesPanel />);

    const expiredRow = rowsByFileName(root).expired as HTMLElement;
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

    const aliveRow = rowsByFileName(root).alive as HTMLElement;
    const buttons = Array.from(aliveRow.querySelectorAll('button')) as HTMLButtonElement[];
    const anchors = Array.from(aliveRow.querySelectorAll('a')) as HTMLAnchorElement[];

    const previewBtn = buttons.find(b => b.getAttribute('title')?.startsWith('预览'));
    const downloadLink = anchors.find(a => a.getAttribute('title')?.startsWith('下载'));
    expect(previewBtn?.disabled).toBe(false);
    expect(downloadLink?.getAttribute('aria-disabled')).toBeNull();
    expect(downloadLink?.getAttribute('href')).not.toBeNull();
  });

  it('flips a registry-available row to expired when pathExists reports the file missing', async () => {
    // registry 里 status 未标 expired（available），但文件实际已被删除/重命名：
    // 渲染层 stat 检查应把行置灰，跟 registry 自带 expired 的表现一致。
    (window.platform as any).pathExists = vi.fn(async (path: string) => path.includes('duplicate_finder.py') ? false : true);
    const { container: root } = render(<SessionRegistryFilesPanel />);

    await waitFor(() => {
      const expiredRow = rowsByFileName(root).expired;
      expect(expiredRow?.getAttribute('data-expired')).toBe('true');
    });
    const expiredRow = rowsByFileName(root).expired as HTMLElement;
    expect(expiredRow?.querySelector('[class*="fileIconExpiredBadge"]')).not.toBeNull();

    // 行内动作：preview/open/reveal 置灰，copy path 仍可用
    const buttons = Array.from(expiredRow.querySelectorAll('button')) as HTMLButtonElement[];
    const anchors = Array.from(expiredRow.querySelectorAll('a')) as HTMLAnchorElement[];
    const previewBtn = buttons.find(b => b.getAttribute('title')?.startsWith('预览'));
    const openBtn = buttons.find(b => b.getAttribute('title')?.startsWith('打开'));
    const revealBtn = buttons.find(b => b.getAttribute('title')?.startsWith('定位'));
    const copyBtn = buttons.find(b => b.getAttribute('title')?.startsWith('复制路径'));
    const downloadLink = anchors.find(a => a.getAttribute('title')?.startsWith('下载'));
    expect(previewBtn?.disabled).toBe(true);
    expect(openBtn?.disabled).toBe(true);
    expect(revealBtn?.disabled).toBe(true);
    expect(downloadLink?.getAttribute('aria-disabled')).toBe('true');
    expect(copyBtn?.disabled).toBe(false);

    // 存在性检查没有误伤真实存在的文件
    const aliveRow = rowsByFileName(root).alive as HTMLElement;
    expect(aliveRow?.getAttribute('data-expired')).toBe('false');
  });
});