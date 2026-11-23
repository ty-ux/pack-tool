import { useState } from 'react'
import { App as AntApp, Button, Drawer, Dropdown, Result, Skeleton } from 'antd'
import { ReloadOutlined, SaveOutlined, SyncOutlined } from '@ant-design/icons'
import { useConfig } from './store/config'
import { useBuild } from './hooks/useBuild'
import { SideNav } from './components/SideNav'
import { AppInfoPage } from './pages/AppInfo'
import { PermissionsPage } from './pages/Permissions'
import { PackagesPage } from './pages/PackagesPage'
import { PathsPage } from './pages/Paths'
import { InstallPage } from './pages/Install'
import { BuildPage } from './pages/Build'
import { BuildHistory } from './components/BuildHistory'
import { SigningKeysPage } from './pages/SigningKeys'
import { DataManagementPage } from './pages/DataManagement'
import { useAppearance, type ColorScheme } from './store/appearance'

interface PageMeta {
  title: string
  desc: string
}

const PAGES: Record<string, PageMeta> = {
  data: { title: '数据与外观', desc: '备份本机数据、导入导出应用配置，并选择适合你的颜色主题。' },
  keys: {
    title: '密钥管理',
    desc: '集中管理 Android 签名文件、别名和密码，供不同应用选择复用。',
  },
  app: {
    title: '应用信息',
    desc: '设置 App 名称、图标、版本与 Android 包名，这些字段会写入打包产物。',
  },
  perm: {
    title: '权限配置',
    desc: '只勾选实际用到的权限，减少安装授权打扰，也降低应用商店审核与合规风险。',
  },
  packages: {
    title: '依赖包管理',
    desc: '选择要打进 APK 的 aar / jar，并在构建前与离线工程 libs 目录保持一致。',
  },
  path: {
    title: '路径配置',
    desc: '选择项目目录，配置该工程所需的工具和产物位置。',
  },
  install: {
    title: '安装配置',
    desc: '构建完成后自动把 APK 安装到已连接的设备或模拟器。',
  },
  build: {
    title: '打包构建',
    desc: '选择打包目标，先检查环境与配置，再一键出包。',
  },
  history: {
    title: '构建历史',
    desc: '每次构建的配置、日志与产物都会归档，便于回溯失败原因。',
  },
}

