import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, Radio } from 'antd'
import { verifySigning } from '../api'
import { useConfig } from '../store/config'
import { BrowseInput } from './BrowseInput'
import { Field } from './Field'

function PasswordInput({ id, 'aria-describedby': describedBy, value, onChange, saved, required }: {
  id?: string
  'aria-describedby'?: string
  value: string
  onChange: (value: string) => void
  saved: boolean
  required?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return (
    <Input
      id={id}
      aria-describedby={describedBy}
      aria-required={required}
      required={required}
      type={visible ? 'text' : 'password'}
      autoComplete="new-password"
      autoCapitalize="none"
      spellCheck={false}
      value={value}
      placeholder={saved ? '已保存，输入可替换' : '请输入密码'}
      onChange={(event) => onChange(event.target.value)}
      suffix={
        <Button type="text" size="small" htmlType="button" aria-label={visible ? '隐藏密码' : '显示密码'}
          aria-pressed={visible} onClick={() => setVisible(!visible)}>
          {visible ? '隐藏' : '显示'}
        </Button>
      }
    />
  )
}

export function AndroidSigning() {
  const { config, setField, activeId } = useConfig()
  const [verifying, setVerifying] = useState(false)
  const [verification, setVerification] = useState<{ ok: boolean; message: string } | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    setVerification(null)
    return () => { generation.current += 1 }
  }, [activeId, config?.signing, config?.paths.javaHome])

  const verify = async () => {
    if (!config) return
    const current = generation.current
    setVerifying(true)
    setVerification(null)
    try {
      const result = await verifySigning(config)
      if (current === generation.current) setVerification(result)
    } catch (error) {
      if (current === generation.current) {
        setVerification({ ok: false, message: error instanceof Error ? error.message : '签名验证失败，请重试' })
      }
    } finally {
      setVerifying(false)
    }
  }
  if (!config) return null
  return (
    <Card title="Android 签名">
      <Field label="签名文件" hint={<>
        {config.signing.keystorePath && <div className="signing-path mono-input">{config.signing.keystorePath}</div>}
        {config.projectType === 'flutter'
        ? '用于当前应用的 APK 或 AAB。选用签名时使用独立 Gradle 缓存，首次构建需要下载依赖'
        : '用于当前应用的 APK（Debug 和 Release）。留空时使用离线工程原有的签名配置'}
      </>}>
        <BrowseInput
          kind="file"
          title="选择 Android 签名文件"
          fileFilter="Android 签名文件 (*.jks;*.keystore;*.p12)|*.jks;*.keystore;*.p12|所有文件 (*.*)|*.*"
          browseLabel="选择签名文件"
          stacked
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
          <Field label="密码方式">
            <Radio.Group value={config.signing.passwordMode} aria-label="密码方式"
              onChange={(event) => setField(['signing', 'passwordMode'], event.target.value)}
              options={[{ label: '直接填写', value: 'local' }, { label: '环境变量（高级）', value: 'env' }]} />
          </Field>
          {config.signing.passwordMode === 'local' ? (
            <>
              <Field label="密钥库密码" required={!config.signing.storePasswordEncrypted}
                hint={config.signing.storePasswordEncrypted
                  ? '已在本机加密保存。留空保留原密码，填写新密码可替换'
                  : '填写签名文件的实际密码，保存后按应用加密存储在当前 Windows 账户下'}>
                <PasswordInput value={config.signing.storePassword || ''}
                  saved={!!config.signing.storePasswordEncrypted} required={!config.signing.storePasswordEncrypted}
                  onChange={(value) => setField(['signing', 'storePassword'], value)} />
              </Field>
              {config.signing.storePasswordEncrypted && (
                <Button htmlType="button" size="small" onClick={() => {
                  setField(['signing', 'storePasswordEncrypted'], '')
                  setField(['signing', 'storePassword'], '')
                }}>清除已保存的密钥库密码</Button>
              )}
              <Field label="密钥密码" hint={config.signing.keyPasswordEncrypted
                ? '已在本机加密保存。留空保留，清除后将使用密钥库密码'
                : '与密钥库密码相同时留空，不同时填写实际密码'}>
                <PasswordInput value={config.signing.keyPassword || ''} saved={!!config.signing.keyPasswordEncrypted}
                  onChange={(value) => setField(['signing', 'keyPassword'], value)} />
              </Field>
              {config.signing.keyPasswordEncrypted && (
                <Button htmlType="button" size="small" onClick={() => {
                  setField(['signing', 'keyPasswordEncrypted'], '')
                  setField(['signing', 'keyPassword'], '')
                }}>清除已保存的密钥密码</Button>
              )}
            </>
          ) : (
            <>
              <Field label="密钥库密码变量名" required hint="填写已有环境变量的名称，其值为密钥库密码">
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
          <div className="signing-verification">
            <Button htmlType="button" loading={verifying} onClick={verify}>验证签名</Button>
            <div className="field-hint">检查签名文件、别名和两个密码是否匹配。使用当前填写或已保存的密码，无需先保存。JDK 可在「路径配置」选择。</div>
            <div aria-live="polite" aria-atomic="true">
              {verifying ? '正在验证签名…' : verification && (
                <Alert showIcon type={verification.ok ? 'success' : 'error'} message={verification.message} />
              )}
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
