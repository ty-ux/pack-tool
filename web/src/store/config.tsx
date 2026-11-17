import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AppConfig, AppProfile, AppsPayload, Permission } from '../types'
import {
  activateApp,
  createApp,
  deleteApp,
  getApps,
  getPermissions,
  saveConfig as apiSave,
} from '../api'

export interface ConfigStore {
  config: AppConfig | null
  permissions: Permission[]
  /** 应用档案列表（每个应用一套配置） */
  apps: AppProfile[]
  activeId: string
  dirty: boolean
  loading: boolean
  error: string | null
  setField: (path: string[], value: unknown) => void
  /** validate=false：切换/新建应用时保存当前配置，允许必填项暂时为空 */
  save: (opts?: { validate?: boolean }) => Promise<SaveResult>
  reload: () => Promise<void>
  switchApp: (id: string) => Promise<SaveResult>
  addApp: (name: string) => Promise<SaveResult>
  removeApp: (id: string) => Promise<SaveResult>
}

export interface SaveResult {
  ok: boolean
  error?: string
}

export const DEFAULT_CONFIG: AppConfig = {
  app: { name: '新应用', icon: '', appid: '', versionName: '1.0.0', versionCode: '1' },
  android: { packageName: '', permissions: [] },
  build: { buildType: 'debug', platform: 'apk', webType: 'h5' },
  web: { webTitle: '', webDomain: '', ssr: false },
  paths: {
    hbuilderxCli: '',
    projectDir: '',
    integrateDir: '',
    javaHome: '',
    adb: '',
    outputDir: '',
    webOutputDir: '',
  },
  install: { enabled: false, serial: '', launch: true },
}

function deepMerge<T>(base: T, override: Partial<T>): T {
  if (
    typeof base === 'object' && base !== null && !Array.isArray(base) &&
    typeof override === 'object' && override !== null && !Array.isArray(override)
  ) {
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const k of Object.keys(override as Record<string, unknown>)) {
      const bv = (base as Record<string, unknown>)[k]
      const ov = (override as Record<string, unknown>)[k]
      // 数组按整体替换（同后端 deep_merge 语义）
      if (bv !== undefined && typeof bv === 'object' && bv !== null && !Array.isArray(bv)
        && typeof ov === 'object' && ov !== null && !Array.isArray(ov)) {
        out[k] = deepMerge(bv, ov as Partial<typeof bv>)
      } else if (ov !== undefined) {
        out[k] = ov
      }
    }
    return out as T
  }
  return (override ?? base) as T
}

function setPath(obj: unknown, path: string[], value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path
  const next: Record<string, unknown> =
    obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? { ...obj } : {}
  next[head] = path.length === 1 ? value : setPath(next[head], rest, value)
  return next
}

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback
}

const Ctx = createContext<ConfigStore | null>(null)

export function ConfigStoreProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [permissions, setPermissions] = useState<Permission[]>([])
  const [apps, setApps] = useState<AppProfile[]>([])
  const [activeId, setActiveId] = useState('')
  const [dirty, setDirty] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /** 应用接口统一返回「当前应用 + 完整配置 + 列表」，切换后整体替换 */
  const applyPayload = useCallback((res: AppsPayload) => {
    setApps(res.apps)
    setActiveId(res.active)
    setConfig(deepMerge(DEFAULT_CONFIG, res.config))
    setDirty(false)
    setError(null)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [res, perms] = await Promise.all([getApps(), getPermissions()])
      applyPayload(res)
      setPermissions(perms.permissions)
    } catch (e) {
      setError(errMsg(e, '无法连接本地服务'))
      throw e
    } finally {
      setLoading(false)
    }
  }, [applyPayload])

  useEffect(() => {
    reload().catch(() => {
      /* 错误已写入 error，界面据此给出重试入口 */
    })
  }, [reload])

  const setField = useCallback((path: string[], value: unknown) => {
    setConfig((prev) => {
      if (!prev) return prev
      return setPath(prev, path, value) as AppConfig
    })
    setDirty(true)
  }, [])

  const save = useCallback(async (opts?: { validate?: boolean }): Promise<SaveResult> => {
    if (!config) return { ok: false, error: '配置尚未加载' }
    if (opts?.validate !== false) {
      const missing = validateRequired(config)
      if (missing) return { ok: false, error: `请填写: ${missing}` }
    }
    try {
      const res = await apiSave(config)
      setConfig(deepMerge(DEFAULT_CONFIG, res.config))
      setError(null)
      setDirty(false)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errMsg(e, '保存失败') }
    }
  }, [config])

  /** 切换前先落盘当前应用，保证切回去时配置不丢 */
  const switchApp = useCallback(async (id: string): Promise<SaveResult> => {
    if (id === activeId) return { ok: true }
    if (dirty) {
      const saved = await save({ validate: false })
      if (!saved.ok) return saved
    }
    try {
      applyPayload(await activateApp(id))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errMsg(e, '切换应用失败') }
    }
  }, [activeId, dirty, save, applyPayload])

  const addApp = useCallback(async (name: string): Promise<SaveResult> => {
    if (dirty) {
      const saved = await save({ validate: false })
      if (!saved.ok) return saved
    }
    try {
      applyPayload(await createApp(name))
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errMsg(e, '新建应用失败') }
    }
  }, [dirty, save, applyPayload])

  const removeApp = useCallback(async (id: string): Promise<SaveResult> => {
    try {
      const res = await deleteApp(id)
      setApps(res.apps)
      if (id === activeId) {
        setActiveId(res.active)
        setConfig(deepMerge(DEFAULT_CONFIG, res.config))
        setDirty(false)
      }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: errMsg(e, '删除应用失败') }
    }
  }, [activeId])

  const value: ConfigStore = {
    config, permissions, apps, activeId, dirty, loading, error,
    setField, save, reload, switchApp, addApp, removeApp,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useConfig(): ConfigStore {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useConfig 必须在 ConfigStoreProvider 内使用')
  return ctx
}

/** 必填校验：web 目标不需要包名/离线工程目录（与旧版行为一致） */
export function validateRequired(config: AppConfig): string | null {
  const required: Array<[string, string]> = [
    [config.app.name, 'App 名称'],
    [config.app.appid, 'AppID'],
    [config.paths.hbuilderxCli, 'HBuilderX CLI'],
    [config.paths.projectDir, 'uni-app 项目目录'],
  ]
  if (config.build.platform === 'apk') {
    required.push([config.android.packageName, '包名'], [config.paths.integrateDir, '离线打包工程目录'])
  }
  for (const [value, label] of required) {
    if (!String(value ?? '').trim()) return label
  }
  return null
}
