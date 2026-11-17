import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from 'antd'
import { adbConnect, adbRestart, getDevices } from '../api'

export function useDevices() {
  const [devices, setDevices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [hint, setHint] = useState('')
  const { message } = App.useApp()
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const applyDevices = useCallback((list: string[], note: string) => {
    if (!mountedRef.current) return
    setDevices(list)
    if (list.length) {
      setHint(`发现 ${list.length} 个设备`)
    } else {
      setHint(note || '未发现设备，可尝试"重启 adb"或"手动连接"')
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getDevices()
      applyDevices(res.devices, '')
    } catch (e) {
      if (mountedRef.current) setHint('刷新失败，无法连接服务')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [applyDevices])

  const connect = useCallback(
    async (hostPort: string) => {
      try {
        const res = await adbConnect(hostPort)
        applyDevices(res.devices, '')
        message.success(res.message || '连接成功')
        return true
      } catch (e) {
        message.error(e instanceof Error ? e.message : '连接失败')
        return false
      }
    },
    [applyDevices, message],
  )

  const restart = useCallback(async () => {
    try {
      const res = await adbRestart()
      applyDevices(res.devices ?? [], '')
      message.success(res.message || 'adb 已重启')
      return true
    } catch (e) {
      message.error(e instanceof Error ? e.message : '重启 adb 失败')
      return false
    }
  }, [applyDevices, message])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { devices, loading, hint, refresh, connect, restart }
}