import { useCallback, useEffect, useRef, useState } from 'react'
import { App } from 'antd'
import { cancelBuild, getLogs, getStatus, startBuild, getDevices } from '../api'
import { useConfig } from '../store/config'
import { applyStepEvents, skeleton, skeletonFor, type PipelineStep } from '../utils/pipeline'

export type LogClass = 'info' | 'ok' | 'warn' | 'err' | 'step' | 'cancel' | 'sys'
export interface LogLine {
  cls: LogClass
  text: string
}

export type BuildPhase = 'idle' | 'running' | 'ok' | 'fail' | 'cancelled'

const LOG_POLL_MS = 1500
const STATUS_POLL_MS = 5000

export function parseLog(text: string): LogLine[] {
  return text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => {
      if (l.includes('BUILD-CANCELLED')) return { cls: 'cancel' as const, text: l }
      if (l.includes('[OK]') || l.includes('SUCCESS') || l.includes('成功')) return { cls: 'ok' as const, text: l }
      if (l.includes('[WARN]') || l.includes('WARN') || l.includes('警告'))
        return { cls: 'warn' as const, text: l }
      if (l.includes('[ERR]') || l.includes('ERROR') || l.includes('失败') || l.includes('FAILED'))
        return { cls: 'err' as const, text: l }
      if (l.includes('====')) return { cls: 'step' as const, text: l }
      return { cls: 'info' as const, text: l }
    })
}

export function useBuild() {
  const { message } = App.useApp()
  const { save, config } = useConfig()

  const [running, setRunning] = useState(false)
  const [phase, setPhase] = useState<BuildPhase>('idle')
  const [lines, setLines] = useState<LogLine[]>([])
  const [steps, setSteps] = useState<PipelineStep[]>(() => skeletonFor(config?.build.platform))
  const [follow, setFollow] = useState(true)
  const [starting, setStarting] = useState(false)
  const [serverOk, setServerOk] = useState<boolean | null>(null)

  const logPollRef = useRef<number | null>(null)
  const statusPollRef = useRef<number | null>(null)
  // 防止"本页发起"与"服务端已在跑"两条路径重复判定结束
  const finishedRef = useRef(false)

  const stopLogPoll = useCallback(() => {
    if (logPollRef.current) {
      clearInterval(logPollRef.current)
      logPollRef.current = null
    }
  }, [])

  const settle = useCallback(
    (logText: string) => {
      finishedRef.current = true
      const tail = logText.slice(-4000)
      const cancelled = tail.includes('BUILD-CANCELLED')
      const ok = tail.includes('BUILD-OK') || tail.includes('全部完成')
      const err =
        /\bBUILD FAILED\b/.test(tail) ||
        ['Gradle 打包失败', '前端资源编译失败', 'Web 发行失败', 'WGT 制作失败', '发行失败'].some((s) => tail.includes(s))
      if (cancelled) {
        setPhase('cancelled')
        message.warning('构建已停止')
      } else if (ok && !err) {
        setPhase('ok')
        message.success('打包成功')
      } else {
        setPhase('fail')
        message.error('打包失败，请查看日志')
      }
      setRunning(false)
      stopLogPoll()
      // 构建结束顺手刷新设备（安装完成后的设备状态）
      getDevices().catch(() => {})
    },
    [message, stopLogPoll],
  )

  const poll = useCallback(async () => {
    let logText = ''
    let serverRunning = false
    try {
      const logRes = await getLogs()
      if (logRes.ok) logText = logRes.log
      setLines(parseLog(logText))
      setSteps(applyStepEvents(skeletonFor(config?.build.platform), logText))
    } catch {
      /* 单次轮询失败忽略 */
    }
    try {
      const st = await getStatus()
      serverRunning = st.running
      setServerOk(true)
    } catch {
      setServerOk(false)
    }
    if (finishedRef.current) return
    if (!serverRunning) {
      // 任务结束：也可能构建从未开始（如启动即失败）
      const st = await getStatus().catch(() => null)
      if (st && !st.running) {
        settle(logText || '')
      }
    }
  }, [settle, config])

  const startLogPoll = useCallback(() => {
    if (logPollRef.current) return
    const tick = () => {
      poll()
    }
    tick()
    logPollRef.current = window.setInterval(tick, LOG_POLL_MS)
  }, [poll])

  // 挂载即检查：若服务端正在构建（页面刷新中断后续跑），立即恢复轮询
  useEffect(() => {
    getStatus()
      .then((st) => {
        setServerOk(true)
        if (st.running) {
          finishedRef.current = false
          setRunning(true)
          setPhase('running')
          startLogPoll()
        }
      })
      .catch(() => setServerOk(false))
    statusPollRef.current = window.setInterval(() => {
      getStatus()
        .then((st) => {
          setServerOk(true)
          if (st.running) {
            finishedRef.current = false
            setRunning(true)
            setPhase('running')
            startLogPoll()
          }
        })
        .catch(() => setServerOk(false))
    }, STATUS_POLL_MS)
    return () => {
      stopLogPoll()
      if (statusPollRef.current) clearInterval(statusPollRef.current)
    }
  }, [startLogPoll, stopLogPoll])

  const start = useCallback(
    async (platform: 'apk' | 'web' | 'wgt', webType: 'pc' | 'h5'): Promise<boolean> => {
      // 打包前先保存配置（与旧版行为一致）
      const saved = await save()
      if (!saved.ok) {
        message.error(saved.error || '配置保存失败，请检查必填项')
        return false
      }
      setStarting(true)
      try {
        const res = await startBuild(platform, webType)
        finishedRef.current = false
        setLines([])
        setSteps(skeleton(platform))
        setFollow(true)
        setPhase('running')
        setRunning(true)
        startLogPoll()
        message.success(res.message || '打包任务已启动')
        return true
      } catch (e) {
        message.error(e instanceof Error ? e.message : '启动打包失败')
        return false
      } finally {
        setStarting(false)
      }
    },
    [save, message, startLogPoll],
  )

  const cancel = useCallback(async () => {
    try {
      const res = await cancelBuild()
      message.warning(res.message || '已发送停止信号')
    } catch (e) {
      message.warning(e instanceof Error ? e.message : '已无运行中的任务')
    }
  }, [message])

  const clearLog = useCallback(() => {
    setLines([])
    setFollow(true)
  }, [])

  return { running, phase, lines, steps, follow, setFollow, starting, start, cancel, clearLog, serverOk }
}