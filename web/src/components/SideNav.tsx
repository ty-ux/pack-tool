import { useState } from 'react'
import { App as AntApp, Button, Dropdown, Input, Layout, Menu, Modal, type MenuProps } from 'antd'
import {
  AppstoreOutlined,
  DeleteOutlined,
  DownOutlined,
  FolderOpenOutlined,
  HistoryOutlined,
  MobileOutlined,
  PhoneOutlined,
  PlusOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import type { BuildPhase } from '../hooks/useBuild'
import type { ProjectType } from '../types'
import { useConfig } from '../store/config'
import { PROJECT_TYPES, ProjectTypeField } from './ProjectTypeField'

interface Props {
  active: string
  onChange: (key: string) => void
  permCount: number
  buildPhase: BuildPhase
  serverText: string
  serverState: 'ok' | 'off' | 'checking' | 'running'
}

interface NavItem {
  key: string
  label: string
  icon: React.ReactNode
}

const CONFIG_ITEMS: NavItem[] = [
  { key: 'app', label: '应用信息', icon: <MobileOutlined /> },
  { key: 'perm', label: '权限配置', icon: <SafetyCertificateOutlined /> },
  { key: 'packages', label: '依赖包管理', icon: <AppstoreOutlined /> },
  { key: 'path', label: '路径配置', icon: <FolderOpenOutlined /> },
  { key: 'install', label: '安装配置', icon: <PhoneOutlined /> },
]

const BUILD_ITEMS: NavItem[] = [
  { key: 'build', label: '打包构建', icon: <RocketOutlined /> },
  { key: 'history', label: '构建历史', icon: <HistoryOutlined /> },
]

const NEW_APP_KEY = '__new__'

export function SideNav({ active, onChange, permCount, buildPhase, serverText, serverState }: Props) {
  const busy = buildPhase === 'running'
  const { message, modal } = AntApp.useApp()
  const { apps, activeId, config, switchApp, addApp, removeApp } = useConfig()
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ProjectType>('uniapp')
  const [creatingBusy, setCreatingBusy] = useState(false)

  const activeName = apps.find((a) => a.id === activeId)?.name ?? '未加载'

  const handleSwitch = async (id: string) => {
    const target = apps.find((a) => a.id === id)
    if (busy) {
      message.warning('构建进行中，等本次构建结束后再切换应用')
      return
    }
    const res = await switchApp(id)
    if (res.ok) message.success(`已切换到「${target?.name ?? '应用'}」`)
    else message.error(res.error || '切换应用失败')
  }

  const confirmDelete = (id: string, name: string) => {
    modal.confirm({
      title: `删除应用「${name}」？`,
      content: '该应用的配置会从本机删除，构建历史不受影响。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const res = await removeApp(id)
        if (res.ok) message.success(`已删除「${name}」`)
        else message.error(res.error || '删除失败')
      },
    })
  }

  const submitCreate = async () => {
    const name = newName.trim()
    if (!name) {
      message.warning('请填写应用名称')
      return
    }
    setCreatingBusy(true)
    const res = await addApp(name, newType)
    setCreatingBusy(false)
    if (res.ok) {
      setCreating(false)
      setNewName('')
      message.success(`已创建并切换到「${name}」`)
    } else {
      message.error(res.error || '新建应用失败')
    }
  }

  const appItems: MenuProps['items'] = [
    ...apps.map((a) => ({
      key: a.id,
      label: (
        <span className="app-option">
          <span className="app-option-text">
            <span className="app-option-name">{a.name}</span>
            <span className="app-option-sub">{a.packageName || PROJECT_TYPES[a.projectType]}</span>
          </span>
          {apps.length > 1 && (
            <Button
              type="text"
              size="small"
              className="app-option-del"
              icon={<DeleteOutlined />}
              aria-label={`删除应用 ${a.name}`}
              onClick={(e) => {
                e.stopPropagation()
                confirmDelete(a.id, a.name)
              }}
            />
          )}
        </span>
      ),
    })),
    { type: 'divider' as const },
    { key: NEW_APP_KEY, icon: <PlusOutlined />, label: '新建应用' },
  ]

  const renderLabel = (it: NavItem) => (
    <span className="nav-label">
      <span>{it.label}</span>
      {it.key === 'perm' && permCount > 0 && <span className="nav-badge">{permCount}</span>}
      {it.key === 'build' && busy && <span className="nav-live-dot" aria-label="构建进行中" />}
    </span>
  )

  const items: MenuProps['items'] = [
    {
      type: 'group',
      label: '配置',
      children: CONFIG_ITEMS
        .filter((it) => !config || config.projectType === 'uniapp' || it.key === 'app' || it.key === 'path')
        .map((it) => ({ key: it.key, icon: it.icon, label: renderLabel(it) })),
    },
    {
      type: 'group',
      label: '构建',
      children: BUILD_ITEMS.map((it) => ({ key: it.key, icon: it.icon, label: renderLabel(it) })),
    },
  ]

  return (
    <Layout.Sider width={224} theme="light" style={{ position: 'relative' }}>
      <div className="sider-brand">
        <div className="mark">
          <RocketOutlined style={{ fontSize: 16 }} />
        </div>
        <div>
          <div className="name">PackTool</div>
          <div className="sub">本地打包控制台</div>
        </div>
      </div>

      <div className="sider-app">
        <Dropdown
          trigger={['click']}
          placement="bottomLeft"
          menu={{
            items: appItems,
            selectedKeys: [activeId],
            onClick: ({ key }) => {
              if (key === NEW_APP_KEY) {
                setNewType(config?.projectType ?? 'uniapp')
                setCreating(true)
              }
              else if (key !== activeId) handleSwitch(key)
            },
          }}
        >
          <button type="button" className="app-switch" aria-label="切换应用">
            <span className="app-switch-copy">
              <span className="app-switch-label">当前应用</span>
              <span className="app-switch-name" title={activeName}>
                {activeName}
              </span>
            </span>
            <DownOutlined className="app-switch-arrow" />
          </button>
        </Dropdown>
      </div>

      <nav className="sider-nav" aria-label="主导航">
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[active]}
          items={items}
          onClick={({ key }) => onChange(key)}
          style={{ borderInlineEnd: 'none', background: 'transparent' }}
        />
      </nav>
      <div className="sider-foot" role="status" aria-live="polite">
        <span className={`status-dot ${serverState === 'running' ? 'running' : serverState}`} />
        <span>127.0.0.1:8765{serverState === 'ok' ? '' : ` · ${serverText}`}</span>
      </div>

      <Modal
        open={creating}
        title="新建应用"
        okText="创建"
        cancelText="取消"
        confirmLoading={creatingBusy}
        onOk={submitCreate}
        onCancel={() => setCreating(false)}
        afterClose={() => setNewName('')}
        destroyOnHidden
      >
        <label htmlFor="new-app-name" className="field-label">App 名称</label>
        <Input
          id="new-app-name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={(event) => {
            if (!event.nativeEvent.isComposing && !creatingBusy) submitCreate()
          }}
          placeholder="例如：示例应用"
          maxLength={40}
          autoFocus
          required
        />
        <ProjectTypeField value={newType} onChange={setNewType} />
      </Modal>
    </Layout.Sider>
  )
}
