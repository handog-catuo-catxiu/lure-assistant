import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
// 首页列表媒体框的公共尺寸定义，必须全局只加载一次（见文件内注释）
import './components/mediaFrame.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
