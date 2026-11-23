import React from 'react'
import ReactDOM from 'react-dom/client'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
// 仅引入 latin 子集：中文由系统字体（苹方/微软雅黑/思源黑体）回退，避免打包无用的西里尔、越南语字形
import '@fontsource/geist/latin-400.css'
import '@fontsource/geist/latin-500.css'
import '@fontsource/geist/latin-600.css'
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import { AppearanceProvider } from './store/appearance'
import './global.css'
import { AppRoot } from './App'
import { ConfigStoreProvider } from './store/config'

dayjs.locale('zh-cn')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppearanceProvider>
        <ConfigStoreProvider>
          <AppRoot />
        </ConfigStoreProvider>
    </AppearanceProvider>
  </React.StrictMode>,
)
