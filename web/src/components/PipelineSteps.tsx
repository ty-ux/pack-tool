import { Steps } from 'antd'
import type { PipelineStep } from '../utils/pipeline'

const MAP: Record<PipelineStep['state'], 'wait' | 'process' | 'finish' | 'error'> = {
  wait: 'wait',
  running: 'process',
  ok: 'finish',
  fail: 'error',
}

/** 构建流水线：步骤状态实时映射 antd Steps（各步独立状态，窄屏自动转垂直） */
export function PipelineSteps({ steps }: { steps: PipelineStep[] }) {
  return (
    <Steps
      size="small"
      current={steps.findIndex((s) => s.state === 'wait' || s.state === 'running')}
      items={steps.map((s) => ({ title: s.name, status: MAP[s.state] }))}
    />
  )
}