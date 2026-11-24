import { useEffect, useState } from 'react'
import { Alert, App, Button, Card, Descriptions, Empty, Segmented, Skeleton, Table, Upload } from 'antd'
import { DownloadOutlined, UploadOutlined } from '@ant-design/icons'
import { api, downloadDiagnostics, reportClientEvent } from '../api'
import { useConfig } from '../store/config'
import { useAppearance, type ColorScheme } from '../store/appearance'
import { SoftwareUpdate } from '../components/SoftwareUpdate'

interface DataInfo { root: string; version: string; backups: { name: string; size: number }[] }
interface Preview { name: string; projectType: string; missingPaths: string[] }
interface LogInfo { directory: string; operationLog: string; maxFileMiB: number; retainedFiles: number }

function download(contents: string, name: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function DataManagementPage({ building }: { building: boolean }) {
  const { message } = App.useApp()
  const { save, reload } = useConfig()
  const { scheme, dark, setScheme } = useAppearance()
  const [info, setInfo] = useState<DataInfo | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [bundle, setBundle] = useState<Record<string, unknown> | null>(null)
  const [preview, setPreview] = useState<Preview[]>([])
  const [logInfo, setLogInfo] = useState<LogInfo | null>(null)
  const load = async () => {
    setError('')
    try { setInfo(await api.get<DataInfo>('/api/data/info')) }
    catch (e) { setError(e instanceof Error ? e.message : '读取数据目录失败') }
  }
  useEffect(() => { void load() }, [])
  useEffect(() => {
    api.get<LogInfo>('/api/diagnostics/info').then(setLogInfo)
      .catch((e) => message.error(e instanceof Error ? e.message : '读取日志位置失败'))
  }, [message])
  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key)
    try { await action() }
    catch (e) { message.error(e instanceof Error ? e.message : '操作失败') }
    finally { setBusy('') }
  }
  const saveDraft = async () => {
    const result = await save({ validate: false })
    if (!result.ok) throw new Error(result.error || '保存当前配置失败')
  }
  return <>
    <Card title="外观">
      <Segmented<ColorScheme> aria-label="颜色主题" value={scheme}
        options={[{ label: '明亮', value: 'light' }, { label: '黑暗', value: 'dark' }, { label: `跟随系统（当前${dark ? '黑暗' : '明亮'}）`, value: 'system' }]}
        disabled={!!busy} onChange={(value) => { void run('theme', () => setScheme(value)) }} />
      <p className="table-note">主题选择保存在本机，重新启动后继续使用。</p>
    </Card>
    <SoftwareUpdate building={building} />
    <Card title="全局操作日志">
      <p className="hint">自动记录各页面的后台请求、操作结果、耗时、构建任务和异常；页面切换与前端异常也会记录。失败请求会显示日志编号，方便定位同一次操作。</p>
      {logInfo && <Descriptions column={1} size="small">
        <Descriptions.Item label="日志文件"><span className="data-path">{logInfo.operationLog}</span></Descriptions.Item>
        <Descriptions.Item label="保留策略">单文件 {logInfo.maxFileMiB} MiB，最多保留 {logInfo.retainedFiles} 份，自动轮转</Descriptions.Item>
      </Descriptions>}
      <div className="data-actions">
        <Button icon={<DownloadOutlined />} loading={busy === 'logs'} disabled={!!busy} onClick={() => { void run('logs', async () => {
          const blob = await downloadDiagnostics()
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.href = url
          link.download = 'packtool-diagnostics.zip'
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }) }}>导出诊断日志</Button>
        <Button disabled={!!busy || !logInfo} onClick={() => { void run('open-logs', async () => {
          await api.post('/api/open-dir', { dir: logInfo!.directory })
        }) }}>打开日志目录</Button>
      </div>
      <p className="hint">导出包含全局日志、启动与更新日志、依赖同步日志及最近 10 次构建日志，每个文件最多取末尾 1 MiB，并附截断说明。不会打包配置、数据库或证书文件；日志仍可能包含本机路径和构建工具输出，提交 issue 前请检查。</p>
    </Card>
    <Card title="本机数据与升级保护">
      {error ? <Alert type="error" message={error} action={<Button onClick={() => { void load() }}>重试</Button>} />
        : !info ? <Skeleton active /> : <div className="data-summary">
          <Descriptions column={1} size="small">
            <Descriptions.Item label="当前版本">{info.version}</Descriptions.Item>
            <Descriptions.Item label="用户数据目录"><span className="data-path">{info.root}</span></Descriptions.Item>
            <Descriptions.Item label="升级备份">{info.backups.length ? `${info.backups.length} 份` : '暂无备份'}</Descriptions.Item>
          </Descriptions>
          <p className="hint">新版首次启动前会备份配置、依赖包、日志、历史和默认产物。备份失败时停止启动，保留原始数据。桌面版可使用上方的软件更新；手动替换程序时请先退出 PackTool。</p>
          <p className="hint">备份保存在数据目录的 backups 文件夹，不自动清理。恢复时先退出程序并另外备份当前数据，再从 ZIP 中还原需要的目录。本机备份可能包含敏感信息，不用于公开提交 issue。</p>
          <div className="data-actions">
            <Button disabled={!!busy || building} loading={busy === 'backup'} onClick={() => { void run('backup', async () => {
              await saveDraft()
              const result = await api.post<{ name: string }>('/api/data/backup')
              await load()
              message.success(`备份已保存：${result.name}`, 6)
            }) }}>立即备份本机数据</Button>
            <Button disabled={!info.root} onClick={() => { void run('open', async () => {
              await api.post('/api/open-dir', { dir: info.root })
            }) }}>打开数据目录</Button>
          </div>
          {info.backups.length > 0 && <p className="hint data-path">最近备份：{info.backups[0].name}</p>}
        </div>}
    </Card>
    <Card title="配置导出与换机导入">
      <p className="hint">导出全部应用配置及引用的签名设置。密码、本机加密凭据、证书文件、项目、图标、依赖包和历史日志不会放入配置文件；换机时请另行复制所需文件，并重新核对路径和填写密码。</p>
      <div className="data-actions">
        <Button icon={<DownloadOutlined />} disabled={!!busy || building} loading={busy === 'export'} onClick={() => { void run('export', async () => {
          await saveDraft()
          const result = await api.get<Record<string, unknown>>('/api/config/export')
          download(JSON.stringify(result, null, 2), 'packtool-config.json')
        }) }}>导出全部应用配置</Button>
        <Upload accept=".json,application/json" showUploadList={false} disabled={!!busy || building} beforeUpload={(file) => {
          setBundle(null)
          setPreview([])
          void run('preview', async () => {
            if (file.size > 2 * 1024 * 1024) throw new Error('配置文件不能超过 2 MiB')
            let parsed: Record<string, unknown>
            try { parsed = JSON.parse(await file.text()) }
            catch { reportClientEvent('validation', 'config-import'); throw new Error('无法读取 JSON 配置文件') }
            const result = await api.post<{ apps: Preview[] }>('/api/config/import/preview', { bundle: parsed })
            setBundle(parsed)
            setPreview(result.apps)
          })
          return false
        }}><Button icon={<UploadOutlined />} disabled={!!busy || building} loading={busy === 'preview'}>选择配置文件</Button></Upload>
      </div>
      {bundle && <div className="transfer-preview">
        <Alert type="info" showIcon message={`将新增 ${preview.length} 个应用，现有应用保持原样`} description="导入后从侧边栏选择新应用，检查路径配置，并重新选择或填写签名密码。当前应用不会自动切换。" />
        <Table<Preview> size="small" pagination={false} rowKey={(_, index) => String(index)} dataSource={preview}
          columns={[{ title: '应用', dataIndex: 'name' }, { title: '工程类型', dataIndex: 'projectType' },
            { title: '本机缺失的路径', dataIndex: 'missingPaths', render: (paths: string[]) => paths.join('、') || '未发现缺失路径' }]} />
        <div className="data-actions"><Button type="primary" loading={busy === 'import'} disabled={!!busy || building} onClick={() => { void run('import', async () => {
          await saveDraft()
          const result = await api.post<{ created: string[] }>('/api/config/import', { bundle })
          await reload()
          setBundle(null)
          setPreview([])
          message.success(`已新增 ${result.created.length} 个应用，请从侧边栏选择并核对路径`)
        }) }}>确认导入为新应用</Button><Button disabled={!!busy} onClick={() => { setBundle(null); setPreview([]) }}>取消</Button></div>
      </div>}
      {!bundle && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择导出的 JSON 文件后，可先预览再导入" />}
    </Card>
  </>
}
