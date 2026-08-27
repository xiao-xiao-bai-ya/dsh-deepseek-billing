# DeepSeek 余额悬浮窗插件（dsh-deepseek-billing）

一个给 **DeepSeek Harness 网页版** 用的余额小插件。

装好之后，网页右上角会出现一个「DeepSeek 余额」悬浮窗：

- 你的 DeepSeek API 余额
- 这个对话框开始时的余额（关页面再打开也不丢）
- 上一轮对话结束时的余额
- 本轮已经花了多少钱（**边生成边实时跳动**，不是等一轮结束才做余额减法）
- 上一轮花了多少钱（停止思考后「本轮」归零，但「上轮花费」会保留）
- 余额低于 ¥2 时数字会变红提醒你充值
- 点「**更多**」展开**用量明细**：每一轮提问一行，列出时间、你的提问内容、模型、产品端、花费，支持「今天 / 7 天 / 30 天 / 自定义日期段」筛选

---

## 安装前你需要准备

1. **一台电脑**（下面以 Windows 为例，macOS / Linux 步骤类似）。
2. **已经装好 DeepSeek Harness（`dsh`）**，并且能正常打开网页版。
3. **DeepSeek API Key**：到 `platform.deepseek.com` 创建，并且已经在 Harness 里配置好。
4. **装了 pnpm**（`npm install -g pnpm`）——`dsh plugin` 命令本质上是把参数转交给 profile 目录里的 pnpm 执行。

---

## 安装：一行命令

> 标准安装方式就是 DSH 官方的 `dsh plugin` 命令。它会在 profile 目录里执行 `pnpm add`，
> 并自动把声明了 `dsh.bundle.patch` 的插件写进 bundles 列表——**不需要手改任何文件**。

按你的来源三选一，在命令行里执行：

**方式 A：从 GitHub 装（推荐）**

```
dsh plugin --profile web add github:xiao-xiao-bai-ya/dsh-deepseek-billing
```

> 需要能访问 GitHub。国内网络不通时，先给 git 配好代理，或者改用方式 B。

**方式 B：从本地文件夹装（下载 ZIP 或 git clone 之后）**

先把仓库下载并解压到任意位置，例如 `C:\Users\你的用户名\Downloads\dsh-deepseek-billing`，然后：

```
dsh plugin --profile web add C:\Users\你的用户名\Downloads\dsh-deepseek-billing
```

> 本地方式是 `link:` 活链接：以后想更新插件，直接覆盖这个文件夹里的文件再重启 DSH 就行，
> 不用重新执行命令。

**方式 C：从 npm 装（已发布 npm 的版本）**

```
dsh plugin --profile web add @dsh-external/dsh-deepseek-billing
```

**装完重启 DSH**，打开任意对话框，网页右上角出现「DeepSeek 余额」悬浮窗即成功。

> 首次对一个新 profile 执行 `dsh plugin` 会自动初始化该 profile。

### 这条命令做了什么（透明化）

1. 在 `~/.dsh/profiles/web/`（或你的 DSH 安装对应的 profile 目录）里执行 `pnpm add <来源>`；
2. pnpm 把插件写进 `package.json` 的 `dependencies`（本地路径用 `link:`，npm/git 包正常下载）；
3. `dsh plugin` 检查安装好的包有没有声明 `dsh.bundle.patch`，有就自动加进 `dsh.profile.bundles`——这就是旧教程里「手动改 package.json 加 bundles」那一步，现在命令自动完成；
4. 插件声明的 DSH 核心包全部放在 `peerDependencies` 里，profile 配了 `autoInstallPeers: false`，**不会**产生第二份核心代码。

### 卸载 / 更新

```
dsh plugin --profile web remove @dsh-external/dsh-deepseek-billing   # 卸载
dsh plugin --profile web add github:xiao-xiao-bai-ya/dsh-deepseek-billing   # 更新（重跑 add 即可）
```

