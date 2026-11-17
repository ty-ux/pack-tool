import { Button, Checkbox, Tag, Tooltip } from 'antd'
import type { Permission, PermissionLevel } from '../types'

const LEVEL: Record<PermissionLevel, { label: string; color: string }> = {
  blocked: { label: '仅系统应用', color: 'red' },
  deprecated: { label: '已弃用', color: 'default' },
  special: { label: '需系统授权', color: 'orange' },
  sensitive: { label: '敏感权限', color: 'gold' },
  scoped: { label: 'Android 13+', color: 'default' },
}

interface Props {
  permissions: Permission[]
  selected: string[]
  onToggle: (key: string) => void
  onSelectAll: (on: boolean) => void
}

export function PermissionGrid({ permissions, selected, onToggle, onSelectAll }: Props) {
  const set = new Set(selected)
  const count = selected.filter((k) => permissions.some((p) => p.key === k)).length
  const allChecked = permissions.length > 0 && count === permissions.length

  return (
    <div>
      <div className="perm-toolbar">
        <Button size="small" disabled={allChecked} onClick={() => onSelectAll(true)}>
          全选
        </Button>
        <Button size="small" disabled={count === 0} onClick={() => onSelectAll(false)}>
          全不选
        </Button>
        <span className="perm-count">
          已选 {count} / {permissions.length} 项
        </span>
      </div>
      <div className="perm-grid">
        {permissions.map((p) => {
          const active = set.has(p.key)
          const level = p.level ? LEVEL[p.level] : null
          return (
            <div
              key={p.key}
              className={`perm-tile${active ? ' active' : ''}`}
              role="checkbox"
              aria-checked={active}
              aria-label={`${p.label}：${p.desc}`}
              tabIndex={0}
              onClick={() => onToggle(p.key)}
              onKeyDown={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault()
                  onToggle(p.key)
                }
              }}
            >
              <Checkbox checked={active} style={{ marginTop: 1 }} />
              <div style={{ minWidth: 0 }}>
                <div className="perm-name">{p.label}</div>
                <div className="perm-desc">{p.desc}</div>
                {level && (
                  <div className="perm-flag">
                    <Tooltip title={p.note}>
                      <Tag color={level.color}>{level.label}</Tag>
                    </Tooltip>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