export function AppRoot() {
  const { message } = AntApp.useApp()
  const { scheme, setScheme } = useAppearance()
  const { config, dirty, loading, error, save, reload } = useConfig()
  const build = useBuild()
  const [selectedTab, setTab] = useState('app')
  const [mobileNav, setMobileNav] = useState(false)
  const isUniApp = !config || config.projectType === 'uniapp'
  const tab = !isUniApp && ['perm', 'packages', 'install'].includes(selectedTab) ? 'app' : selectedTab
  const page = PAGES[tab] ?? PAGES.app
  const navigate = async (next: string) => {
    if (['keys', 'data'].includes(next) && dirty) {
      const result = await save({ validate: false })
      if (!result.ok) { message.error(result.error || '当前配置保存失败'); return }
    }
    setTab(next)
  }

  const handleSave = async () => {
    const res = await save()
    if (res.ok) {
      message.success('配置已保存')
    } else {
      message.error(res.error || '保存失败')
    }
  }

  const handleReload = async () => {
    try {
      await reload()
      message.success('配置已重新加载')
    } catch {
      message.error('无法连接服务，请确认服务已启动')
    }
  }

  const serverState = build.running
    ? 'running'
    : build.serverOk === false
      ? 'off'
      : build.serverOk === null
        ? 'checking'
        : 'ok'
  const serverText =
    serverState === 'running'
      ? '构建进行中'
      : serverState === 'off'
        ? '服务未连接'
        : serverState === 'checking'
          ? '正在连接'
          : '服务已连接'

  return (
    <>
      <a className="skip-link" href="#main-content">
        跳到主要内容
      </a>
      <div className="app-shell">
        <SideNav
          active={tab}
          onChange={(next) => { void navigate(next) }}
          permCount={config?.android.permissions.length ?? 0}
          buildPhase={build.phase}
          serverText={serverText}
          serverState={serverState}
        />
        <div className="app-main">
          <header className="app-header">
            <Button className="mobile-navigation" aria-label="打开导航" onClick={() => setMobileNav(true)}>导航</Button>
            <div>
              <h1 className="page-title">{page.title}</h1>
              <p className="page-desc">{tab === 'app' && !isUniApp ? '选择工程类型和应用显示名称。' : page.desc}</p>
            </div>
            <span className="spacer" />
            <Dropdown menu={{ selectedKeys: [scheme], items: [
              { key: 'system', label: '跟随系统' }, { key: 'light', label: '明亮模式' }, { key: 'dark', label: '黑暗模式' },
            ], onClick: ({ key }) => { void setScheme(key as ColorScheme).catch((error) => message.error(error instanceof Error ? error.message : '主题保存失败')) } }}>
              <Button className="appearance-button" aria-label="选择颜色主题">外观</Button>
            </Dropdown>
            <span className="header-status" role="status" aria-live="polite">
              {serverState === 'running' && <SyncOutlined spin />}
              {serverState !== 'running' && <span className={`status-dot ${serverState}`} />}
              {serverText}
            </span>
          </header>

          <main className="app-content" id="main-content">
            <div className="page">
              {!config ? (
                loading ? (
                  <div className="boot-card">
                    <Skeleton active paragraph={{ rows: 6 }} />
                  </div>
                ) : (
                  <div className="boot-card">
                    <Result
                      status="warning"
                      title="无法连接本地服务"
                      subTitle={error || '请确认服务已启动，默认地址为 http://127.0.0.1:8765/'}
                      extra={
                        <Button type="primary" onClick={handleReload} loading={loading}>
                          重新连接
                        </Button>
                      }
                    />
                  </div>
                )
              ) : (
                <>
                  {tab === 'app' && <AppInfoPage onManageKeys={() => { void navigate('keys') }} />}
                  {tab === 'keys' && <SigningKeysPage onGoApp={() => setTab('app')} />}
                  {tab === 'data' && <DataManagementPage building={build.running} />}
                  {tab === 'perm' && <PermissionsPage />}
                  {tab === 'packages' && <PackagesPage />}
                  {tab === 'path' && <PathsPage />}
                  {tab === 'install' && <InstallPage />}
                  {tab === 'build' && <BuildPage build={build} />}
                  {tab === 'history' && <BuildHistory buildPhase={build.phase} onGoBuild={() => setTab('build')} />}
                </>
              )}
            </div>
          </main>

          <footer className="app-footer">
            {tab === 'keys' ? <>
              <span className="hint">已有应用的签名配置会自动导入。编辑后点击「保存密钥」，密码在本机加密保存。</span>
              <Button onClick={() => setTab('app')}>返回应用信息</Button>
            </> : <>
            <span className={`hint${dirty ? ' dirty' : ''}`}>
              {!config
                ? '未连接到本地服务'
                : dirty
                  ? '有未保存的改动，打包时会自动保存'
                  : '所有修改保存在本机 config/apps（每个应用一份配置）'}
            </span>
            <Button icon={<ReloadOutlined />} onClick={handleReload} disabled={!config} loading={loading}>
              重新加载
            </Button>
            <Button type="primary" icon={<SaveOutlined />} onClick={handleSave} disabled={!config}>
              保存配置
            </Button>
            </>}
          </footer>
        </div>
        <Drawer title="PackTool" placement="left" width={280} open={mobileNav} onClose={() => setMobileNav(false)} styles={{ body: { padding: 0 } }}>
          <SideNav active={tab} onChange={(next) => { setMobileNav(false); void navigate(next) }}
            permCount={config?.android.permissions.length ?? 0} buildPhase={build.phase}
            serverText={serverText} serverState={serverState} />
        </Drawer>
      </div>
    </>
  )
}
