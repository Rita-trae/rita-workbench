# Rita 工作台 APP 化 — 实施任务清单

## 概览

| 编号 | 任务 | 优先级 | 状态 |
|------|------|--------|------|
| T1 | 数据同步层：封装存储适配层 | high | pending |
| T2 | Supabase 表结构与初始化脚本 | high | pending |
| T3 | 接入 app.js 数据读写，替换 localStorage 直连 | high | pending |
| T4 | 离线队列与自动同步 | medium | pending |
| T5 | Electron 主进程与配置 | high | pending |
| T6 | electron-builder 打包配置与脚本 | high | pending |
| T7 | 公网部署准备（git + GitHub Pages 配置） | medium | pending |
| T8 | 依赖安装与 Linux 包构建验证 | high | pending |
| T9 | 端到端验证：PWA 安装、数据同步、桌面启动 | high | pending |

---

## Task 1: 数据同步层 — 存储适配层

**目标**：创建 `sync.js`，统一数据读写接口，内部同时支持 localStorage 与 Supabase。

**范围**：
- 新建 `/workspace/sync.js`
- 导出 `loadStore()` / `saveStore(data)` 接口，签名与现有一致
- 内部判断是否配置了 Supabase 凭据（从 `config.js` 或环境变量读取）
- 未配置凭据时走 localStorage（保持现有行为）
- 配置凭据时走 Supabase，并保留 localStorage 作为离线缓存

**测试要求**：
- **rule**：未配置凭据时，`loadStore()` 从 localStorage 读取，行为与改造前一致。
- **rule**：`saveStore(data)` 在无凭据时写入 localStorage，不报错。

**依赖**：无

---

## Task 2: Supabase 表结构与初始化脚本

**目标**：定义云端数据结构，提供初始化 SQL 与配置文件模板。

**范围**：
- 新建 `/workspace/supabase/schema.sql`：创建 `rita_app_data` 表（`id`, `user_device`, `data` jsonb, `updated_at`）
- 新建 `/workspace/config.js`：读取 Supabase URL/anon key（留空占位，用户填入）
- 新建 `/workspace/.env.example`：示例环境变量

**测试要求**：
- **rule**：`schema.sql` 语法合法，可在 Supabase SQL Editor 中直接执行。
- **rule**：`config.js` 提供 `getSupabaseConfig()` 函数，无凭据时返回 null。

**依赖**：无

---

## Task 3: 接入 app.js 数据读写

**目标**：将 app.js 中直接调用 `localStorage` 的地方改为通过适配层。

**范围**：
- 修改 `/workspace/app.js`：`import` 或全局加载 `sync.js`
- `loadStore()` / `saveStore()` 改为调用适配层对应方法
- 确保 `sessionStorage` 缓存（新闻热点）保持不变
- 在 `index.html` 中引入 `sync.js`（在 app.js 之前）

**测试要求**：
- **rule**：未配置凭据时，app.js 所有功能正常（喝水、健身、宝宝喂养等读写无报错）。
- **rule**：浏览器控制台无 localStorage 未定义或同步层相关错误。

**依赖**：T1, T2

---

## Task 4: 离线队列与自动同步

**目标**：实现离线时本地修改入队，联网后自动同步到云端。

**范围**：
- 在 `sync.js` 中增加 `syncQueue`（localStorage 存储待同步的数据快照）
- `saveStore()` 时：尝试推送云端，失败则写入队列
- 监听 `online` 事件，恢复网络时 flush 队列
- 应用启动时：先从云端拉取最新数据合并，再 flush 队列
- 合并策略：比较 `updated_at`，取最新

**测试要求**：
- **rule**：断网后调用 `saveStore()` 不抛异常，数据写入本地队列。
- **rule**：恢复网络后，队列数据自动推送到云端（模拟可通过 mock fetch）。

**依赖**：T1, T2, T3

---

## Task 5: Electron 主进程与配置

**目标**：创建 Electron 桌面应用壳，加载现有网页。

**范围**：
- 新建 `/workspace/electron/main.js`：创建 BrowserWindow，加载 `index.html`
- 新建 `/workspace/electron/preload.js`：暴露安全的 IPC（如需）
- 新建 `/workspace/package.json`：声明 `electron`、`electron-builder` 依赖，`main` 指向 `electron/main.js`
- 配置窗口：宽度 1280x800，最小尺寸，标题 "Rita 工作台"

**测试要求**：
- **rule**：`npm install` 后 `npm run electron` 可启动桌面窗口并加载页面。
- **rule**：桌面窗口中应用功能正常（数据读写、UI 渲染）。

**依赖**：无（可与 T1-T4 并行）

---

## Task 6: electron-builder 打包配置与脚本

**目标**：配置打包，产出 Linux 包，并提供 Win/Mac 构建脚本。

**范围**：
- 在 `package.json` 中配置 `build` 字段（electron-builder）：
  - `appId: com.rita.workbench`
  - `productName: Rita工作台`
  - `linux`: target AppImage + deb, icon 用 icon-512.png
  - `win`: target nsis, icon
  - `mac`: target dmg
- 提供脚本：`dist:linux`、`dist:win`、`dist:mac`
- 生成各平台图标（用 icon-512.png 转换）

**测试要求**：
- **rule**：`npm run dist:linux` 在沙箱内成功产出安装包文件。
- **rule**：`package.json` 中 `dist:win` / `dist:mac` 脚本存在且语法正确。

**依赖**：T5

---

## Task 7: 公网部署准备

**目标**：准备 GitHub Pages 部署所需的 git 仓库与配置。

**范围**：
- 初始化 git 仓库，创建 `.gitignore`（node_modules, dist, .env）
- 新建 `deploy.sh`：构建并推送到 `gh-pages` 分支的脚本
- 或提供 Vercel/Netlify 一键部署配置（`vercel.json` / `netlify.toml`）
- 更新部署说明（在 README 或注释中）

**测试要求**：
- **rule**：`git init` 成功，`.gitignore` 正确忽略 `node_modules` 和 `dist`。
- **rule**：`deploy.sh` 脚本语法正确，包含推送 gh-pages 分支的逻辑。

**依赖**：T6（打包后的 dist 目录需被忽略或正确处理）

---

## Task 8: 依赖安装与 Linux 包构建验证

**目标**：实际安装依赖并构建 Linux 包，验证可交付。

**范围**：
- 执行 `npm install`
- 执行 `npm run dist:linux`
- 检查产物（AppImage/deb 文件存在）
- 启动应用验证窗口加载

**测试要求**：
- **rule**：`npm install` 成功无致命错误。
- **rule**：`dist/` 目录下存在 Linux 安装包文件。
- **rule**：安装包可启动（沙箱内用 `--no-sandbox` 验证或检查二进制）。

**依赖**：T6

---

## Task 9: 端到端验证

**目标**：验证 PWA 安装、数据同步回退、桌面启动三大场景。

**范围**：
- PWA：本地 HTTP 服务访问，验证 manifest 可加载、SW 注册成功
- 数据同步：未配置凭据时 localStorage 模式正常；mock 配置后走云端分支
- 桌面：Electron 开发模式启动验证

**测试要求**：
- **rule**：`http://localhost:8000/manifest.json` 返回 200 且内容正确。
- **rule**：浏览器控制台显示 Service Worker 注册成功。
- **rule**：未配置 Supabase 凭据时，应用所有数据读写功能正常。
- **rubric**（1-5，阈值 3）：桌面应用启动到可交互的流畅度。

**依赖**：T1-T8
