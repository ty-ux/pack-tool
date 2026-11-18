import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, Input, Radio, Segmented, Skeleton } from 'antd'
import {
  DeleteOutlined,
  FolderOpenOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { getPreflight, openDir } from '../api'
import { useConfig } from '../store/config'
import type { BuildTarget, PreflightCheck, PreflightPayload } from '../types'
import type { useBuild } from '../hooks/useBuild'
import { LogConsole } from '../components/LogConsole'
import { StatCards } from '../components/StatCards'
import { PipelineSteps } from '../components/PipelineSteps'
import { Field, FieldRow } from '../components/Field'
import { PROJECT_TYPES } from '../components/ProjectTypeField'
import { WechatBuildSettings } from '../components/WechatBuildSettings'
import { skeletonFor } from '../utils/pipeline'

interface Props {
  build: ReturnType<typeof useBuild>
}

const CHECK_DOT: Record<PreflightCheck['status'], string> = {
  ok: '',
  warn: 'warn',
  error: 'error',
}

function CheckList({ checks }: { checks: PreflightCheck[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, PreflightCheck[]>()
    for (const c of checks) {
      const list = map.get(c.group) ?? []
      list.push(c)
      map.set(c.group, list)
    }
    return [...map.entries()]
  }, [checks])

  return (
    <>
      {groups.map(([group, items]) => (
        <div key={group}>
          <div className="check-group-title">{group}</div>
          <div className="check-grid">
            {items.map((c) => (
              <div className="check-item" key={c.id}>
                <span className={`check-dot ${CHECK_DOT[c.status]}`} />
                <div style={{ minWidth: 0 }}>
                  <div className="check-label">{c.label}</div>
                  <div className="check-detail">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}

export function BuildPage({ build }: Props) {
  const { config, activeId, permissions, setField } = useConfig()
  const { message } = App.useApp()
  const [preflight, setPreflight] = useState<PreflightPayload | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState('')
  const [showAllChecks, setShowAllChecks] = useState(false)

  const runPreflight = useCallback(async (draft?: typeof config) => {
    setPreflightLoading(true)
    setPreflightError('')
    try {
      const res = await getPreflight(draft ?? undefined)
      setPreflight(res)
    } catch (e) {
      setPreflightError(e instanceof Error ? e.message : '检查失败')
    } finally {
      setPreflightLoading(false)
    }
  }, [])

  useEffect(() => {
    setPreflight(null)
    if (config?.projectType === 'uniapp' && config.build.platform === 'apk') runPreflight()
  }, [runPreflight, activeId, config?.projectType, config?.build.platform])

  if (!config) return null

  const platform = config.build.platform
  const webType = config.build.webType
  const uniapp = config.projectType === 'uniapp'
  const nativeWechat = config.projectType === 'wechat-miniprogram'
  const wechat = nativeWechat || platform === 'mp-weixin'
  const androidTarget = !wechat && (!uniapp || platform === 'apk')
  const target: BuildTarget = platform === 'web' ? `web-${webType}` : platform

  const targetOptions = uniapp ? [
    { label: 'Android APK', value: 'apk' },
    { label: '网站-PC Web', value: 'web-pc' },
    { label: '手机H5', value: 'web-h5' },
    { label: 'WGT 热更新包', value: 'wgt' },
    { label: '微信小程序', value: 'mp-weixin' },
  ] : [{ label: 'Android APK', value: 'apk' }, { label: 'Android App Bundle (AAB)', value: 'aab' }]

  const onTarget = (t: BuildTarget) => {
    if (t === 'web-pc' || t === 'web-h5') {
      setField(['build', 'platform'], 'web')
      setField(['build', 'webType'], t === 'web-pc' ? 'pc' : 'h5')
    } else {
      setField(['build', 'platform'], t)
    }
  }

  const permCount = config.android.permissions.filter((k) => permissions.some((p) => p.key === k)).length

  const handlePrimary = () => {
    if (build.running) {
      build.cancel()
    } else {
      build.start(wechat ? 'mp-weixin' : platform, webType)
    }
  }

  const handleOpenOutput = () => {
    let dir = ''
    if (wechat) {
      dir = wechatArtifact
    } else if (platform === 'web') {
      dir = config.paths.webOutputDir?.trim()
      if (!dir) {
        const base = config.paths.outputDir?.trim()
        dir = base ? `${base}\\build` : ''
      }
    } else {
      dir = config.paths.outputDir?.trim() ?? ''
      if (!dir && !uniapp && build.phase === 'ok') {
        const marker = '[OK] 构建产物: '
        dir = build.lines.find((line) => line.text.startsWith(marker))?.text.slice(marker.length) ?? ''
      }
    }
    if (!dir) {
      message.info('请先填写输出目录')
      return
    }
    openDir(dir).catch((e) => message.error(e instanceof Error ? e.message : '打开失败'))
    message.info('正在打开输出目录')
  }

  const issues = preflight?.checks.filter((c) => c.status !== 'ok') ?? []
  const visibleChecks = showAllChecks ? (preflight?.checks ?? []) : issues
  const summary = preflight?.summary
  const artifactMarker = '[OK] 构建产物: '
  const wechatSucceeded = wechat && build.phase === 'ok'
    && build.lines.some(({ text }) => text === `[WECHAT-BUILD] ${activeId}`)
  const wechatArtifact = wechatSucceeded
    ? build.lines.find(({ text }) => text.startsWith(artifactMarker))?.text.slice(artifactMarker.length) ?? ''
    : ''
  const previewMarker = `[WECHAT-PREVIEW] ${activeId}/`
  const preview = wechatSucceeded
    ? build.lines.find(({ text }) => text.startsWith(previewMarker))?.text.slice(previewMarker.length)
    : undefined

  const resultText =
    build.phase === 'ok'
      ? '上次构建成功'
      : build.phase === 'fail'
        ? '上次构建失败'
        : build.phase === 'cancelled'
          ? '上次构建已停止'
          : '尚未运行'

  return (
    <div className="stack">
      <StatCards
        items={wechat ? [
          { label: '项目名称', value: config.app.name || '—' },
          { label: '工程类型', value: PROJECT_TYPES[config.projectType] },
          { label: '微信小程序 AppID', value: config.wechat.appid || '读取项目配置', accent: 'cobalt', mono: true },
        ] : uniapp ? [
          { label: 'App 名称', value: config.app.name || '—' },
          { label: '版本', value: config.app.versionName || '—', accent: 'cobalt', mono: true },
          {
            label: platform === 'apk' ? '包名' : '打包目标',
            value:
              platform === 'apk'
                ? config.android.packageName || '—'
                : platform === 'wgt'
                  ? 'WGT 热更新包'
                  : webType === 'pc'
                    ? '网站-PC Web'
                    : '手机H5',
            accent: 'cobalt',
            mono: platform === 'apk',
          },
          {
            label: '已选权限',
            value: platform === 'apk' ? String(permCount) : '—',
            accent: 'success',
          },
        ] : [
          { label: 'App 名称', value: config.app.name || '—' },
          { label: '工程类型', value: PROJECT_TYPES[config.projectType] },
          { label: '打包目标', value: platform.toUpperCase(), accent: 'cobalt' },
        ]}
      />

      {!nativeWechat && <Card title="打包目标">
        <Segmented
          block
          aria-label="打包目标"
          options={targetOptions}
          value={target}
          onChange={(v) => onTarget(v as BuildTarget)}
          disabled={build.running || build.starting}
        />
        <div className="field-hint" style={{ marginTop: 12 }}>
          {wechat ? '编译生成 mp-weixin 目录，扫码预览和上传使用该目录。' : !uniapp
            ? platform === 'aab' ? 'AAB 用于应用商店分发。' : 'APK 可以直接安装在 Android 设备上。'
            : platform === 'apk'
            ? 'HBuilderX 编译 appResource + Gradle 离线打包，产物为 .apk'
            : platform === 'wgt'
              ? 'HBuilderX 制作应用资源升级包 (publish app --type wgt)，产物为 .wgt，可配合升级中心做热更新'
              : 'HBuilderX 发行 (publish web)，产物复制到 Web 输出目录'}
        </div>
      </Card>}

      {(androidTarget || wechat) && (
        <Card
          title="构建前检查"
          extra={
            <Button size="small" icon={<ReloadOutlined />} loading={preflightLoading} onClick={() => runPreflight(config)}>
              {preflight ? '重新检查' : '检查'}
            </Button>
          }
        >
          {preflightLoading && !preflight ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : preflightError ? (
            <Alert
              type="error"
              showIcon
              message="检查失败"
              description={preflightError}
              action={
                <Button size="small" onClick={() => runPreflight(config)}>
                  重试
                </Button>
              }
            />
          ) : preflight && summary ? (
            <>
              <div className="check-summary">
                <span className="check-pill ok">{summary.ok} 项通过</span>
                {summary.warn > 0 && <span className="check-pill warn">{summary.warn} 项提示</span>}
                {summary.error > 0 && <span className="check-pill error">{summary.error} 项错误</span>}
                <Button type="link" size="small" onClick={() => setShowAllChecks((v) => !v)}>
                  {showAllChecks ? '只看问题' : `查看全部 ${preflight.checks.length} 项`}
                </Button>
              </div>
              {visibleChecks.length > 0 ? (
                <CheckList checks={visibleChecks} />
              ) : (
                <div className="check-pass">
                  {androidTarget && uniapp ? '环境、Android 工程与权限配置均通过检查，可以开始打包。' : '项目和构建命令通过检查。'}
                </div>
              )}
            </>
          ) : null}
        </Card>
      )}

      {wechat ? <WechatBuildSettings /> : androidTarget ? (
        <Card title="构建类型">
          <Radio.Group
            aria-label="构建模式"
            value={config.build.buildType}
            onChange={(e) => setField(['build', 'buildType'], e.target.value)}
            optionType="button"
            buttonStyle="solid"
            disabled={build.running}
            options={[
              { label: 'Debug', value: 'debug' },
              { label: 'Release', value: 'release' },
            ]}
          />
          {!uniapp && (
            <div style={{ marginTop: 16 }}>
              <FieldRow>
                {config.projectType !== 'flutter' && (
                  <Field label="Gradle 模块" hint="默认 app。嵌套模块使用冒号分隔，如 feature:app">
                    <Input
                      value={config.projectBuild.gradleModule}
                      onChange={(e) => setField(['projectBuild', 'gradleModule'], e.target.value)}
                      spellCheck={false}
                      disabled={build.running}
                    />
                  </Field>
                )}
                <Field label="Flavor" hint="可选。填写项目已配置的 Flavor，例如 demo">
                  <Input
                    value={config.projectBuild.flavor}
                    onChange={(e) => setField(['projectBuild', 'flavor'], e.target.value)}
                    spellCheck={false}
                    disabled={build.running}
                  />
                </Field>
              </FieldRow>
            </div>
          )}
          <div className="field-hint" style={{ marginTop: 12 }}>
            {config.build.buildType === 'debug'
              ? config.projectType === 'react-native'
                ? 'React Native 的 Debug 包通常需要连接 Metro 开发服务器。'
                : 'Debug 便于调试，体积较大，适合开发联调。'
              : uniapp ? 'Release 为发布包（使用 keystore 签名），适合交付上线。' : 'Release 沿用项目的发行签名配置。'}
          </div>
        </Card>
      ) : platform === 'wgt' ? (
        <Alert
          type="info"
          showIcon
          message="wgt 热更新包说明"
          description="wgt 包只含前端资源，App 端需集成升级中心（uni-upgrade-center）或调用 plus.runtime.install 才能检测并安装升级；改到原生层（原生插件、权限、manifest 配置）时仍需重新打 APK 整包发版。每次发布前请在 manifest.json 中递增版本号。"
        />
      ) : (
        <Card title="Web 发行配置">
          <FieldRow>
            <Field label="网站标题 (webTitle)" hint="不填时默认使用项目名称">
              <Input
                value={config.web.webTitle}
                onChange={(e) => setField(['web', 'webTitle'], e.target.value)}
                placeholder="不填时默认使用项目名称"
              />
            </Field>
            <Field label="网站域名 (webDomain)">
              <Input
                className="mono-input"
                value={config.web.webDomain}
                onChange={(e) => setField(['web', 'webDomain'], e.target.value)}
                placeholder="可选，如 https://app.example.com"
              />
            </Field>
          </FieldRow>
          <Field label="SSR" hint="启用后产物为 client/server 结构，静态站点取 client 目录；纯静态部署通常无需开启">
            <Checkbox
              checked={config.web.ssr}
              onChange={(e) => setField(['web', 'ssr'], e.target.checked)}
            >
              启用 SSR（仅 Vue3 项目生效）
            </Checkbox>
          </Field>
          <div className="field-hint">Web 输出目录请在「路径配置」页设置。</div>
        </Card>
      )}

      <Card title="构建流水线">
        <PipelineSteps
          steps={!build.running && build.lines.length === 0 ? skeletonFor(platform, config.projectType) : build.steps}
        />
      </Card>

      <div className="build-action">
        <div className="build-action-copy">
          <div className="build-action-title">{build.running ? '构建进行中' : '准备开始构建'}</div>
          <div className="build-action-desc" role={wechat ? 'status' : undefined}>
            {build.running
              ? '日志会实时输出到下方终端，可随时停止。'
              : `${resultText} · 构建前会自动保存当前配置。`}
          </div>
        </div>
        <Button
          type="primary"
          size="large"
          danger={build.running}
          icon={build.running ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
          loading={build.starting}
          onClick={handlePrimary}
          className="build-primary"
        >
          {build.running ? '停止构建' : wechat ? '编译小程序' : '一键打包'}
        </Button>
      </div>

      <div className="build-secondary">
        {wechat && (
          <>
            <Button htmlType="button" disabled={build.running || build.starting} onClick={() => build.start('mp-weixin', 'h5', 'preview')}>
              生成预览二维码
            </Button>
            <Button htmlType="button" disabled={build.running || build.starting} onClick={() => build.start('mp-weixin', 'h5', 'upload')}>
              上传开发版本
            </Button>
          </>
        )}
        <Button icon={<FolderOpenOutlined />} onClick={handleOpenOutput} disabled={wechat && !wechatArtifact}>
          打开输出目录
        </Button>
        <Button icon={<DeleteOutlined />} onClick={build.clearLog} disabled={build.lines.length === 0}>
          清空日志
        </Button>
      </div>

      {preview && (
        <Card title="微信扫码预览">
          <img
            src={`/api/wechat/preview?receipt=${encodeURIComponent(preview)}`}
            width={210}
            height={210}
            alt="微信小程序预览二维码"
          />
        </Card>
      )}

      <LogConsole
        lines={build.lines}
        follow={build.follow}
        onFollowChange={build.setFollow}
        running={build.running}
        phase={build.phase}
      />

      <p className="build-note">
        {build.running && uniapp
          ? '取消仅结束本工具发起的构建进程；HBuilderX 主程序内的编译动作可能仍在继续（已有产物校验兜底）。'
          : '构建日志实时写入 logs\\build.log，页面刷新可继续查看；详细历史请见「构建历史」页签。'}
      </p>
    </div>
  )
}
