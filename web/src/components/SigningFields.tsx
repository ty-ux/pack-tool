import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Radio } from 'antd'
import { verifySigning } from '../api'
import type { AppConfig } from '../types'
import { BrowseInput } from './BrowseInput'
import { Field } from './Field'

type Signing = AppConfig['signing']

function PasswordInput({ id, 'aria-describedby': describedBy, value, onChange, saved, name, required }: {
  id?: string
  'aria-describedby'?: string
  value: string
  onChange: (value: string) => void
  saved: boolean
  name: string
  required?: boolean
}) {
  const [visible, setVisible] = useState(false)
  return <Input id={id} name={name} aria-describedby={describedBy} required={required}
    type={visible ? 'text' : 'password'} autoComplete="new-password" autoCapitalize="none" spellCheck={false}
    value={value} placeholder={saved ? '已保存，输入可替换' : '请输入密码'}
    onChange={(event) => onChange(event.target.value)}
    suffix={<Button type="text" size="small" htmlType="button" aria-label={visible ? '隐藏密码' : '显示密码'}
      aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? '隐藏' : '显示'}</Button>} />
}

export function SigningFields({ value, onChange, required = false, hint }: {
  value: Signing
  onChange: (signing: Signing) => void
  required?: boolean
  hint?: string
}) {
  const change = (field: keyof Signing, text: string) => onChange({ ...value, [field]: text })
  return <>
    <Field label="签名文件" required={required} hint={<>
      {value.keystorePath && <div className="signing-path mono-input">{value.keystorePath}</div>}
      {hint || '选择本机已有的 .jks、.keystore 或 .p12 文件。'}
    </>}>
      <BrowseInput kind="file" title="选择 Android 签名文件" stacked required={required} name="keystorePath"
        fileFilter="Android 签名文件 (*.jks;*.keystore;*.p12)|*.jks;*.keystore;*.p12|所有文件 (*.*)|*.*"
        browseLabel="选择签名文件" placeholder="请选择 .jks 或 .keystore 文件" value={value.keystorePath}
        onChange={(path) => change('keystorePath', path)} />
    </Field>
    {(required || value.keystorePath.trim()) && <>
      <Field label="密钥别名" required hint="签名文件创建时填写的 Key Alias">
        <Input name="keyAlias" value={value.keyAlias} required autoCapitalize="none" spellCheck={false}
          onChange={(event) => change('keyAlias', event.target.value)} />
      </Field>
      <Field label="密码方式">
        <Radio.Group name="passwordMode" value={value.passwordMode} aria-label="密码方式"
          onChange={(event) => change('passwordMode', event.target.value)}
          options={[{ label: '直接填写', value: 'local' }, { label: '环境变量（高级）', value: 'env' }]} />
      </Field>
      {value.passwordMode === 'local' ? <>
        <Field label="密钥库密码" required={!value.storePasswordEncrypted}
          hint={value.storePasswordEncrypted ? '已在本机加密保存。留空保留原密码，填写新密码可替换' : '填写签名文件的实际密码，保存后按当前 Windows 账户加密存储'}>
          <PasswordInput name="storePassword" value={value.storePassword || ''} saved={!!value.storePasswordEncrypted}
            required={!value.storePasswordEncrypted} onChange={(text) => change('storePassword', text)} />
        </Field>
        {value.storePasswordEncrypted && <Button htmlType="button" size="small"
          onClick={() => onChange({ ...value, storePasswordEncrypted: '', storePassword: '' })}>清除已保存的密钥库密码</Button>}
        <Field label="密钥密码" hint={value.keyPasswordEncrypted
          ? '已在本机加密保存。留空保留，清除后将使用密钥库密码' : '与密钥库密码相同时留空，不同时填写实际密码'}>
          <PasswordInput name="keyPassword" value={value.keyPassword || ''} saved={!!value.keyPasswordEncrypted}
            onChange={(text) => change('keyPassword', text)} />
        </Field>
        {value.keyPasswordEncrypted && <Button htmlType="button" size="small"
          onClick={() => onChange({ ...value, keyPasswordEncrypted: '', keyPassword: '' })}>清除已保存的密钥密码</Button>}
      </> : <>
        <Field label="密钥库密码变量名" required hint="填写已有环境变量的名称，其值为密钥库密码">
          <Input name="storePasswordEnv" value={value.storePasswordEnv} required className="mono-input"
            autoCapitalize="none" spellCheck={false} onChange={(event) => change('storePasswordEnv', event.target.value)} />
        </Field>
        <Field label="密钥密码变量名" hint="密钥密码和密钥库密码相同时留空">
          <Input name="keyPasswordEnv" value={value.keyPasswordEnv} className="mono-input"
            autoCapitalize="none" spellCheck={false} onChange={(event) => change('keyPasswordEnv', event.target.value)} />
        </Field>
      </>}
    </>}
  </>
}

export function SigningVerification({ config }: { config: AppConfig }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    setResult(null)
    return () => { generation.current += 1 }
  }, [config.signing, config.paths.javaHome])
  const verify = async () => {
    const current = generation.current
    setBusy(true)
    setResult(null)
    try {
      const response = await verifySigning(config)
      if (current === generation.current) setResult(response)
    } catch (error) {
      if (current === generation.current) setResult({ ok: false, message: error instanceof Error ? error.message : '签名验证失败' })
    } finally { setBusy(false) }
  }
  return <div className="signing-verification">
    <Button htmlType="button" loading={busy} onClick={verify}>验证签名</Button>
    <div className="field-hint">检查文件、别名和两个密码是否匹配，无需先保存。JDK 使用当前应用的「路径配置」。</div>
    <div aria-live="polite" aria-atomic="true">{busy ? '正在验证签名…' : result &&
      <Alert showIcon type={result.ok ? 'success' : 'error'} message={result.message} />}</div>
  </div>
}
