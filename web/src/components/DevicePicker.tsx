import { useState } from 'react'
import { App, Button, Input, Select } from 'antd'
import { LinkOutlined, SyncOutlined } from '@ant-design/icons'
import { useDevices } from '../hooks/useDevices'

interface Props {
  value: string
  onChange: (value: string) => void
}

export function DevicePicker({ value, onChange }: Props) {
  const { devices, loading, hint, refresh, connect, restart } = useDevices()
  const { message } = App.useApp()
  const [hostPort, setHostPort] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [restarting, setRestarting] = useState(false)

  const handleConnect = async () => {
    const target = hostPort.trim()
    if (!target) {
      message.info('请先填写 ip:port（如 127.0.0.1:16384）')
      return
    }
    setConnecting(true)
    try {
      const okFlag = await connect(target)
      if (okFlag) setHostPort('')
    } finally {
      setConnecting(false)
    }
  }

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await restart()
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div>
      <div className="device-row">
        <Select
          value={value || undefined}
          placeholder={loading ? '正在读取设备列表' : '选择已连接设备'}
          onChange={onChange}
          options={devices.map((d) => ({ value: d, label: d }))}
          allowClear
          style={{ flex: 1, minWidth: 0 }}
          loading={loading}
        />
        <Button icon={<SyncOutlined spin={loading} />} onClick={refresh}>
          刷新
        </Button>
      </div>
      <div className="device-row">
        <Input
          value={hostPort}
          onChange={(e) => setHostPort(e.target.value)}
          placeholder="无线调试 ip:port"
          onPressEnter={handleConnect}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Button icon={<LinkOutlined />} onClick={handleConnect} loading={connecting}>
          连接
        </Button>
      </div>
      <div className="device-actions">
        <Button size="small" type="text" loading={restarting} onClick={handleRestart}>
          重启 adb 服务
        </Button>
        <span className="device-hint">
          {hint || (devices.length > 0 ? `已发现 ${devices.length} 台设备` : '未发现设备')}
        </span>
      </div>
    </div>
  )
}
