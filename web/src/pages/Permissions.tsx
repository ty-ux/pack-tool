import { Alert, Card } from 'antd'
import { useConfig } from '../store/config'
import { PermissionGrid } from '../components/PermissionGrid'

export function PermissionsPage() {
  const { config, permissions, setField } = useConfig()
  if (!config) return null
  const selected = config.android.permissions ?? []

  const toggle = (key: string) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]
    setField(['android', 'permissions'], next)
  }

  const risky = permissions.filter(
    (p) => selected.includes(p.key) && p.level && p.level !== 'scoped',
  )

  return (
    <Card title="权限清单">
      {risky.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`已勾选 ${risky.length} 项需要额外注意的权限`}
          description={
            <span>
              {risky.map((p) => p.label).join('、')}
              ：部分权限需要用户在系统设置中单独授权，或在目标 Android 版本上已不再生效。悬停权限卡片上的标签可查看说明。
            </span>
          }
        />
      )}
      <PermissionGrid
        permissions={permissions}
        selected={selected}
        onToggle={toggle}
        onSelectAll={(on) =>
          setField(['android', 'permissions'], on ? permissions.map((p) => p.key) : [])
        }
      />
    </Card>
  )
}
