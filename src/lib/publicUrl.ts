/**
 * 把 public/ 目录下的「站点根路径」转换成真正能请求到的地址。
 *
 * 背景：品牌 Logo（src/data/brands.ts 的 logo.path）和图鉴照片
 * （CatalogPhoto.path）都按 `/brand-logos/daiwa.svg`、`/catalog/xxx.jpg`
 * 这种以 / 开头的写法登记 —— 这种写法读起来直观，scripts/check-brand-logos.mjs
 * 也是按它去 public/ 下找文件的，不要改。
 *
 * 但部署到子路径以后（GitHub Pages 是 https://<用户名>.github.io/lure-assistant/），
 * `/brand-logos/daiwa.svg` 会被解析到站点根目录 `https://<用户名>.github.io/...`，
 * 图片全部 404 —— 而且 <img> 会静默失败，只看到碎图或空白，很难查。
 * 所以渲染前必须补上 Vite 的 base 前缀（本地开发时 base 是 '/'，等于原样返回）。
 *
 * 已经是完整网址（http/https、协议相对 //）或 blob:/data: 的一律原样返回：
 * 用户上传的照片是 blob: 地址，以后若接 CDN 外链也不该被改写。
 */
export function publicUrl(path: string | null | undefined): string | null {
  if (!path) return null
  if (/^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(path)) return path
  if (path.startsWith('data:') || path.startsWith('blob:')) return path

  // BASE_URL 一定以 / 结尾（'/' 或 '/lure-assistant/'），path 开头的 / 要去掉
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}
