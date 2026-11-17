import { useEffect, useState } from 'react'
import {
  App,
  Button,
  Card,
  Checkbox,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Table,
  Tag,
  Tooltip,
  Upload,
} from 'antd'
import { CheckCircleOutlined, InboxOutlined, PlusOutlined, SyncOutlined } from '@ant-design/icons'
import type { TableProps, UploadFile } from 'antd'
import {
  deletePackage,
  getPackages,
  savePackages,
  syncPackages,
  uploadPackage,
} from '../api'
import type { PackageItem, PackageSyncResult } from '../types'

const ACTION_META: Record<string, { color: string; text: string }> = {
  copy: { color: 'green', text: '已同步' },
  remove: { color: 'orange', text: '已移除' },
  skip: { color: 'default', text: '跳过' },
  error: { color: 'red', text: '失败' },
}

interface UploadFormValues {
  label: string
  desc?: string
}

export function PackagesPage() {
  const { message } = App.useApp()
  const [form] = Form.useForm<UploadFormValues>()
  const [items, setItems] = useState<PackageItem[]>([])
  const [syncResults, setSyncResults] = useState<PackageSyncResult[] | null>(null)
  const [syncing, setSyncing] = useState(false)
  // 添加弹窗状态
  const [modalOpen, setModalOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fileList, setFileList] = useState<UploadFile[]>([])

  useEffect(() => {
    getPackages()
      .then((res) => setItems(res.packages))
      .catch((e) => message.error(e instanceof Error ? e.message : '加载依赖包清单失败'))
  }, [message])

  const reload = async () => {
    const res = await getPackages()
    setItems(res.packages)
  }

  const toggle = (id: string, enabled: boolean) => {
    setItems((prev) => prev.map((p) => (p.id === id ? { ...p, enabled } : p)))
  }

  const setAll = (on: boolean) => {
    setItems((prev) => prev.map((p) => (p.required ? p : { ...p, enabled: on })))
  }

  const optCount = items.filter((p) => !p.required).length
  const enabledCount = items.filter((p) => p.enabled).length

  /** 保存勾选并执行一次同步对齐（APK 打包前也会自动执行同样的同步） */
  const handleSaveAndSync = async () => {
    setSyncing(true)
    try {
      const saved = await savePackages(items.map(({ id, enabled }) => ({ id, enabled })))
      if (!saved.ok) {
        message.error('保存失败')
        return
      }
      setItems(saved.packages)
      const res = await syncPackages()
      setSyncResults(res.results)
      if (res.summary.error > 0) {
        message.error(`同步完成，${res.summary.error} 个包失败，请查看下方结果`)
      } else {
        message.success(
          `已保存并同步：新增/更新 ${res.summary.copy}，移除 ${res.summary.remove}，跳过 ${res.summary.skip}`,
        )
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '保存失败')
    } finally {
      setSyncing(false)
    }
  }

  /** 提交自定义包：上传文件 + 名称/说明，成功后刷新清单并立即同步进 libs */
  const handleUploadSubmit = async () => {
    const values = await form.validateFields().catch(() => null)
    const file = fileList[0]?.originFileObj
    if (!values || !file) {
      message.warning('请先选择 .aar / .jar 文件')
      return
    }
    setSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('label', values.label)
      fd.append('desc', values.desc ?? '')
      const res = await uploadPackage(fd)
      message.success(`已添加自定义包「${res.package.label}」，正在同步到打包工程...`)
      setModalOpen(false)
      form.resetFields()
      setFileList([])
      await reload()
      const sync = await syncPackages()
      setSyncResults(sync.results)
      if (sync.summary.error > 0) {
        message.warning('已添加，但同步时有错误，请查看下方同步结果')
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '上传失败')
    } finally {
      setSubmitting(false)
    }
  }

  /** 删除自定义包（同时清理 packages/ 源文件与 libs 中的对应文件） */
  const handleDelete = async (id: string) => {
    try {
      const res = await deletePackage(id)
      message.success(`已删除「${res.deleted.label}」`)
      reload().catch(() => undefined)
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败')
    }
  }

  const columns: TableProps<PackageItem>['columns'] = [
    {
      title: '打包',
      dataIndex: 'enabled',
      width: 64,
      align: 'center',
      render: (_v, row) => {
        const box = (
          <Checkbox
            checked={row.enabled}
            disabled={row.required}
            onChange={(e) => toggle(row.id, e.target.checked)}
          />
        )
        return row.required ? <Tooltip title="基础依赖，打包必须包含，不可取消">{box}</Tooltip> : box
      },
    },
    {
      title: '名称',
      dataIndex: 'label',
      width: 180,
      render: (label: string, row) => (
        <span>
          {label}
          {row.custom && (
            <Tag style={{ marginLeft: 8 }}>自定义</Tag>
          )}
        </span>
      ),
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 70,
      render: (t: string) => <Tag>{t.toUpperCase()}</Tag>,
    },
    {
      title: '文件',
      dataIndex: 'file',
      ellipsis: true,
      width: 240,
      render: (f: string) => <span className="mono-cell">{f}</span>,
    },
    {
      title: '说明',
      dataIndex: 'desc',
      ellipsis: { showTitle: false },
      render: (d: string) => <Tooltip title={d}>{d}</Tooltip>,
    },
    {
      title: '必选',
      dataIndex: 'required',
      width: 70,
      align: 'center',
      render: (r: boolean) =>
        r ? <Tag>必选</Tag> : <span className="table-count">可选</span>,
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      align: 'center',
      render: (_v, row) =>
        row.custom ? (
          <Popconfirm
            title="删除该依赖包？"
            description="将同时删除 packages/ 源文件与 simpleDemo/libs 中的对应文件"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(row.id)}
          >
            <Button size="small" danger type="link">
              删除
            </Button>
          </Popconfirm>
        ) : null,
    },
  ]

  const resultColumns: TableProps<PackageSyncResult>['columns'] = [
    { title: '包', dataIndex: 'label', width: 150 },
    {
      title: '文件',
      dataIndex: 'file',
      ellipsis: true,
      render: (f: string) => <span className="mono-cell">{f}</span>,
    },
    {
      title: '动作',
      dataIndex: 'action',
      width: 90,
      render: (a: keyof typeof ACTION_META) => (
        <Tag color={ACTION_META[a]?.color ?? 'default'}>{ACTION_META[a]?.text ?? a}</Tag>
      ),
    },
    { title: '详情', dataIndex: 'message', ellipsis: true },
  ]

  return (
    <Card
      title="依赖清单"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setModalOpen(true)}>
          添加依赖包
        </Button>
      }
    >
      <p className="table-note">
        勾选要打进 APK 的依赖包（aar/jar，来自 packages/ 目录）。保存后会立即与打包工程
        simpleDemo/libs 对齐；APK 打包开始时也会自动执行同样的同步。
      </p>

      <div className="table-toolbar">
        <Button size="small" onClick={() => setAll(true)}>
          全选
        </Button>
        <Button size="small" onClick={() => setAll(false)}>
          全不选
        </Button>
        <span className="spacer" />
        <span className="table-count">
          勾选 {enabledCount} / {items.length}（可选 {optCount} 项）
        </span>
        <Button
          type="primary"
          icon={<SyncOutlined spin={syncing} />}
          loading={syncing}
          onClick={handleSaveAndSync}
        >
          保存并同步
        </Button>
      </div>

      <Table<PackageItem>
        rowKey="id"
        columns={columns}
        dataSource={items}
        pagination={false}
        size="middle"
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="packages/ 目录中没有可用的依赖包"
            />
          ),
        }}
      />

      {syncResults && (
        <>
          <div className="section-title">
            <CheckCircleOutlined style={{ color: 'var(--color-success)' }} />
            最近一次同步结果
          </div>
          <Table<PackageSyncResult>
            rowKey="id"
            size="small"
            pagination={false}
            columns={resultColumns}
            dataSource={syncResults}
            style={{ maxWidth: 900 }}
          />
        </>
      )}

      <Modal
        title="添加依赖包"
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false)
          form.resetFields()
          setFileList([])
        }}
        okText="上传并添加"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={handleUploadSubmit}
        width={520}
      >
        <p className="table-note" style={{ marginTop: 8 }}>
          上传自己的 aar / jar 文件并填写名称与说明，添加后将与内置包一样参与打包同步。
        </p>
        <Form form={form} layout="vertical" style={{ marginTop: 14 }}>
          <Form.Item label="依赖文件" required>
            <Upload.Dragger
              accept=".aar,.jar"
              maxCount={1}
              fileList={fileList}
              beforeUpload={() => false}
              onChange={({ fileList: next }) => setFileList(next.slice(-1))}
              onRemove={() => setFileList([])}
            >
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">点击或拖拽文件到此处</p>
              <p className="ant-upload-hint">仅支持 .aar / .jar 依赖文件</p>
            </Upload.Dragger>
          </Form.Item>
          <Form.Item
            name="label"
            label="名称"
            rules={[
              { required: true, message: '请输入依赖包名称' },
              { max: 50, message: '名称最长 50 个字符' },
            ]}
          >
            <Input placeholder="例如：百度地图 SDK" maxLength={50} />
          </Form.Item>
          <Form.Item name="desc" label="说明">
            <Input.TextArea
              placeholder="用途描述，例如：定位与地图显示组件（选填）"
              maxLength={200}
              rows={3}
              showCount
            />
          </Form.Item>
        </Form>
      </Modal>
    </Card>
  )
}
