import { Card, Input } from 'antd'
import { useConfig } from '../store/config'
import { BrowseInput } from './BrowseInput'
import { Field } from './Field'

export function AndroidSigning() {
  const { config, setField } = useConfig()
  if (!config) return null
  return (
    <Card title="Android 签名">
      <Field label="签名文件" hint={config.projectType === "flutter"
        ? "用于当前应用的 APK 或 AAB。选用签名时使用独立 Gradle 缓存，首次构建需要下载依赖"
        : "用于当前应用的 APK（Debug 和 Release）。留空时使用离线工程原有的签名配置"}>
        <BrowseInput
          kind="file"
          title="选择 Android 签名文件"
          fileFilter="Android 签名文件 (*.jks;*.keystore;*.p12)|*.jks;*.keystore;*.p12|所有文件 (*.*)|*.*"
          browseLabel="选择签名文件"
          placeholder="请选择 .jks 或 .keystore 文件"
          value={config.signing.keystorePath}
          onChange={(path) => setField(['signing', 'keystorePath'], path)}
        />
      </Field>
      {config.signing.keystorePath.trim() && (
        <>
          <Field label="密钥别名" required hint="签名文件创建时填写的 Key Alias">
            <Input
              value={config.signing.keyAlias}
              onChange={(e) => setField(['signing', 'keyAlias'], e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              aria-required
            />
          </Field>
          <Field label="密钥库密码变量名" required hint="填写本机环境变量的名字，不填密码。每个应用可用不同的变量名">
            <Input
              className="mono-input"
              value={config.signing.storePasswordEnv}
              onChange={(e) => setField(['signing', 'storePasswordEnv'], e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
              aria-required
            />
          </Field>
          <Field label="密钥密码变量名" hint="密钥密码和密钥库密码相同时留空">
            <Input
              className="mono-input"
              value={config.signing.keyPasswordEnv}
              onChange={(e) => setField(['signing', 'keyPasswordEnv'], e.target.value)}
              autoCapitalize="none"
              spellCheck={false}
            />
          </Field>
        </>
      )}
    </Card>
  )
}
