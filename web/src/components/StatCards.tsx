interface StatItem {
  label: string
  value: string
  accent?: 'cobalt' | 'success'
  mono?: boolean
}

export function StatCards({ items }: { items: StatItem[] }) {
  return (
    <div className="stat-grid">
      {items.map((it) => (
        <div className="stat-card" key={it.label}>
          <div className="stat-label">{it.label}</div>
          <div
            className={`stat-value${it.mono ? ' mono' : ''}${it.accent ? ` ${it.accent}` : ''}`}
            title={it.value}
          >
            {it.value}
          </div>
        </div>
      ))}
    </div>
  )
}
