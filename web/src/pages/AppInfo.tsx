import { useEffect, useState } from 'react'
import { App, Button, Card, Input } from 'antd'
import { ClearOutlined, PictureOutlined, AndroidOutlined } from '@ant-design/icons'
import { useConfig } from '../store/config'
import { BrowseInput } from '../components/BrowseInput'
import { Field, FieldRow } from '../components/Field'
import { AndroidSigning } from '../components/AndroidSigning'
import { ProjectTypeField } from '../components/ProjectTypeField'

const DECODABLE_ICON = /\.(png|jpe?g|bmp|gif|tiff?)$/i

// 预览与打包保持一致：自定义图标可用就显示它，否则显示离线工程里实际会打进 APK 的 icon.png
function useAppIconPreview(icon: string) {
  const [customFailed, setCustomFailed] = useState(false)
  const [noneAvailable, setNoneAvailable] = useState(false)

  useEffect(() => {
    setCustomFailed(false)
    setNoneAvailable(false)
  }, [icon])

  const v = icon.trim()
  const direct = /^(data:|https?:)/i.test(v)
  // 带扩展名才判断格式；没有扩展名的路径按图标目录处理，交给后端解析
  const hasExt = /\.[a-z0-9]{1,6}$/i.test(v)
  const formatProblem = Boolean(v) && !direct && hasExt && !DECODABLE_ICON.test(v)
  const useCustom = Boolean(v) && !formatProblem && !customFailed
  const src = useCustom
    ? direct
      ? v
      : `/api/icon?path=${encodeURIComponent(v)}`
    : `/api/app-icon?icon=${encodeURIComponent(v)}`

  const onError = () => {
    if (useCustom) setCustomFailed(true)
    else setNoneAvailable(true)
  }

  return {
    src,
    onError,
    noneAvailable,
    formatProblem,
    customUnusable: Boolean(v) && (formatProblem || customFailed),
  }
}

function IconPicker() {
  const { config, setField } = useConfig()
  const { message } = App.useApp()
  const icon = config?.app.icon ?? ''
  const { src, onError, noneAvailable, customUnusable, formatProblem } = useAppIconPreview(icon)

  return (
    <div className="icon-picker">
      <div className="icon-frame" aria-hidden={noneAvailable}>
        {noneAvailable ? (
          icon ? (
            <span className="icon-fallback" title={icon}>
              无法预览
            </span>
          ) : (
            <PictureOutlined className="icon-empty" />
          )
        ) : (
          <img src={src} alt="" onError={onError} />
        )}
      </div>
      <div className="icon-fields">
        <BrowseInput
          value={icon}
          onChange={(v) => setField(['app', 'icon'], v)}
          kind="file"
          placeholder="图标文件或图标目录路径，留空则沿用工程内图标"
          title="选择 App 图标"
          fileFilter="图片文件|*.png;*.jpg;*.jpeg;*.bmp;*.gif;*.webp"
          browseLabel="选择图标"
          extraBrowse={{ kind: 'dir', label: '选择目录', title: '选择 App 图标目录' }}
        />
        <div className="icon-actions">
          <span className="field-hint">
            {icon
              ? '可选单个图片，或包含 drawable*/icon.png 的图标目录；打包时原图标会先备份'
              : '未选择自定义图标，预览显示离线工程当前的 icon.png'}
          </span>
          <Button
            size="small"
            type="text"
            icon={<ClearOutlined />}
            disabled={!icon}
            onClick={() => {
              setField(['app', 'icon'], '')
              message.info('已清除图标')
            }}
          >
            清除
          </Button>
        </div>
        {formatProblem ? (
          <div className="field-warn">所选图标格式无法写入 APK（如 webp），打包会跳过，实际使用工程内图标。</div>
        ) : customUnusable ? (
          <div className="field-warn">所选图标文件或目录不存在、无法读取，打包会跳过，实际使用工程内图标。</div>
        ) : null}
      </div>
    </div>
  )
}

function PreviewRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="preview-row">
      <span className="preview-key">{label}</span>
      <span className={`preview-val${mono ? ' mono' : ''}`}>{value || '—'}</span>
    </div>
  )
}