---

## 怎么使用

| 你想做的事 | 怎么做 |
|---|---|
| 看当前余额 | 看悬浮窗第一行 |
| 看这个对话框开始时的余额 | 看第二行「对话框开始余额」 |
| 看上一轮花了多少钱 | 看「上轮花费」那一行 |
| 看每一轮提问花了多少钱 | 点右上角「**更多**」展开用量明细 |
| 用量明细按时间筛选 | 点「今天 / 7天 / 30天」，或用日期框自定义时间段 |
| 手动刷新余额 | 点悬浮窗右上角的 **↻** 按钮 |
| 拖动悬浮窗 | 按住悬浮窗空白处拖动，松手自动吸附到屏幕左右边缘 |
| 收起来 | 点「−」，会缩成一个小胶囊，只显示余额 |
| 展开 | 点一下小胶囊 |
| 固定不收起 | 点图钉，拖动到边缘也不会自动缩小 |

### 用量明细长什么样

每一轮对话（从你发出提问到模型停止思考）汇总成一行：

| 列 | 含义 |
|---|---|
| 时间 | 这一轮开始的时间 |
| 使用记录 | 你当时的提问内容（超长截断，悬停看全文） |
| 模型名称 | 这一轮用到的模型（多个模型会用「+」连起来） |
| 产品端 | 固定为 DSH |
| 花费 | 这一轮实际花的钱（按 token 实时计价汇总），底部有合计 |

> 口径说明：明细里一轮的花费 = 这一轮所有 **DeepSeek 系模型**调用的实际费用总和（含上下文压缩、生成会话标题等辅助调用，如果它们发生在这一轮内）。辅助调用单独发生时不产生行。**非 DeepSeek 模型（如 GLM）也会记录一行用量（时间/提问/模型/产品端），但没有价目表，花费显示 `—`**。历史数据从安装本版本起开始积累。

**「对话框开始余额」的小秘密**：只要你没有删除这个对话框，哪怕关掉页面、重新打开，它都还记得这个对话框刚开始时的余额。

---

## 常见问题（先看这里）

**1. 右上角没有悬浮窗？**

- 确认 `dsh plugin add` 执行成功且**重启过** DSH。
- 按 `F12` 打开浏览器开发者工具 → 点 `Console`，看有没有这行字：
  `[deepseek-billing] client slot registered`
  有 = 插件已加载；没有 = 插件没被启用。

**2. 显示「未配置 DEEPSEEK_API_KEY」？**

去 Harness 的设置里配置 DeepSeek API Key，配置完重启。

**3. 显示「余额获取失败（悬停看原因）」？**

把鼠标悬停在红色提示上，会显示具体原因。通常是：
- API Key 不对
- 网络连不上 DeepSeek 服务器
- 触发了限流（等一会儿再点 ↻）

**4. 用量明细是空的？**

明细从本版本起才开始记录，刚装上时是正常的；聊几轮再点开看。

**5. 余额显示 `—`？**

还没拉到第一次数据，等几秒，或者点一下 ↻ 刷新。

**6. 以后怎么更新插件？**

本地 link 方式：覆盖插件文件夹里的文件 → 重启 DSH。
npm/git 方式：重跑一遍 `dsh plugin --profile web add <同一来源>`。

---

## 附录：手动安装（不推荐，仅当 `dsh plugin` 命令不可用时）

> 旧版教程的方式。效果与一行命令完全一样，只是每步都靠手动。

