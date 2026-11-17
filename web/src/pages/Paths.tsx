import { Card } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useConfig } from '../store/config'
import { BrowseInput } from '../components/BrowseInput'
import { Field } from '../components/Field'

export function PathsPage() {
  const { config, setField } = useConfig()
  if (!config) return null
  const p = config.paths

  const set = (key: keyof typeof p) => (value: string) => setField(['paths', key], value)

  return (
    <div className="card-grid">
      <Card title="工具与工程">
        <Field label="HBuilderX CLI 路径" required hint="HBuilderX 安装目录下的 cli.exe，用于编译前端资源">
          <BrowseInput
            value={p.hbuilderxCli}
            onChange={set('hbuilderxCli')}
            kind="file"
            placeholder="C:\Tools\HBuilderX\cli.exe"
          />
        </Field>
        <Field label="uni-app 项目目录" required hint="HBuilderX 项目根目录，需包含 manifest.json">
          <BrowseInput
            value={p.projectDir}
            onChange={set('projectDir')}
            kind="dir"
            placeholder="C:\Projects\my-uniapp"
          />
        </Field>
        <Field label="离线打包工程目录" required={config.build.platform === 'apk'} hint="仅 APK 需要。请选择包含 simpleDemo 的 HBuilder-Integrate-AS 根目录">
          <BrowseInput
            value={p.integrateDir}
            onChange={set('integrateDir')}
            kind="dir"
            placeholder="C:\Projects\HBuilder-Integrate-AS"
          />
        </Field>
        <Field label="JDK 路径 (javaHome)" hint="留空时由 Gradle 使用系统 JAVA_HOME 或 PATH。JDK 版本需与离线工程兼容">
          <BrowseInput
            value={p.javaHome}
            onChange={set('javaHome')}
            kind="dir"
            placeholder="C:\Java\jdk-17"
          />
        </Field>
        <Field label="adb 路径" hint="可选，用于构建后安装与设备列表">
          <BrowseInput
            value={p.adb}
            onChange={set('adb')}
            kind="file"
            placeholder="C:\Android\Sdk\platform-tools\adb.exe"
          />
        </Field>
      </Card>

      <Card title="产物输出">
        <Field label="APK / WGT 输出目录" hint="留空时 APK 保留在离线工程，WGT 保存到工具的 output 目录">
          <BrowseInput
            value={p.outputDir}
            onChange={set('outputDir')}
            kind="dir"
            placeholder="C:\Projects\pack-output"
          />
        </Field>
        <Field
          label="Web 输出目录"
          hint="留空时输出到 APK / WGT 输出目录下的 build，或工具的 output\build。发行时会清空目标目录，请选择专用目录"
        >
          <BrowseInput
            value={p.webOutputDir}
            onChange={set('webOutputDir')}
            kind="dir"
            placeholder="C:\Projects\pack-output\web"
          />
        </Field>
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
