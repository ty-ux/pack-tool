import type {
  AckPayload,
  AppConfig,
  AppsPayload,
  BrowsePayload,
  BuildStatus,
  DevicesPayload,
  HistoryDetailPayload,
  HistoryListPayload,
  HistoryLogPayload,
  LocalTools,
  LogPayload,
  PackageDeletePayload,
  PackagesPayload,
  PackageSyncPayload,
  PackageUploadPayload,
  Permission,
  PreflightPayload,
  ProjectType,
  WechatAction,
  SigningKey,
} from './types'

class ApiError extends Error {
  constructor(message: string, public status = 0) {
    super(message)
  }
}

async function request<T>(path: string, init?: RequestInit, allowBusinessFailure = false): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, init)
  } catch {
    throw new ApiError('无法连接服务，请确认服务已启动')
  }
  let data: { ok?: boolean; error?: string; message?: string; detail?: unknown } | null = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  if (data && data.ok === false && !allowBusinessFailure) {
    throw new ApiError(data.error || data.message || `请求失败 (${res.status})`, res.status)
  }
  if (!res.ok) {
    const detail = typeof data?.detail === 'string' ? data.detail : ''
    throw new ApiError(detail || `请求失败 (HTTP ${res.status})`, res.status)
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    }),
}

export const saveConfig = (config: AppConfig) =>
  api.post<{ ok: boolean; config: AppConfig }>('/api/config', { config })
export const verifySigning = (config: AppConfig) =>
  api.post<{ ok: boolean; message: string }>('/api/signing/verify', { config })
export const importSigningKeys = () => api.post<{ ok: boolean; imported: number; keys: SigningKey[] }>('/api/signing-keys/import')
export const getSigningKeys = () => api.get<{ ok: boolean; keys: SigningKey[] }>('/api/signing-keys')
export const saveSigningKey = (name: string, signing: AppConfig['signing'], id = '') =>
  api.post<{ ok: boolean; key: SigningKey }>('/api/signing-keys', { name, signing, id })
export const deleteSigningKey = (id: string) => request<{ ok: boolean }>(`/api/signing-keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const revealSigningKey = (id: string) =>
  api.post<{ ok: boolean; storePassword: string; keyPassword: string }>(`/api/signing-keys/${encodeURIComponent(id)}/reveal`)
export const getApps = () => api.get<AppsPayload>('/api/apps')
export const createApp = (name: string, projectType: ProjectType) =>
  api.post<AppsPayload>('/api/apps', { name, projectType })
export const activateApp = (id: string) => api.post<AppsPayload>('/api/apps/activate', { id })
export const deleteApp = (id: string) =>
  request<AppsPayload>(`/api/apps/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const getPermissions = () => api.get<{ ok: boolean; permissions: Permission[] }>('/api/permissions')
export const getLocalTools = (signal: AbortSignal) =>
  request<{ ok: boolean; tools: LocalTools }>('/api/local-tools', { signal, cache: 'no-store' })
export const getPackages = () => api.get<PackagesPayload>('/api/packages')
export const savePackages = (packages: { id: string; enabled: boolean }[]) =>
  api.post<PackagesPayload>('/api/packages', { packages })
// 同步的业务失败包含逐包结果，需要交给页面展示；HTTP 错误仍由 request 抛出。
export const syncPackages = () => request<PackageSyncPayload>('/api/packages/sync', { method: 'POST' }, true)
export const downloadPackageSyncLog = async () => {
  const res = await fetch('/api/packages/sync-log', { cache: 'no-store' })
  if (!res.ok) {
    const data = await res.json().catch(() => null)
    throw new ApiError(data?.detail || `日志下载失败 (HTTP ${res.status})`, res.status)
  }
  return res.blob()
}
/** 上传自定义依赖包：FormData 走 multipart，不能带 JSON Content-Type */
export const uploadPackage = (form: FormData) =>
  request<PackageUploadPayload>('/api/packages/upload', { method: 'POST', body: form })
export const deletePackage = (id: string) =>
  request<PackageDeletePayload>(`/api/packages/${encodeURIComponent(id)}`, { method: 'DELETE' })
export const getStatus = () => api.get<BuildStatus>('/api/status')
export const getPreflight = (config?: AppConfig) => config
  ? api.post<PreflightPayload>('/api/preflight', { config })
  : api.get<PreflightPayload>('/api/preflight')
export const getLogs = () => api.get<LogPayload>('/api/logs')
export const getDevices = () => api.get<DevicesPayload>('/api/devices')
export const adbRestart = () => api.post<DevicesPayload & AckPayload>('/api/adb/restart')
export const adbConnect = (hostPort: string) =>
  api.post<DevicesPayload & AckPayload>('/api/adb/connect', { hostPort })
export const startBuild = (platform: string, webType: string, action: WechatAction) =>
  api.post<AckPayload>('/api/build', { platform, webType, action })
export const cancelBuild = () => api.post<AckPayload>('/api/build/cancel')
export const openDir = (dir: string) => api.post<AckPayload>('/api/open-dir', { dir })
export const browse = (payload: { type: 'dir' | 'file'; title?: string; fileFilter?: string }) =>
  api.post<BrowsePayload>('/api/browse', payload)
export const getHistory = (limit = 20, platform = '') =>
  api.get<HistoryListPayload>(`/api/history?limit=${limit}&platform=${encodeURIComponent(platform)}`)
export const getHistoryDetail = (id: number) => api.get<HistoryDetailPayload>(`/api/history/${id}`)
export const getHistoryLog = (id: number) => api.get<HistoryLogPayload>(`/api/history/${id}/log`)
export const clearHistory = () => api.post<AckPayload>('/api/history/clear')
