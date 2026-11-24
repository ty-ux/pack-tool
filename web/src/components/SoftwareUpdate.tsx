import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Descriptions, Spin } from 'antd'
import { CloudDownloadOutlined, ReloadOutlined } from '@ant-design/icons'
import { useConfig } from '../store/config'

interface UpdateState {
  currentVersion: string
  supported: boolean
  phase: 'idle' | 'checking' | 'available' | 'latest' | 'downloading' | 'preparing' | 'ready' | 'installing' | 'error'
  received: number
  total: number
  error: string
  release?: { version: string; notes: string; size: number }
  lastResult?: { ok: boolean; message: string; backup: string }
}

interface UpdateBridge {
  state: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  download: () => Promise<UpdateState>
  cancel: () => Promise<UpdateState>
  install: () => Promise<UpdateState>
}

declare global { interface Window { packToolUpdate?: UpdateBridge } }

const labels: Record<UpdateState['phase'], string> = {
  idle: '从 GitHub 正式发布中检查新版本。', checking: '正在检查新版本…',
  available: '发现新版本，可先下载，稍后安装。', latest: '当前已是最新正式版本。',
  downloading: '正在下载更新包…', preparing: '正在校验并解压更新包…',
  ready: '更新已准备好，重启即可安装。', installing: '正在退出并安装更新，完成后会自动重启…',
  error: '更新未完成，可以重试。',
}
const mib = (bytes: number) => (bytes / 1024 / 1024).toFixed(1) + ' MiB'

export function SoftwareUpdate({ building }: { building: boolean }) {
  const { message } = App.useApp()
  const { save } = useConfig()
  const bridge = window.packToolUpdate
  const [state, setState] = useState<UpdateState | null>(null)
  const [pending, setPending] = useState(false)
  const [bridgeError, setBridgeError] = useState('')
  useEffect(() => {
    if (!bridge) return
    let stopped = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { const next = await bridge.state(); if (!stopped) { setState(next); setBridgeError('') } }
      catch { if (!stopped) setBridgeError('无法读取更新状态，请重新打开此页面或重启软件') }
      if (!stopped) timer = setTimeout(() => { void poll() }, 750)
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [bridge])
  const invoke = async (action: 'check' | 'download' | 'cancel' | 'install') => {
    if (!bridge) return
    setPending(true)
    try {
      if (action === 'install') {
        const saved = await save({ validate: false })
        if (!saved.ok) throw new Error(saved.error || '保存当前配置失败，尚未开始更新')
      }
      setState(await bridge[action]())
    } catch (error) { message.error(error instanceof Error ? error.message : '更新操作失败') }
    finally { setPending(false) }
  }
  const active = !!state && ['checking', 'downloading', 'preparing', 'installing'].includes(state.phase)
  return <Card title="软件更新">
    {!bridge ? <p className="hint">Windows 桌面版支持在软件内检查、下载和安装更新。源码运行时请通过 Git 更新。</p>
      : !state ? <Spin size="small" /> : <>
        <Descriptions column={1} size="small">
          <Descriptions.Item label="当前版本">{state.currentVersion}</Descriptions.Item>
          {state.release && <Descriptions.Item label="可用版本">{state.release.version} · {mib(state.release.size)}</Descriptions.Item>}
        </Descriptions>
        <p role="status">{labels[state.phase]}</p>
        {state.phase === 'downloading' && <div className="update-progress">
          <progress aria-label="更新包下载进度" max={state.total} value={state.received} />
          <span className="hint">{mib(state.received)} / {mib(state.total)}</span>
        </div>}
        {state.error && <Alert type="error" showIcon message={state.error} />}
        {state.lastResult && <Alert type={state.lastResult.ok ? 'success' : 'warning'} showIcon
          message={state.lastResult.ok ? '上次更新已完成' : '上次更新未完成，请查看更新日志'}
          description={<>{state.lastResult.message}{state.lastResult.backup && <div className="data-path">旧程序保留位置：{state.lastResult.backup}</div>}</>} />}
        <div className="data-actions">
          <Button icon={<ReloadOutlined />} loading={state.phase === 'checking'}
            disabled={!state.supported || pending || active || state.phase === 'ready'}
            onClick={() => { void invoke('check') }}>检查更新</Button>
          {state.release && state.phase !== 'ready' && state.phase !== 'installing' && <Button type="primary"
            icon={<CloudDownloadOutlined />} loading={state.phase === 'downloading' || state.phase === 'preparing'}
            disabled={pending || active} onClick={() => { void invoke('download') }}>下载更新</Button>}
          {state.phase === 'downloading' && <Button onClick={() => { void invoke('cancel') }}>取消下载</Button>}
          {state.phase === 'ready' && <Button type="primary" disabled={building || pending} loading={pending}
            onClick={() => { void invoke('install') }}>保存配置并重启更新</Button>}
        </div>
        {state.release?.notes && <details className="update-notes"><summary>版本说明</summary><pre>{state.release.notes}</pre></details>}
        <p className="hint">下载和校验完成后，由你选择重启安装。构建期间无法安装更新；替换失败会保留旧程序。配置、依赖、历史和日志保存在独立数据目录，升级前仍会自动备份。更新日志也会包含在诊断导出中。</p>
        {!state.supported && <p className="hint">当前运行方式不支持安装更新，请使用 Windows x64 正式桌面版。</p>}
      </>}
    {bridgeError && <Alert type="error" message={bridgeError} />}
  </Card>
}
