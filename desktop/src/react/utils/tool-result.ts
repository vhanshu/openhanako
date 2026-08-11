/**
 * tool-result.ts — 按需拉取工具调用的完整执行结果
 *
 * 服务端接口：GET /api/sessions/tool-result?sessionPath=<path>&toolCallId=<id>[&download=1]
 *   - 不传 download：返回 JSON，默认内联预览上限 2 MB；超过则 status="too_large"。
 *   - 带 download=1：返回 text/plain + Content-Disposition，浏览器直接保存为 .txt。
 * 详细协议见 server/routes/sessions.ts。
 *
 * 前端 ToolCall 上能拿到 name/args/status/error/details，但拿不到完整
 * result.content（详见 server/routes/chat.ts 中关于"只广播 details"的注释）。
 * 工具详情抽屉点开时按需走这条路径拉完整结果。
 */

import type { ToolCall } from '../stores/chat-types';
import { hanaFetch } from '../hooks/use-hana-fetch';

export type ToolResultStatus =
  | 'loading'
  | 'available'
  | 'unavailable'
  | 'unsupported'
  | 'too_large';

export interface ToolResultPayload {
  status: ToolResultStatus;
  /** toolCallId（服务端返回，便于 UI 校对） */
  toolCallId?: string;
  /** 文本类结果：模型看到的那一坨 text content（可能截断） */
  text?: string;
  /** 结构化 details（通常是元数据/引用，不是完整结果） */
  details?: ToolCall['details'];
  /** 工具名（接口里附带过来，方便 UI 校对） */
  toolName?: string;
  /** 是否错误结果（来自 toolResult.isError） */
  isError?: boolean;
  /** 失败时的简短错误文本（来自 details.error） */
  error?: string;
  /** result 是否被截断展示 */
  truncated?: boolean;
  /** 原始字节大小 */
  totalBytes?: number;
  /** 内联上限（与 totalBytes 一起用于提示用户） */
  inlineLimitBytes?: number;
  /** 当 status 为 unavailable/unsupported 时的原因 */
  reason?: string;
}

export interface FetchToolResultOptions {
  /** 超时毫秒；默认 8000 */
  timeoutMs?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 服务端响应 JSON 的本端视图（不暴露给外部，仅供解析） */
interface ToolResultApiResponse {
  status: ToolResultStatus;
  toolCallId?: string;
  toolName?: string | null;
  isError?: boolean;
  text?: string;
  truncated?: boolean;
  totalBytes?: number;
  inlineLimitBytes?: number;
  error?: string;
  details?: ToolCall['details'] | null;
  reason?: string;
}

/**
 * 拉取工具调用的完整结果。返回：
 *   - status: 'available' 时，text/details 至少有一个
 *   - status: 'unavailable' 时，reason 解释为什么
 *   - status: 'unsupported' 时，例如未提供 toolCallId 或 tool 还在流式中
 */
export async function fetchToolCallResult(
  sessionPath: string,
  tool: ToolCall,
  options: FetchToolResultOptions = {},
): Promise<ToolResultPayload> {
  const toolCallId = tool.id;
  if (!toolCallId) {
    return {
      status: 'unsupported',
      reason: '该工具调用没有 toolCallId（流式中或历史协议缺失），无法按 id 查询',
    };
  }
  if (!sessionPath) {
    return {
      status: 'unsupported',
      reason: '未提供 sessionPath',
    };
  }

  const params = new URLSearchParams();
  params.set('sessionPath', sessionPath);
  params.set('toolCallId', toolCallId);

  try {
    const res = await hanaFetch(
      `/api/sessions/tool-result?${params.toString()}`,
      {
        method: 'GET',
        timeout: options.timeoutMs ?? 8000,
        ...(options.signal ? { signal: options.signal } : {}),
      },
    );
    const body = (await res.json()) as ToolResultApiResponse;

    if (body.status === 'available') {
      return {
        status: 'available',
        ...(typeof body.text === 'string' ? { text: body.text } : {}),
        ...(body.details ? { details: body.details } : {}),
        ...(typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
        ...(typeof body.isError === 'boolean' ? { isError: body.isError } : {}),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
        ...(typeof body.truncated === 'boolean' ? { truncated: body.truncated } : {}),
        ...(typeof body.totalBytes === 'number' ? { totalBytes: body.totalBytes } : {}),
      };
    }
    if (body.status === 'too_large') {
      return {
        status: 'too_large',
        toolCallId: body.toolCallId ?? toolCallId,
        ...(typeof body.toolName === 'string' ? { toolName: body.toolName } : {}),
        ...(typeof body.totalBytes === 'number' ? { totalBytes: body.totalBytes } : {}),
        ...(typeof body.inlineLimitBytes === 'number' ? { inlineLimitBytes: body.inlineLimitBytes } : {}),
        ...(typeof body.isError === 'boolean' ? { isError: body.isError } : {}),
        ...(typeof body.error === 'string' ? { error: body.error } : {}),
        ...(body.details ? { details: body.details } : {}),
        reason: '结果超过内联上限，请下载 .txt 查看完整内容',
      };
    }
    if (body.status === 'unsupported') {
      return { status: 'unsupported', reason: body.reason || '服务端不支持此 tool-result 查询' };
    }
    return { status: 'unavailable', reason: body.reason || '服务端未返回结果' };
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export interface DownloadToolResultOptions {
  /** 超时毫秒；默认 30000（下载模式可能拉大文件，给多一点时间） */
  timeoutMs?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 从 Content-Disposition 头解析文件名；解析失败时按 toolCallId 生成默认名。 */
function filenameFromDisposition(
  disposition: string | null | undefined,
  fallback: string,
): string {
  if (!disposition) return fallback;
  // RFC 5987: filename*=UTF-8''<percent-encoded>
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch { /* fallback */ }
  }
  // RFC 6266: filename="..."
  const quoted = disposition.match(/filename="?([^";]+)"?/i)?.[1];
  if (quoted) return quoted.trim();
  return fallback;
}

function defaultFilename(tool: ToolCall): string {
  const safeName = (tool.name || 'tool').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60) || 'tool';
  const safeId = (tool.id || 'unknown').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);
  return `tool-result-${safeName}-${safeId}.txt`;
}

/**
 * 下载工具结果为 .txt，触发浏览器保存。不受内联 2 MB 限制。
 * 调用成功返回带文件名的对象；失败 throw。
 */
export async function downloadToolCallResult(
  sessionPath: string,
  tool: ToolCall,
  options: DownloadToolResultOptions = {},
): Promise<{ filename: string }> {
  const toolCallId = tool.id;
  if (!toolCallId) throw new Error('该工具调用没有 toolCallId，无法下载');
  if (!sessionPath) throw new Error('未提供 sessionPath');

  const params = new URLSearchParams();
  params.set('sessionPath', sessionPath);
  params.set('toolCallId', toolCallId);
  params.set('download', '1');

  const res = await hanaFetch(
    `/api/sessions/tool-result?${params.toString()}`,
    {
      method: 'GET',
      timeout: options.timeoutMs ?? 30000,
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );

  const blob = await res.blob();
  const fallback = defaultFilename(tool);
  const filename = filenameFromDisposition(res.headers.get('content-disposition'), fallback);

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = 'noopener';
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return { filename };
}