function InstallPreview() {
  const { config } = useConfig()
  const { src, onError, noneAvailable } = useAppIconPreview(config?.app.icon ?? '')
  if (!config) return null
  const { app, android } = config

  return (
    <>
      <div className="app-preview">
        <div className="app-preview-icon">
          <AndroidOutlined />
          {!noneAvailable && <img src={src} alt="" onError={onError} />}
        </div>
        <div className="app-preview-meta">
          <div className="app-preview-name">{app.name || '未命名应用'}</div>
          <div className="app-preview-sub mono">{app.appid || '未填写 AppID'}</div>
          <div className="app-preview-tags">
            <span className="preview-chip">v{app.versionName || '0.0.0'}</span>
            <span className="preview-chip">versionCode {app.versionCode || '0'}</span>
          </div>
        </div>
      </div>
      <div className="preview-rows">
        <PreviewRow label="包名" value={android.packageName} mono />
        <PreviewRow label="已选权限" value={`${android.permissions.length} 项`} />
        <PreviewRow
          label="构建类型"
          value={config.build.buildType === 'release' ? 'Release（签名发布）' : 'Debug（开发调试）'}
        />
      </div>
      <p className="field-hint">
        以上信息在打包时写入 AndroidManifest、strings.xml 与 build.gradle，请与 HBuilderX 工程保持一致。
      </p>
    </>
  )
}

export function AppInfoPage() {
  const { config, setField } = useConfig()
  if (!config) return null

  const basicFields = (
    <>
      <ProjectTypeField
        value={config.projectType}
        onChange={(type) => {
          setField(['projectType'], type)
          if (type !== config.projectType) {
            setField(['build', 'platform'], type === 'wechat-miniprogram' ? 'mp-weixin' : 'apk')
          }
        }}
      />
      <Field label="App 名称" required hint={config.projectType === 'uniapp' ? undefined : '用于在 PackTool 中区分项目'}>
        <Input
          value={config.app.name}
          onChange={(e) => setField(['app', 'name'], e.target.value)}
          placeholder="例如：示例应用"
          required
        />
      </Field>
    </>
  )

  if (config.projectType !== 'uniapp') {
    return (
      <div className="card-grid">
        <Card title="基本信息">
          {basicFields}
          {config.projectType === 'flutter' && (
            <FieldRow>
              <Field label="版本号" hint="可选，例如 1.2.3。留空时读取 pubspec.yaml">
                <Input value={config.projectBuild.flutterVersionName}
                  onChange={(e) => setField(['projectBuild', 'flutterVersionName'], e.target.value)}
                  autoCapitalize="none" spellCheck={false} />
              </Field>
              <Field label="版本码" hint="可选，1 到 2100000000 的整数。留空时读取 pubspec.yaml">
                <Input value={config.projectBuild.flutterVersionCode} inputMode="numeric"
                  onChange={(e) => setField(['projectBuild', 'flutterVersionCode'], e.target.value)}
                  spellCheck={false} />
              </Field>
            </FieldRow>
          )}
          <p className="field-hint">
            {config.projectType === 'wechat-miniprogram'
              ? '在「路径配置」选择小程序项目，在「打包构建」设置微信 AppID 和代码上传密钥。'
              : config.projectType === 'flutter' ? '包名和权限使用 Flutter 工程配置，版本和签名可在此设置。' : '包名、版本、权限及发行签名使用项目自身的 Android 配置。'}
          </p>
        </Card>
        {config.projectType === 'flutter' && <AndroidSigning />}
      </div>
    )
  }

  return (
    <div className="card-grid">
      <Card title="基本信息">
        {basicFields}
        <Field label="App 图标">
          <IconPicker />
        </Field>
        <Field label="AppID" required hint="HBuilderX manifest.json 中的 uni-app 应用标识">
          <Input
            className="mono-input"
            value={config.app.appid}
            onChange={(e) => setField(['app', 'appid'], e.target.value)}
            placeholder="__UNI__XXXXXX"
          />
        </Field>
        <FieldRow>
          <Field label="版本号 versionName">
            <Input
              className="mono-input"
              value={config.app.versionName}
              onChange={(e) => setField(['app', 'versionName'], e.target.value)}
              placeholder="1.0.0"
            />
          </Field>
          <Field label="版本码 versionCode">
            <Input
              className="mono-input"
              value={config.app.versionCode}
              onChange={(e) => setField(['app', 'versionCode'], e.target.value)}
              placeholder="1"
              type="number"
            />
          </Field>
        </FieldRow>
        <Field
          label="包名 PackageName"
          required={config.build.platform === 'apk'}
          hint="仅 APK 需要，格式如 com.example.app。修改包名后，Android 会将新包识别为另一个应用"
        >
          <Input
            className="mono-input"
            value={config.android.packageName}
            onChange={(e) => setField(['android', 'packageName'], e.target.value)}
            placeholder="com.example.app"
          />
        </Field>
      </Card>

      <Card title="安装预览">
        <InstallPreview />
      </Card>

      <AndroidSigning />
    </div>
  )
}
