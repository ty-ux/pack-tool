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
  const { config, permissions, setField } = useConfig()
  const { message } = App.useApp()
  const [preflight, setPreflight] = useState<PreflightPayload | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [preflightError, setPreflightError] = useState('')
  const [showAllChecks, setShowAllChecks] = useState(false)

  const runPreflight = useCallback(async () => {
    setPreflightLoading(true)
    setPreflightError('')
    try {
      const res = await getPreflight()
      setPreflight(res)
    } catch (e) {
      setPreflightError(e instanceof Error ? e.message : '检查失败')
    } finally {
      setPreflightLoading(false)
    }
  }, [])

  useEffect(() => {
    if (config?.build.platform === 'apk') runPreflight()
  }, [runPreflight, config?.build.platform])

  if (!config) return null

  const platform = config.build.platform
  const webType = config.build.webType
  const target: BuildTarget = platform === 'apk' ? 'apk' : platform === 'wgt' ? 'wgt' : `web-${webType}`

  const targetOptions = [
    { label: 'Android APK', value: 'apk' },
    { label: '网站-PC Web', value: 'web-pc' },
    { label: '手机H5', value: 'web-h5' },
    { label: 'WGT 热更新包', value: 'wgt' },
  ]

  const onTarget = (t: BuildTarget) => {
    setField(['build', 'platform'], t === 'apk' ? 'apk' : t === 'wgt' ? 'wgt' : 'web')
    if (t !== 'apk' && t !== 'wgt') {
      setField(['build', 'webType'], t === 'web-pc' ? 'pc' : 'h5')
    }
  }

  const permCount = config.android.permissions.filter((k) => permissions.some((p) => p.key === k)).length

  const handlePrimary = () => {
    if (build.running) {
      build.cancel()
    } else {
      build.start(config.build.platform, config.build.webType)
    }
  }

  const handleOpenOutput = () => {
    let dir = ''
    if (platform === 'web') {
      dir = config.paths.webOutputDir?.trim()
      if (!dir) {
        const base = config.paths.outputDir?.trim()
        dir = base ? `${base}\\build` : ''
      }
    } else {
      dir = config.paths.outputDir?.trim() ?? ''
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
        items={[
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
        ]}
      />

      <Card title="打包目标">
        <Segmented
          block
          options={targetOptions}
          value={target}
          onChange={(v) => onTarget(v as BuildTarget)}
        />
        <div className="field-hint" style={{ marginTop: 12 }}>
          {platform === 'apk'
            ? 'HBuilderX 编译 appResource + Gradle 离线打包，产物为 .apk'
            : platform === 'wgt'
              ? 'HBuilderX 制作应用资源升级包 (publish app --type wgt)，产物为 .wgt，可配合升级中心做热更新'
              : 'HBuilderX 发行 (publish web)，产物复制到 Web 输出目录'}
        </div>
      </Card>

      {platform === 'apk' && (
        <Card
          title="构建前检查"
          extra={
            <Button size="small" icon={<ReloadOutlined />} loading={preflightLoading} onClick={runPreflight}>
              重新检查
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
                <Button size="small" onClick={runPreflight}>
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
                  环境、Android 工程与权限配置均通过检查，可以开始打包。
                </div>
              )}
            </>
          ) : null}
        </Card>
      )}

      {platform === 'apk' ? (
        <Card title="构建类型">
          <Radio.Group
            value={config.build.buildType}
            onChange={(e) => setField(['build', 'buildType'], e.target.value)}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: 'Debug', value: 'debug' },
              { label: 'Release', value: 'release' },
            ]}
          />
          <div className="field-hint" style={{ marginTop: 12 }}>
            {config.build.buildType === 'debug'
              ? 'Debug 便于调试，体积较大，适合开发联调。'
              : 'Release 为发布包（使用 keystore 签名），适合交付上线。'}
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
          steps={!build.running && build.lines.length === 0 ? skeletonFor(platform) : build.steps}
        />
      </Card>

      <div className="build-action">
        <div className="build-action-copy">
          <div className="build-action-title">{build.running ? '构建进行中' : '准备开始构建'}</div>
          <div className="build-action-desc">
            {build.running
              ? '日志会实时输出到下方终端，可随时停止。'
              : `${resultText} · 构建前会自动保存当前配置并同步依赖包。`}
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
          {build.running ? '停止构建' : '一键打包'}
        </Button>
      </div>

      <div className="build-secondary">
        <Button icon={<FolderOpenOutlined />} onClick={handleOpenOutput}>
          打开输出目录
        </Button>
        <Button icon={<DeleteOutlined />} onClick={build.clearLog} disabled={build.lines.length === 0}>
          清空日志
        </Button>
      </div>

      <LogConsole
        lines={build.lines}
        follow={build.follow}
        onFollowChange={build.setFollow}
        running={build.running}
        phase={build.phase}
      />

      <p className="build-note">
        {build.running
          ? '取消仅结束本工具发起的构建进程；HBuilderX 主程序内的编译动作可能仍在继续（已有产物校验兜底）。'
          : '构建日志实时写入 logs\\build.log，页面刷新可继续查看；详细历史请见「构建历史」页签。'}
      </p>
    </div>
  )
}
