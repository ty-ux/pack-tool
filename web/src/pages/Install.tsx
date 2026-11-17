import { Alert, Card, Checkbox } from 'antd'
import { useConfig } from '../store/config'
import { DevicePicker } from '../components/DevicePicker'
import { Field } from '../components/Field'

export function InstallPage() {
  const { config, setField } = useConfig()
  if (!config) return null

  return (
    <div className="card-grid">
      <Card title="安装选项">
        <Field
          label="自动安装"
          hint="勾选后 APK 打包完成自动安装到所选设备；不勾选则只生成 APK 文件"
        >
          <Checkbox
            checked={config.install.enabled}
            onChange={(e) => setField(['install', 'enabled'], e.target.checked)}
          >
            打包完成后自动安装到设备
          </Checkbox>
        </Field>
        <Field label="安装后行为" hint="安装成功后通过 adb 启动 App 主 Activity">
          <Checkbox
            checked={config.install.launch}
            onChange={(e) => setField(['install', 'launch'], e.target.checked)}
          >
            安装后自动启动 App
          </Checkbox>
        </Field>
        {!config.install.enabled && (
          <Alert
            type="info"
            showIcon
            message="当前仅生成 APK"
            description="开启自动安装后，构建结束会把 APK 通过 adb 推送到目标设备并覆盖安装。"
          />
        )}
      </Card>

      <Card title="目标设备">
        <Field label="设备序列号">
          <DevicePicker
            value={config.install.serial}
            onChange={(v) => setField(['install', 'serial'], v)}
          />
        </Field>
        <div className="panel-box">
          <p className="field-hint">
            先点刷新；仍无设备时可手动连接或重启 adb。无线调试设备首次连接需要在手机上确认授权；USB 设备未出现通常是 adb 服务异常或驱动缺失。
          </p>
        </div>
      </Card>
    </div>
  )
}
