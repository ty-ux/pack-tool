import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Select, Space, Spin } from 'antd'
import { importSigningKeys } from '../api'
import { DEFAULT_CONFIG, useConfig } from '../store/config'
import type { SigningKey } from '../types'
import { Field } from './Field'
import { SigningFields, SigningVerification } from './SigningFields'

export function AndroidSigning({ onManageKeys }: { onManageKeys: () => void }) {
  const { config, setField } = useConfig()
  const [keys, setKeys] = useState<SigningKey[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try { setKeys((await importSigningKeys()).keys) }
    catch (error) { setError(error instanceof Error ? error.message : '密钥列表加载失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  if (!config) return null
  const selected = keys.find((key) => key.id === config.signing.keyId)
  return <Card title="Android 签名" extra={<Button htmlType="button" type="link" onClick={onManageKeys}>管理密钥</Button>}>
    <Field label="选择密钥" hint="已保存的密钥可在多个应用间复用。留在单独设置时，也可沿用工程原有签名。">
      <Select value={config.signing.keyId || ''} loading={loading} showSearch optionFilterProp="label"
        onChange={(keyId) => setField(['signing'], { ...DEFAULT_CONFIG.signing, keyId })}
        options={[{ value: '', label: '本应用单独设置 / 沿用工程签名' }, ...keys.map((key) => ({
          value: key.id, label: key.name + ' · ' + key.signing.keyAlias,
        }))]} />
    </Field>
    {error && <Alert showIcon type="error" message={error} action={<Button htmlType="button" onClick={load}>重试</Button>} />}
    {config.signing.keyId ? (
      loading ? <Spin /> : selected ? <>
        <dl className="signing-summary">
          <dt>密钥名称</dt><dd>{selected.name}</dd>
          <dt>签名文件</dt><dd className="mono-input signing-path">{selected.signing.keystorePath}</dd>
          <dt>密钥别名</dt><dd>{selected.signing.keyAlias}</dd>
          <dt>密码方式</dt><dd>{selected.signing.passwordMode === 'local' ? '本机加密保存' : '环境变量'}</dd>
        </dl>
        <div className="field-hint">使用共享密钥管理中的配置。密码可在「密钥管理」查看和修改。</div>
        <SigningVerification config={config} />
      </> : <Alert showIcon type="error" message="所选密钥不存在，请重新选择或前往密钥管理。" />
    ) : <>
      <SigningFields value={config.signing} onChange={(signing) => setField(['signing'], signing)}
        hint={config.projectType === 'flutter'
          ? '用于当前应用的 APK 或 AAB。选用签名时使用独立 Gradle 缓存，首次构建需要下载依赖'
          : '用于当前应用的 APK 或 AAB。留空时沿用工程原有的签名配置'} />
      {config.signing.keystorePath.trim() && <SigningVerification config={config} />}
      <Space className="key-actions"><Button htmlType="button" onClick={onManageKeys}>打开密钥管理</Button></Space>
    </>}
  </Card>
}
