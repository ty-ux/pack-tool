import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { App as AntApp, ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { createTheme } from '../theme'
import { api } from '../api'

export type ColorScheme = 'system' | 'light' | 'dark'
const Context = createContext<{ scheme: ColorScheme; dark: boolean; setScheme: (value: ColorScheme) => Promise<void> } | null>(null)

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [scheme, update] = useState<ColorScheme>(() => {
    const mode = document.documentElement.dataset.mode
    return mode === 'light' || mode === 'dark' ? mode : 'system'
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  const dark = scheme === 'dark' || (scheme === 'system' && systemDark)
  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)')
    const changed = () => setSystemDark(query.matches)
    query.addEventListener('change', changed)
    changed()
    return () => query.removeEventListener('change', changed)
  }, [])
  const setScheme = async (value: ColorScheme) => {
    await api.post('/api/preferences', { colorScheme: value })
    document.documentElement.dataset.mode = value
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', value === 'system' ? 'light dark' : value)
    update(value)
  }
  return <Context.Provider value={{ scheme, dark, setScheme }}>
    <ConfigProvider locale={zhCN} theme={createTheme(dark)}><AntApp>{children}</AntApp></ConfigProvider>
  </Context.Provider>
}

export function useAppearance() {
  const value = useContext(Context)
  if (!value) throw new Error('AppearanceProvider missing')
  return value
}
