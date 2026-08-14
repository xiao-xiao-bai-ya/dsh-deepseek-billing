# dsh-deepseek-billing

DeepSeek Harness 的余额悬浮窗插件 —— 实时查看你的 DeepSeek API 账户余额，以及每一轮对话花了多少钱。

## 功能

- **可拖动的悬浮窗**：自由拖动，松手自动吸附到屏幕左右边缘。
- **折叠胶囊**：拖到边缘（或点「−」）自动缩成一个小胶囊，只显示余额。
- **固定形态**：点图钉固定后保持展开，拖到边也不自动缩小。
- **三行数据**：
  - 余额（当前，实时刷新）
  - 上次对话余额（上一轮结束时的定格值）
  - 本轮已花费（= 上次余额 − 当前余额）
- **低余额警示**：余额低于 ¥2 时数字变红。
- 附带 `deepseek_billing` 工具，agent 可自查（问「余额多少」直接回答）。

## 安装

1. 确保已配置 DeepSeek API Key（Web 设置页「模型」区，或 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`）。

2. 安装插件到 web profile：

   ```bash
   dsh plugin --profile web add @dsh-external/dsh-deepseek-billing
   ```

   或手动：在 `~/.dsh/profiles/web/package.json` 的 `dsh.profile.bundles` 里加入 `"@dsh-external/dsh-deepseek-billing"`，并把本包放到该 profile 的 `node_modules/@dsh-external/` 下。

3. 重启：

   ```bash
   dsh web
   ```

## 原理

- 每 15 秒调用 `GET https://api.deepseek.com/user/balance` 拉取余额（权威数据，零误差）。
- 连续 10 秒无模型调用判定「一轮结束」，那一刻的余额记为「上次对话余额」。
- 「本轮已花费」= 上次余额 − 当前余额，实时跳动。

不依赖 token 计价、不读会话历史，只关心一件事：钱。

## 依赖

`@deepseek-ai/dsh-*`（credentials / llm / subprocess / tools / host-webserver）+ `cordis-plugin-timer`，均由 dsh harness 提供。

## License

MIT
