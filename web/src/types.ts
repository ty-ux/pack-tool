/** 与后端 DEFAULT_CONFIG 结构一一对应 */
export interface AppConfig {
  app: {
    name: string
    icon: string
    appid: string
    versionName: string
    versionCode: string
  }
  android: {
    packageName: string
    permissions: string[]
  }
  signing: {
    keystorePath: string
    keyAlias: string
    storePasswordEnv: string
    keyPasswordEnv: string
  }
  build: {
    buildType: 'debug' | 'release'
    platform: 'apk' | 'web' | 'wgt'
    webType: 'pc' | 'h5'
  }
  web: {
    webTitle: string
    webDomain: string
    ssr: boolean
  }
  paths: {
    hbuilderxCli: string
    projectDir: string
    integrateDir: string
    javaHome: string
    adb: string
    outputDir: string
    webOutputDir: string
  }
  install: {
    enabled: boolean
    serial: string
    launch: boolean
  }
}

/** 应用档案：每个应用一套打包配置，切换时互不影响 */
export interface AppProfile {
  id: string
  name: string
  appid: string
  packageName: string
  updatedAt: string
}

export interface AppsPayload {
  ok: boolean
  active: string
  apps: AppProfile[]
  config: AppConfig
}

export type PermissionLevel = 'special' | 'sensitive' | 'deprecated' | 'blocked' | 'scoped'

export interface Permission {
  key: string
  label: string
  desc: string
  level?: PermissionLevel
  note?: string
}

/** 可管理依赖包（与后端 packages.py 对应，custom 标记为页面上传的自定义包） */
export interface PackageItem {
  id: string
  file: string
  type: 'aar' | 'jar'
  label: string
  desc: string
  required: boolean
  enabled: boolean
  custom?: boolean
}

export interface PackagesPayload {
  ok: boolean
  packages: PackageItem[]
}

export type PackageUploadPayload = { ok: boolean; package: PackageItem }
export type PackageDeletePayload = { ok: boolean; deleted: { id: string; file: string; label: string } }

export type PackageSyncAction = 'copy' | 'remove' | 'skip' | 'error'

export interface PackageSyncResult {
  id: string
  label: string
  file: string
  type: 'aar' | 'jar'
  action: PackageSyncAction
  message: string
}

export interface PackageSyncSummary {
  copy: number
  remove: number
  skip: number
  error: number
}

export interface PackageSyncPayload {
  ok: boolean
  results: PackageSyncResult[]
  summary: PackageSyncSummary
}

export interface BuildStatus {
  ok: boolean
  running: boolean
  cancelRequested: boolean
}

export interface LogPayload {
  ok: boolean
  log: string
}

export interface DevicesPayload {
  ok: boolean
  devices: string[]
}

export type AckPayload = { ok: boolean; message?: string; error?: string }

export type PreflightStatus = 'ok' | 'warn' | 'error'

export interface PreflightCheck {
  id: string
  group: string
  label: string
  status: PreflightStatus
  detail: string
}

export interface PreflightPayload {
  ok: boolean
  checks: PreflightCheck[]
  summary: { ok: number; warn: number; error: number }
}

export type BrowsePayload =
  | { ok: true; path: string }
  | { ok: false; cancelled?: boolean; path?: string; error?: string }

/** 打包目标（platform + webType 组合） */
export type BuildTarget = 'apk' | 'web-pc' | 'web-h5' | 'wgt'

/** 构建历史记录 */
export interface BuildRecord {
  id: number
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  platform: 'apk' | 'web' | 'wgt'
  web_type: 'pc' | 'h5'
  build_type: 'debug' | 'release'
  target_desc: string
  status: 'running' | 'ok' | 'fail' | 'cancelled'
  artifact_path: string
  log_path: string
  config_snapshot?: AppConfig | null
}

export interface HistoryListPayload {
  ok: boolean
  builds: BuildRecord[]
}

export interface HistoryDetailPayload {
  ok: boolean
  build: BuildRecord
}

export interface HistoryLogPayload {
  ok: boolean
  log: string
}
