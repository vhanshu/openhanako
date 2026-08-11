import type { ActivePanel, RightWorkspaceTab, TabType } from '../types';
import type { FileRef } from '../types/file-ref';
import type { ToolCall } from './chat-types';

export interface MediaViewerState {
  files: FileRef[];
  currentId: string;
  origin: 'desk' | 'session';
}

export interface SettingsModalState {
  open: boolean;
  activeTab: string;
}

/**
 * 工具调用 inspector 的状态：当前正在查看的工具调用 + 所在会话路径。
 * 会话路径用于后续按需拉取完整结果（待服务端 tool-result 接口就位）。
 */
export interface ToolInspectorState {
  tool: ToolCall;
  sessionPath: string;
}

export interface UiSlice {
  sidebarOpen: boolean;
  sidebarAutoCollapsed: boolean;
  jianOpen: boolean;
  jianAutoCollapsed: boolean;
  previewOpen: boolean;
  welcomeVisible: boolean;
  currentTab: TabType;
  activePanel: ActivePanel;
  rightWorkspaceTab: RightWorkspaceTab;
  jianDrawerOpen: boolean;
  locale: string;
  /** Skill 预览 overlay 数据（null = 关闭） */
  skillViewerData: { name: string; baseDir: string; filePath?: string; installed?: boolean } | null;
  /** 媒体预览 overlay 状态（null = 关闭） */
  mediaViewer: MediaViewerState | null;
  /** 工具调用详情 inspector 状态（null = 关闭） */
  toolInspector: ToolInspectorState | null;
  /** 主窗口内嵌设置浮层状态 */
  settingsModal: SettingsModalState;
  /** Skill catalog revision; bumped by app_event skills-changed to refresh derived lists. */
  skillCatalogVersion: number;
  /** 频道创建弹窗是否可见 */
  channelCreateOverlayVisible: boolean;
  setSidebarOpen: (open: boolean) => void;
  setSidebarAutoCollapsed: (collapsed: boolean) => void;
  setJianOpen: (open: boolean) => void;
  setJianAutoCollapsed: (collapsed: boolean) => void;
  setPreviewOpen: (open: boolean) => void;
  setWelcomeVisible: (visible: boolean) => void;
  setCurrentTab: (tab: TabType) => void;
  setActivePanel: (panel: ActivePanel) => void;
  setRightWorkspaceTab: (tab: RightWorkspaceTab) => void;
  setJianDrawerOpen: (open: boolean) => void;
  setChannelCreateOverlayVisible: (visible: boolean) => void;
  setMediaViewer: (state: MediaViewerState | null) => void;
  setSettingsModal: (state: SettingsModalState) => void;
  setMediaViewerCurrent: (id: string) => void;
  closeMediaViewer: () => void;
  /** 打开工具调用详情 inspector */
  openToolInspector: (state: ToolInspectorState) => void;
  /** 关闭工具调用详情 inspector */
  closeToolInspector: () => void;
  toggleSidebar: () => void;
  toggleJian: () => void;
}

export const createUiSlice = (
  set: (partial: Partial<UiSlice> | ((s: UiSlice) => Partial<UiSlice>)) => void
): UiSlice => ({
  sidebarOpen: true,
  sidebarAutoCollapsed: false,
  jianOpen: true,
  jianAutoCollapsed: false,
  previewOpen: false,
  welcomeVisible: true,
  currentTab: 'chat',
  activePanel: null,
  rightWorkspaceTab: 'workspace',
  jianDrawerOpen: false,
  // Keep locale empty until i18n.load() finishes so the first successful
  // locale sync always triggers a rerender, even for the default zh locale.
  locale: '',
  skillViewerData: null,
  mediaViewer: null,
  toolInspector: null,
  settingsModal: { open: false, activeTab: 'agent' },
  skillCatalogVersion: 0,
  channelCreateOverlayVisible: false,
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarAutoCollapsed: (collapsed) => set({ sidebarAutoCollapsed: collapsed }),
  setJianOpen: (open) => set({ jianOpen: open }),
  setJianAutoCollapsed: (collapsed) => set({ jianAutoCollapsed: collapsed }),
  setPreviewOpen: (open) => set({ previewOpen: open }),
  setWelcomeVisible: (visible) => set({ welcomeVisible: visible }),
  setCurrentTab: (tab) => set({ currentTab: tab }),
  setActivePanel: (panel) => set({ activePanel: panel }),
  setRightWorkspaceTab: (tab) => set({ rightWorkspaceTab: tab }),
  setJianDrawerOpen: (open) => set({ jianDrawerOpen: open }),
  setChannelCreateOverlayVisible: (visible) => set({ channelCreateOverlayVisible: visible }),
  setMediaViewer: (state) => set({ mediaViewer: state }),
  setSettingsModal: (state) => set({ settingsModal: state }),
  setMediaViewerCurrent: (id) => set((s) => ({
    mediaViewer: s.mediaViewer ? { ...s.mediaViewer, currentId: id } : null,
  })),
  closeMediaViewer: () => set({ mediaViewer: null }),
  openToolInspector: (state) => set({ toolInspector: state }),
  closeToolInspector: () => set({ toolInspector: null }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleJian: () => set((s) => ({ jianOpen: !s.jianOpen })),
});
