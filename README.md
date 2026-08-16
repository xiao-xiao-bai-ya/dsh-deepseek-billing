# DeepSeek 余额悬浮窗插件（dsh-deepseek-billing）

一个给 **DeepSeek Harness 网页版** 用的余额小插件。

装好之后，网页右上角会出现一个「DeepSeek 余额」悬浮窗，实时显示：

- 你的 DeepSeek API 余额
- 这个对话框开始时的余额（关页面再打开也不丢）
- 上一轮对话结束时的余额
- 本轮已经花了多少钱（**边生成边实时跳动**，不是等一轮结束才做余额减法）
- 余额低于 ¥2 时数字会变红提醒你充值

---

## 这个教程是给谁看的？

**完全不会编程、零基础的新手小白。**

你只需要会：

1. 复制/粘贴
2. 用记事本改一行字
3. 把文件夹复制到指定位置
4. 重启程序

不需要懂代码，不需要装额外软件（除了 DeepSeek Harness 本身）。

---

## 安装前你需要准备

1. **一台电脑**（下面以 Windows 为例，macOS / Linux 步骤类似）。
2. **已经装好 DeepSeek Harness（`dsh`）**，并且能正常打开网页版。
3. **DeepSeek API Key**：到 `platform.deepseek.com` 创建，并且已经在 Harness 里配置好（不会配置就先搞定这个，再装插件）。
4. **能打开 GitHub 的网**：只需要下载这一次；以后日常使用不需要。

---

## 第一步：下载插件

打开这个网址：

```
https://github.com/xiao-xiao-bai-ya/dsh-deepseek-billing
```

点击绿色的 **Code** 按钮 → 点 **Download ZIP**。

下载完成后，把 ZIP 解压，你会得到一个文件夹，里面有：

- `lib` 文件夹
- `package.json`
- `README.md`
- `LICENSE`
- 等文件

> 会一点点命令的人也可以用：`git clone https://github.com/xiao-xiao-bai-ya/dsh-deepseek-billing.git`

---

## 第二步：找到 Harness 的插件目录

打开 Windows 的 **文件资源管理器**，在顶部地址栏输入下面这行，然后回车（把 `你的用户名` 换成你电脑的用户名）：

```
C:\Users\你的用户名\.dsh\profiles\web\node_modules\@dsh-external\
```

你会看到里面可能已经有其他插件文件夹。

**如果里面已经有一个 `dsh-deepseek-billing` 文件夹**：

- 右键它 → 删除（或者改名成 `dsh-deepseek-billing-old` 备份，更保险）。

然后把第一步解压出来的那个文件夹，**整个复制**到这个 `@dsh-external` 目录里，并改名为：

```
dsh-deepseek-billing
```

最终你的路径应该是：

```
C:\Users\你的用户名\.dsh\profiles\web\node_modules\@dsh-external\dsh-deepseek-billing\
```

---

## 第三步：告诉 Harness 启用这个插件

用 **记事本** 打开这个文件：

```
C:\Users\你的用户名\.dsh\profiles\web\package.json
```

> 提示：右键这个文件 → 打开方式 → 记事本。

找到 `"dependencies"` 这一块。如果里面还没有这个插件，就加上一行：

```json
"dependencies": {
  "@dsh-external/dsh-deepseek-billing": "1.0.0"
}
```

再往下找 `"dsh"` → `"profile"` → `"bundles"` 这个数组，在里面加一行：

```json
"@dsh-external/dsh-deepseek-billing"
```

保存并关闭记事本。

> 如果你打开后发现里面**已经有** `dsh-deepseek-billing` 这几个字，就不用重复加了，直接保存即可。

---

## 第四步：重启

完全退出 DeepSeek Harness，再重新打开网页版。

打开任意一个对话框，网页右上角应该出现 **「DeepSeek 余额」** 悬浮窗。

---

## 怎么使用

| 你想做的事 | 怎么做 |
|---|---|
| 看当前余额 | 看悬浮窗第一行 |
| 看这个对话框开始时的余额 | 看第二行「对话框开始余额」 |
| 手动刷新余额 | 点悬浮窗右上角的 **↻** 按钮 |
| 拖动悬浮窗 | 按住悬浮窗空白处拖动，松手自动吸附到屏幕左右边缘 |
| 收起来 | 点「−」，会缩成一个小胶囊，只显示余额 |
| 展开 | 点一下小胶囊 |
| 固定不收起 | 点图钉，拖动到边缘也不会自动缩小 |

**「对话框开始余额」的小秘密**：只要你没有删除这个对话框，哪怕关掉页面、重新打开，它都还记得这个对话框刚开始时的余额。

---

## 常见问题（先看这里）

**1. 右上角没有悬浮窗？**

- 检查第三步：`package.json` 里的 `bundles` 是否加对了。
- 检查是不是没有重启。
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

**4. 余额显示 `—`？**

还没拉到第一次数据，等几秒，或者点一下 ↻ 刷新。

**5. 以后怎么更新插件？**

重新下载新版本 → 覆盖第二步的 `dsh-deepseek-billing` 文件夹 → 重启 Harness。

---

## 给会一点技术的人

- 结构：`lib/index.js` = Host 端，`lib/client.js` = 网页端。
- 本轮花费：`llm/stream` 按 token 实时计价（内置平峰/峰谷价目表，`usage` 到达后自动替换为精确值）。
- 数据文件：`~/.dsh/storages/deepseek-billing.json`
- 接口：
  - HTTP：`/_dsh/deepseek-billing/snapshot?sessionId=xxx&refresh=1`
  - WebSocket：`/_dsh/deepseek-billing/ws`（实时推送）
- 依赖：`ws`（npm 公共包）+ `@deepseek-ai/dsh-*`（Harness 自带，peer 依赖）

## License

MIT