1. 下载并解压仓库 ZIP，把文件夹整个复制到 `C:\Users\你的用户名\.dsh\local-plugins\`（没有就新建），文件夹名保持 `dsh-deepseek-billing`；
2. 用记事本打开 `C:\Users\你的用户名\.dsh\profiles\web\package.json`（老安装位置是 `C:\Users\你的用户名\.dsh-install\profiles\web\package.json`），在 `dependencies` 里加：
   ```json
   "@dsh-external/dsh-deepseek-billing": "link:../../local-plugins/dsh-deepseek-billing"
   ```
3. 在同一文件 `dsh.profile.bundles` 数组里加一行 `"@dsh-external/dsh-deepseek-billing"`；
4. 在 profile 目录执行 `pnpm install`，然后重启 DSH。

> 不要把插件放进 `node_modules/@dsh-external/`——手动放会让 pnpm 报 `Symlink path is the same as the target path`。

---

## 给会一点技术的人

- 结构：`lib/index.js` = Host 端，`lib/client.js` = 网页端（原生 `React.createElement`，无构建步骤）。
- 本轮花费：`llm/stream` 按 token 实时计价（内置平峰/峰谷价目表，`usage` 到达后自动替换为精确值）。
- 用量明细：每轮结束（静默 3 秒判定）聚合一行写入账本；prompt 取本轮请求里最后一条含 text 的 user 消息，截断 120 字符；`purpose` 为 `compaction`/`session-title` 的辅助调用不产生行；**只有 DeepSeek 系模型（provider/model 含 deepseek）折算费用，其他模型 cost 为 null 显示 `—`**，「产品端」列显示 provider。
- 数据文件：`~/.dsh/storages/deepseek-billing.json`（账本 version 4：`dialogStarts` + `usage`，上限 2000 条）。
- 接口：
  - HTTP：`/_dsh/deepseek-billing/snapshot?sessionId=xxx&refresh=1`
  - HTTP：`/_dsh/deepseek-billing/usage?from=<epoch ms>&to=<epoch ms>`（返回 `{records, total, currency}`，records 按时间倒序）
  - WebSocket：`/_dsh/deepseek-billing/ws`（实时推送余额快照）
- 打包：DSH 核心包全部声明在 `peerDependencies`，第三方依赖只有 `ws`；`dsh.bundle.patch` 指向 `cordis.patch.yml`——与 dsh-find-plugin、dsh-better-sidebar 等主流插件同一写法，`dsh plugin add` 可自动识别。
- 依赖：`ws`（npm 公共包）+ `@deepseek-ai/dsh-*`（Harness 自带，peer 依赖）。

### 本地开发（link 安装）的依赖解析与防坑

**原理**：`dsh plugin --profile web add <本仓库绝对路径>` 装的是 `link:`（junction），Node 从插件**真实路径**（本仓库）向上解析依赖，天然走不到 DSH 主安装的依赖树——会报 `Cannot find package '@deepseek-ai/dsh-tools'`。

**解法**：跑一次 `scripts/dev-setup.ps1`。它在 `repo\node_modules` 里建 junction 指向 DSH 主安装的嵌套依赖树（`npm root -g` 下 `@deepseek-ai\dsh\node_modules`）。这与 DSH 自带的 `$DSH_HOME/profiles/node_modules` 回退层是同一机制：Node 按 realpath 解析，插件与宿主共享同一物理实例，**不会**出现双副本（双副本正是当年 Symbol 错乱、工具全崩的根源——凡是物理复制一份核心包的安装方式都会复发）。

**三条纪律**：
1. **不要在本仓库里跑 `pnpm install`**——它会把 junction 覆盖/混入物理副本（`.npmrc` 的 `auto-install-peers=false` 只挡住 peer 包，`ws` 这类真依赖仍会被装成实体）。误跑之后：删掉 `node_modules`，重跑 `dev-setup.ps1`。
2. 全局 `dsh` 升级后，junction 指向的路径不变（同一安装目录），一般无需重跑；若再报 `Cannot find package`，重跑 `dev-setup.ps1` 自愈（脚本自带 import 自检）。
3. 从 GitHub/npm 正常安装（非 link）的用户**不需要**以上任何步骤——pnpm 会把插件装进 profile 目录内，`$DSH_HOME/profiles/node_modules` 回退层自动满足 peer 解析。

## License

MIT
