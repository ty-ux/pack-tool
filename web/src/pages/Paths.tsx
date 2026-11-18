import { Card } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useConfig } from '../store/config'
import { BrowseInput } from '../components/BrowseInput'
import { Field } from '../components/Field'
import type { ProjectType } from '../types'

const PROJECT_DIRECTORY_HINTS: Record<ProjectType, string> = {
  uniapp: '需包含 manifest.json',
  android: '需包含 Gradle Wrapper（gradlew.bat）',
  flutter: '需包含 pubspec.yaml 和 android/ 目录',
  'react-native': '请选择包含 package.json 和 android/gradlew.bat 的目录，并先安装项目的 JavaScript 依赖',
}

export function PathsPage() {
  const { config, setField } = useConfig()
  if (!config) return null
  const p = config.paths
  const uniapp = config.projectType === 'uniapp'
  const flutter = config.projectType === 'flutter'

  const set = (key: keyof typeof p) => (value: string) => setField(['paths', key], value)

  return (
    <div className="card-grid">
      <Card title="工具与工程">
        {uniapp && <Field label="HBuilderX CLI 路径" required hint="HBuilderX 安装目录下的 cli.exe，用于编译前端资源">
          <BrowseInput
            value={p.hbuilderxCli}
            onChange={set('hbuilderxCli')}
            kind="file"
            placeholder="C:\Tools\HBuilderX\cli.exe"
          />
        </Field>}
        <Field label={uniapp ? 'uni-app 项目目录' : '项目根目录'} required hint={PROJECT_DIRECTORY_HINTS[config.projectType]}>
          <BrowseInput
            value={p.projectDir}
            onChange={set('projectDir')}
            kind="dir"
            placeholder="C:\Projects\my-app"
          />
        </Field>
        {flutter && <Field label="Flutter CLI 路径" hint="选择 Flutter SDK 中的 bin\flutter.bat，留空时从 PATH 查找">
          <BrowseInput
            value={p.flutterCli}
            onChange={set('flutterCli')}
            kind="file"
            placeholder="C:\Tools\flutter\bin\flutter.bat"
          />
        </Field>}
        {uniapp && <Field label="离线打包工程目录" required={config.build.platform === 'apk'} hint="仅 APK 需要。请选择包含 simpleDemo 的 HBuilder-Integrate-AS 根目录">
          <BrowseInput
            value={p.integrateDir}
            onChange={set('integrateDir')}
            kind="dir"
            placeholder="C:\Projects\HBuilder-Integrate-AS"
          />
        </Field>}
        <Field label="JDK 路径" hint="可选，为本次构建设置 JAVA_HOME。JDK 版本需与项目的 Gradle 配置兼容">
          <BrowseInput
            value={p.javaHome}
            onChange={set('javaHome')}
            kind="dir"
            placeholder="C:\Java\jdk-17"
          />
        </Field>
        {uniapp && <Field label="adb 路径" hint="可选，用于构建后安装与设备列表">
          <BrowseInput
            value={p.adb}
            onChange={set('adb')}
            kind="file"
            placeholder="C:\Android\Sdk\platform-tools\adb.exe"
          />
        </Field>}
      </Card>

      <Card title="产物输出">
        <Field label={uniapp ? 'APK / WGT 输出目录' : 'APK / AAB 输出目录'} hint={
          uniapp ? '留空时 APK 保留在离线工程，WGT 保存到工具的 output 目录' : '可选。留空时使用项目默认的构建产物目录'
        }>
          <BrowseInput
            value={p.outputDir}
            onChange={set('outputDir')}
            kind="dir"
            placeholder="C:\Projects\pack-output"
          />
        </Field>
        {uniapp && <Field
          label="Web 输出目录"
          hint="留空时输出到 APK / WGT 输出目录下的 build，或工具的 output\build。发行时会清空目标目录，请选择专用目录"
        >
          <BrowseInput
            value={p.webOutputDir}
            onChange={set('webOutputDir')}
            kind="dir"
            placeholder="C:\Projects\pack-output\web"
          />
        </Field>}
        <div className="panel-box">
          <div className="check-label">
            <InfoCircleOutlined style={{ marginRight: 6, color: 'var(--color-text-muted)' }} />
            修改路径后请点「保存配置」
          </div>
          <p className="field-hint" style={{ marginTop: 4 }}>
            路径会原样传给构建脚本，建议使用绝对路径且避免中文空格；「打包构建」页的构建前检查会提前验证这些目录是否存在。
          </p>
        </div>
      </Card>
    </div>
  )
}
