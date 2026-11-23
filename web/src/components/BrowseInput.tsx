import { useState } from 'react'
import { App, Button, Input, Select, Space } from 'antd'
import { FolderOpenOutlined } from '@ant-design/icons'
import { browse } from '../api'
import type { LocalToolCandidate } from '../types'

interface Props {
  id?: string
  'aria-describedby'?: string
  value: string
  onChange: (value: string) => void
  kind: 'dir' | 'file'
  placeholder?: string
  title?: string
  fileFilter?: string
  mono?: boolean
  browseLabel?: string
  stacked?: boolean
  suggestions?: { tool: string; paths: LocalToolCandidate[] }
  /** 额外一个选择按钮，用于既支持文件又支持目录的输入项 */
  extraBrowse?: { kind: 'dir' | 'file'; label: string; title?: string }
}

/** 路径输入 + "浏览..."（调后端弹系统选择框回填绝对路径） */
export function BrowseInput({
  id,
  'aria-describedby': describedBy,
  value,
  onChange,
  kind,
  placeholder,
  title,
  fileFilter,
  mono = true,
  browseLabel = '浏览',
  suggestions,
  extraBrowse,
  stacked = false,
}: Props) {
  const { message } = App.useApp()
  const [busy, setBusy] = useState(false)

  const pick = async (type: 'dir' | 'file', dialogTitle?: string) => {
    setBusy(true)
    try {
      const res = await browse({ type, title: dialogTitle, fileFilter })
      if (res.ok) {
        onChange(res.path)
      }
      // 用户取消对话框静默即可
    } catch (e) {
      message.error(e instanceof Error ? e.message : '选择失败')
    } finally {
      setBusy(false)
    }
  }

  const input = (
      <Input
        id={id}
        aria-describedby={describedBy}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={mono ? 'mono-input' : undefined}
        spellCheck={false}
        allowClear
      />
  )
  const controls = [
      suggestions && suggestions.paths.length > 0 && (
        <Select
          key="suggestions"
          aria-label={`本机路径 · ${suggestions.tool}`}
          style={{ width: 108, flexShrink: 0 }}
          value={suggestions.paths.some(({ path }) => path === value) ? value : null}
          placeholder="本机路径"
          labelRender={() => '本机路径'}
          popupMatchSelectWidth={false}
          onChange={onChange}
          options={suggestions.paths.map(({ path, source }) => ({ value: path, label: path, source }))}
          optionRender={({ data }) => (
            <div style={{ maxWidth: 'min(480px, 80vw)', overflowWrap: 'anywhere' }}>
              <div className="mono-input">{data.value}</div>
              <div className="field-hint">{data.source}</div>
            </div>
          )}
        />
      ),
      <Button key="browse" icon={<FolderOpenOutlined />} onClick={() => pick(kind, title)} loading={busy}>
        {browseLabel}
      </Button>,
      extraBrowse && (
        <Button
          key="extra"
          icon={<FolderOpenOutlined />}
          onClick={() => pick(extraBrowse.kind, extraBrowse.title ?? title)}
          loading={busy}
        >
          {extraBrowse.label}
        </Button>
      ),
  ]
  return stacked ? (
    <div className="browse-input-stacked">
      {input}
      <Space wrap>{controls}</Space>
    </div>
  ) : (
    <Space.Compact style={{ width: '100%', display: 'flex' }}>
      {input}
      {controls}
    </Space.Compact>
  )
}
