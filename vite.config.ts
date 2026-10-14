import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  /**
   * GitHub Pages 的项目站点地址是 https://<用户名>.github.io/lure-assistant/，
   * 静态资源必须带上 /lure-assistant/ 前缀，所以打包（production）时设置 base。
   *
   * 开发（npm run dev）和单元调试仍用 '/'：这样 http://localhost:5173/
   * 直接就是首页，不用手动敲子路径，热更新和各种工具链的相对路径也不受影响。
   *
   * 注意：`npm run preview` 属于 production 模式，同样会带 /lure-assistant/ 前缀，
   * 访问时要打开 http://localhost:4173/lure-assistant/。
   */
  base: mode === 'production' ? '/lure-assistant/' : '/',
}))
