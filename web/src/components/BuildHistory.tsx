import { useCallback, useEffect, useState } from 'react'
import { App, Button, Card, Descriptions, Drawer, Segmented, Steps, Table, Tag, Typography } from 'antd'
import { DeleteOutlined, FolderOpenOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import { clearHistory, getHistory, getHistoryDetail, getHistoryLog, openDir } from '../api'
import { parseLog, type BuildPhase, type LogLine } from '../hooks/useBuild'
import { applyStepEvents, skeletonFor, type PipelineStep } from '../utils/pipeline'
import type { BuildRecord } from '../types'
import { LogConsole } from './LogConsole'

const STATUS_TAG: Record<BuildRecord['status'], { color: string; label: string }> = {
  ok: { color: 'success', label: '成功' },
  fail: { color: 'error', label: '失败' },
  cancelled: { color: 'warning', label: '已停止' },
  running: { color: 'processing', label: '进行中' },
}

type Filter = 'all' | BuildRecord['platform']

function fmtDuration(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}m${s % 60}s`
}

function targetLabel(r: BuildRecord): string {
  if (r.platform === 'web') return r.web_type === 'pc' ? '网站-PC Web' : '手机H5'
  if (r.platform === 'wgt') return 'WGT 热更新包'
  return r.target_desc || `${r.platform.toUpperCase()} (${r.build_type})`
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  return iso
}

const COLUMNS: ColumnsType<BuildRecord> = [
  { title: '#', dataIndex: 'id', width: 60, render: (v) => <span className="table-count">#{v}</span> },
  {
    title: '开始时间',
    dataIndex: 'started_at',
    width: 172,
    render: (v: string | null) => <span className="nowrap">{fmtTime(v)}</span>,
  },
  {
    title: '目标',
    dataIndex: 'target_desc',
    width: 140,
    render: (_, r) => <Tag>{targetLabel(r)}</Tag>,
  },
  {
    title: '结果',
    dataIndex: 'status',
    width: 100,
    render: (st: BuildRecord['status']) => {
      const t = STATUS_TAG[st]
      return <Tag color={t.color}>{t.label}</Tag>
    },
  },
  { title: '耗时', dataIndex: 'duration_ms', width: 90, render: fmtDuration },
  {
    title: '产物',
    dataIndex: 'artifact_path',
    ellipsis: true,
    render: (v: string) => (v ? <span className="mono-cell">{v}</span> : '—'),
  },
]

interface Props {
  buildPhase: BuildPhase
  onGoBuild: () => void
}

export function BuildHistory({ buildPhase, onGoBuild }: Props) {
  const { message } = App.useApp()
  const [records, setRecords] = useState<BuildRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [detail, setDetail] = useState<BuildRecord | null>(null)
  const [detailLines, setDetailLines] = useState<LogLine[]>([])
  const [detailSteps, setDetailSteps] = useState<PipelineStep[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await getHistory(50, filter === 'all' ? '' : filter)
      setRecords(res.builds)
    } catch {
      /* 服务不可达时静默 */
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    load()
  }, [load])

  // 构建开始/结束时刷新列表
  useEffect(() => {
    if (buildPhase !== 'idle') load()
  }, [buildPhase, load])

  const openDetail = async (r: BuildRecord) => {
    setDetail(r)
    setDetailLoading(true)
    try {
      const [d, logRes] = await Promise.all([getHistoryDetail(r.id), getHistoryLog(r.id)])
      setDetail(d.build)
      const base = skeletonFor(d.build.platform, d.build.config_snapshot?.projectType)
      setDetailSteps(applyStepEvents(base, logRes.log))
      setDetailLines(parseLog(logRes.log))
    } catch {
      message.error('加载历史详情失败')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleClear = async () => {
    if (records.length === 0) return
    try {
      const res = await clearHistory()
      message.success(res.message || '已清空')
      setRecords([])
      setDetail(null)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '清空失败')
    }
  }

  const openArtifact = () => {
    if (!detail?.artifact_path) return
    openDir(detail.artifact_path).catch((e) => message.error(e instanceof Error ? e.message : '打开失败'))
  }

  const emptyText = (
    <div className="empty-state">
      {filter === 'all' ? (
        <>
          <div className="empty-title">还没有构建记录</div>
          <div className="empty-desc">
            每次打包的配置、日志与产物都会归档在这里，方便回溯失败原因。
          </div>
          <Button type="primary" onClick={onGoBuild}>
            前往打包构建
          </Button>
        </>
      ) : (
        <>
          <div className="empty-title">该类型下暂无记录</div>
          <div className="empty-desc">切换筛选条件看看其他构建目标的历史。</div>
          <Button onClick={() => setFilter('all')}>查看全部记录</Button>
        </>
      )}
    </div>
  )

  return (
    <Card title="构建记录">
      <div className="table-toolbar">
        <Segmented
          size="small"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          options={[
            { label: '全部', value: 'all' },
            { label: 'APK', value: 'apk' },
            { label: 'AAB', value: 'aab' },
            { label: 'Web', value: 'web' },
            { label: 'WGT', value: 'wgt' },
          ]}
        />
        <span className="spacer" />
        <span className="table-count">共 {records.length} 条</span>
        <Button size="small" icon={<ReloadOutlined />} onClick={load}>
          刷新
        </Button>
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          disabled={records.length === 0}
          onClick={handleClear}
        >
          清空历史
        </Button>
      </div>

      <Table<BuildRecord>
        size="small"
        rowKey="id"
        columns={COLUMNS}
        dataSource={records}
        loading={loading}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        onRow={(r) => ({
          onClick: () => openDetail(r),
          style: { cursor: 'pointer' },
        })}
        locale={{ emptyText: loading ? ' ' : emptyText }}
      />

      <Drawer
        title={detail ? `构建记录 #${detail.id}` : ''}
        open={detail != null}
        onClose={() => setDetail(null)}
        width={720}
        loading={detailLoading}
        extra={
          detail?.artifact_path ? (
            <Button icon={<FolderOpenOutlined />} onClick={openArtifact}>
              打开产物位置
            </Button>
          ) : undefined
        }
      >
        {detail && (
          <>
            <Descriptions column={2} size="small" bordered style={{ marginBottom: 16 }}>
              <Descriptions.Item label="状态">
                <Tag color={STATUS_TAG[detail.status].color}>{STATUS_TAG[detail.status].label}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="目标">{targetLabel(detail)}</Descriptions.Item>
              <Descriptions.Item label="开始">{fmtTime(detail.started_at)}</Descriptions.Item>
              <Descriptions.Item label="完成">{fmtTime(detail.finished_at)}</Descriptions.Item>
              <Descriptions.Item label="耗时">{fmtDuration(detail.duration_ms)}</Descriptions.Item>
              <Descriptions.Item label="产物">
                {detail.artifact_path ? (
                  <span className="mono-cell">{detail.artifact_path}</span>
                ) : (
                  '—'
                )}
              </Descriptions.Item>
            </Descriptions>

            <div className="section-title">流水线</div>
            <div className="panel-box" style={{ marginBottom: 20 }}>
              {detailSteps.length > 0 ? (
                <div style={{ maxWidth: 640 }}>
                  <StepsInline steps={detailSteps} />
                </div>
              ) : (
                <Typography.Text type="secondary">该记录无步骤事件（旧版本构建日志）</Typography.Text>
              )}
            </div>

            <div className="section-title">构建配置快照</div>
            <pre className="code-block">{JSON.stringify(detail.config_snapshot, null, 2)}</pre>

            <div className="section-title">归档日志</div>
            <LogConsole
              lines={detailLines}
              follow={false}
              onFollowChange={() => {}}
              running={false}
              phase="idle"
              emptyText="无归档日志"
            />
          </>
        )}
      </Drawer>
    </Card>
  )
}

/** 轻量 Steps（历史详情内使用） */
function StepsInline({ steps }: { steps: PipelineStep[] }) {
  const map = { wait: 'wait', running: 'process', ok: 'finish', fail: 'error' } as const
  return (
    <Steps
      size="small"
      labelPlacement="vertical"
      items={steps.map((s) => ({ title: s.name, status: map[s.state] }))}
    />
  )
}
