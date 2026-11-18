/** 构建流水线：步骤骨架 + 日志 [STEP] 事件解析（单一真相源 = 日志） */
import type { ProjectType } from '../types'

export type StepState = 'wait' | 'running' | 'ok' | 'fail'

export interface PipelineStep {
  index: number
  key: string
  name: string
  state: StepState
}

const APK_SKELETON: PipelineStep[] = [
  { index: 1, key: 'compile', name: '前端资源编译', state: 'wait' },
  { index: 2, key: 'sync', name: '同步前端资源', state: 'wait' },
  { index: 3, key: 'manifest', name: '更新 App 配置', state: 'wait' },
  { index: 4, key: 'gradle', name: 'Gradle 打包', state: 'wait' },
]

const WEB_SKELETON: PipelineStep[] = [
  { index: 1, key: 'publish', name: 'Web 发行', state: 'wait' },
  { index: 2, key: 'copy', name: '复制产物', state: 'wait' },
]

const WGT_SKELETON: PipelineStep[] = [
  { index: 1, key: 'publish', name: '制作 WGT 包', state: 'wait' },
  { index: 2, key: 'copy', name: '复制产物', state: 'wait' },
]

const PROJECT_SKELETON: PipelineStep[] = [
  { index: 0, key: 'project', name: '构建项目', state: 'wait' },
  { index: 1, key: 'artifact', name: '收集产物', state: 'wait' },
]

const STEP_RE = /\[STEP\]\s+(\d+)\|([^|]+)\|([^|]+)\|(running|ok|fail)/

function skeleton(platform: 'apk' | 'web' | 'wgt'): PipelineStep[] {
  if (platform === 'apk') return APK_SKELETON.map((s) => ({ ...s }))
  if (platform === 'wgt') return WGT_SKELETON.map((s) => ({ ...s }))
  return WEB_SKELETON.map((s) => ({ ...s }))
}

/** 按字符串 platform（可能为空/旧值）取骨架，非法值回退到 web */
export function skeletonFor(platform?: string | null, projectType?: ProjectType): PipelineStep[] {
  if (platform === 'aab' || projectType === 'android' || projectType === 'flutter') {
    return PROJECT_SKELETON.map((s) => ({ ...s }))
  }
  if (platform === 'apk') return skeleton('apk')
  if (platform === 'wgt') return skeleton('wgt')
  return skeleton('web')
}

/** 把日志里的 [STEP] 事件应用到骨架，返回最新步骤状态（最后事件胜出） */
export function applyStepEvents(base: PipelineStep[], logText: string): PipelineStep[] {
  const byKey = new Map(base.map((s) => [s.key, { ...s }]))
  for (const line of logText.split(/\r?\n/)) {
    const m = line.match(STEP_RE)
    if (!m) continue
    const [, index, key, name, state] = m
    const existing = byKey.get(key)
    if (existing) {
      existing.state = state as StepState
      existing.name = name
    } else {
      byKey.set(key, { index: Number(index), key, name, state: state as StepState })
    }
  }
  return [...byKey.values()].sort((a, b) => a.index - b.index)
}
