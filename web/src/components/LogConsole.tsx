import { useEffect, useRef } from 'react'
import { App, Button } from 'antd'
import { CodeOutlined, CopyOutlined, SyncOutlined } from '@ant-design/icons'
import type { BuildPhase, LogLine } from '../hooks/useBuild'

interface Props {
  lines: LogLine[]
  follow: boolean
  onFollowChange: (v: boolean) => void
  running: boolean
  phase: BuildPhase
  emptyText?: string
  emptyDesc?: string
}

const NEAR_BOTTOM_PX = 40

export function LogConsole({
  lines,
  follow,
  onFollowChange,
  running,
  phase,
  emptyText = '等待打包',
  emptyDesc = '点击「一键打包」后，这里会实时输出编译与 Gradle 日志。',
}: Props) {
  const { message } = App.useApp()
  const bodyRef = useRef<HTMLDivElement>(null)

  // 新日志到达时自动滚底（用户上滚时暂停）
  useEffect(() => {
    const el = bodyRef.current
    if (el && follow) {
      el.scrollTop = el.scrollHeight
    }
  }, [lines, follow])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX
    if (nearBottom !== follow) onFollowChange(nearBottom)
  }

  const copyAll = async () => {
    const text = lines.map((l) => l.text).join('\n')
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      message.success('日志已复制')
    } catch {
      message.error('复制失败')
    }
  }

  const dotClass = phase === 'ok' ? 'ok' : phase === 'fail' ? 'err' : running ? 'on' : ''

  return (
    <div className="terminal">
      <div className="terminal-head">
        <span className={`run-dot ${dotClass}`} />
        构建日志
        {running && <span className="live-note">实时输出中</span>}
        <span className="spacer">
          {lines.length > 0 && (
            <Button
              size="small"
              type="text"
              icon={<CopyOutlined />}
              onClick={copyAll}
              className="head-btn"
            >
              复制
            </Button>
          )}
        </span>
      </div>
      <div
        className="terminal-body"
        ref={bodyRef}
        onScroll={handleScroll}
        role="log"
        aria-label="构建日志"
      >
        {lines.length === 0 ? (
          <div className="terminal-empty">
            {running ? (
              <>
                <SyncOutlined spin className="empty-icon" />
                <div className="empty-title">正在启动打包</div>
                <div className="empty-desc">构建日志很快会出现在这里。</div>
              </>
            ) : (
              <>
                <CodeOutlined className="empty-icon" />
                <div className="empty-title">{emptyText}</div>
                <div className="empty-desc">{emptyDesc}</div>
              </>
            )}
          </div>
        ) : (
          lines.map((l, i) => (
            <div key={i} className={`t-line ${l.cls}`}>
              {l.text}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
