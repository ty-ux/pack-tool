import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Alert, App, Button, Card, Empty, Input, Space, Spin, Tag } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { deleteSigningKey, importSigningKeys, revealSigningKey, saveSigningKey } from '../api'
import { DEFAULT_CONFIG, useConfig } from '../store/config'
import type { AppConfig, SigningKey } from '../types'
import { Field } from '../components/Field'
import { SigningFields, SigningVerification } from '../components/SigningFields'

function SavedPasswords({ record }: { record: SigningKey }) {
  const { message } = App.useApp()
  const [values, setValues] = useState<{ storePassword: string; keyPassword: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const generation = useRef(0)
  const id = useId()
  useEffect(() => {
    generation.current += 1
    setValues(null)
    setBusy(false)
    return () => { generation.current += 1 }
  }, [record])
  const reveal = async () => {
    if (values) { setValues(null); return }
    const request = generation.current
    setBusy(true)
    try {
      const response = await revealSigningKey(record.id)
      if (generation.current === request) setValues(response)
    } catch (error) {
      if (generation.current === request) message.error(error instanceof Error ? error.message : '密码读取失败')
    } finally { if (generation.current === request) setBusy(false) }
  }
  return <div className="key-passwords">
    <div className="field-hint">{record.signing.passwordMode === 'local' ? '密钥库密码 / 密钥密码：••••••••' :
      '环境变量：' + record.signing.storePasswordEnv + ' / ' + (record.signing.keyPasswordEnv || record.signing.storePasswordEnv)}</div>
    <Button htmlType="button" size="small" loading={busy} aria-expanded={!!values} aria-controls={id}
      onClick={reveal}>{values ? '隐藏已保存密码' : '显示已保存密码'}</Button>
    <div id={id} aria-live="polite">{values && <dl className="signing-summary">
      <dt>密钥库密码</dt><dd className="mono-input">{values.storePassword}</dd>
      <dt>密钥密码</dt><dd className="mono-input">{values.keyPassword}</dd>
    </dl>}</div>
  </div>
}

export function SigningKeysPage({ onGoApp }: { onGoApp: () => void }) {
  const { message, modal } = App.useApp()
  const { config, setField } = useConfig()
  const [keys, setKeys] = useState<SigningKey[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [signing, setSigning] = useState<AppConfig['signing']>({ ...DEFAULT_CONFIG.signing })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const summary = useRef<HTMLDivElement>(null)
  const heading = useId()
  const load = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try { setKeys((await importSigningKeys()).keys) }
    catch (error) { setLoadError(error instanceof Error ? error.message : '密钥列表加载失败') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const edit = (record?: SigningKey) => {
    setId(record?.id || '')
    setName(record?.name || '')
    setSigning({ ...DEFAULT_CONFIG.signing, ...record?.signing })
    setError('')
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const response = await saveSigningKey(name, signing, id)
      edit(response.key)
      await load()
      message.success('密钥已保存，其他应用可直接选择')
    } catch (error) {
      setError(error instanceof Error ? error.message : '密钥保存失败')
      requestAnimationFrame(() => summary.current?.focus())
    } finally { setSaving(false) }
  }
  const remove = (record: SigningKey) => modal.confirm({
    title: '删除密钥「' + record.name + '」？',
    content: '删除这条配置，签名文件本身会保留。',
    okText: '删除', cancelText: '取消', okButtonProps: { danger: true },
    onOk: async () => {
      try {
        await deleteSigningKey(record.id)
        if (id === record.id) edit()
        await load()
        message.success('密钥配置已删除')
      } catch (error) { message.error(error instanceof Error ? error.message : '删除失败') }
    },
  })
  const useKey = (record: SigningKey) => {
    setField(['signing'], { ...DEFAULT_CONFIG.signing, keyId: record.id })
    message.success('已为当前应用选择「' + record.name + '」，保存应用配置后生效')
    onGoApp()
  }
  if (!config) return null
  const editing = keys.find((key) => key.id === id)
  return <div className="key-management">
    <section aria-label="已保存的密钥">
      <div className="key-toolbar">
        <div><strong>已保存的密钥</strong><span className="field-hint"> · {keys.length} 个，所有应用共用</span></div>
        <Space wrap>
          <Button htmlType="button" icon={<ReloadOutlined />} onClick={load} loading={loading} disabled={saving}>刷新列表</Button>
          <Button htmlType="button" icon={<PlusOutlined />} onClick={() => edit()} disabled={saving}>新建密钥</Button>
        </Space>
      </div>
      {loadError && <Alert showIcon type="error" message={loadError} action={<Button htmlType="button" onClick={load}>重试</Button>} />}
      {loading && !keys.length ? <Spin /> : !keys.length ? <Card><Empty description="还没有密钥。在右侧填写已有签名文件，保存后即可复用。" /></Card> :
        <ul className="signing-key-list">{keys.map((record) => <li key={record.id}>
          <Card title={record.name} className={id === record.id ? 'key-card-selected' : ''}
            extra={<Tag>{record.signing.passwordMode === 'local' ? '本机加密' : '环境变量'}</Tag>}>
            <dl className="signing-summary">
              <dt>签名文件</dt><dd className="mono-input signing-path">{record.signing.keystorePath}</dd>
              <dt>密钥别名</dt><dd>{record.signing.keyAlias || '未填写'}</dd>
              <dt>引用应用</dt><dd>{record.usedBy.length ? record.usedBy.map((app) => app.name).join('、') : '暂无应用引用'}</dd>
            </dl>
            <SavedPasswords record={record} />
            <Space wrap className="key-actions">
              <Button htmlType="button" icon={<EditOutlined />} onClick={() => edit(record)} disabled={saving}>编辑</Button>
              {config.projectType !== 'wechat-miniprogram' && <Button htmlType="button" onClick={() => useKey(record)} disabled={saving}>用于当前应用</Button>}
              <Button htmlType="button" danger icon={<DeleteOutlined />} disabled={saving || !!record.usedBy.length}
                onClick={() => remove(record)} title={record.usedBy.length ? '请先在引用应用中更换签名密钥' : undefined}>删除</Button>
            </Space>
          </Card>
        </li>)}</ul>}
    </section>
    <Card title={<span id={heading}>{id ? '编辑密钥' : '新建密钥'}</span>}>
      <form aria-labelledby={heading} action="/api/signing-keys" method="post" onSubmit={submit}
        onChange={() => setError('')}>
        <Field label="密钥名称" required hint="例如：测试签名、正式版签名，便于其他应用选择。">
          <Input name="name" value={name} required maxLength={80} onChange={(event) => setName(event.target.value)} />
        </Field>
        <SigningFields required value={signing} onChange={setSigning} />
        {editing && editing.usedBy.length > 0 && <p className="field-hint">保存后，{editing.usedBy.length} 个引用应用的下次构建会使用更新后的配置。</p>}
        <SigningVerification config={{ ...config, signing }} />
        <div ref={summary} tabIndex={-1} aria-live="polite" className="key-form-feedback">
          {error && <Alert showIcon type="error" message={error} />}
        </div>
        <Space wrap className="key-actions">
          <Button htmlType="submit" type="primary" loading={saving}>保存密钥</Button>
          {id && <Button htmlType="button" onClick={() => edit()} disabled={saving}>取消编辑</Button>}
        </Space>
      </form>
    </Card>
  </div>
}
