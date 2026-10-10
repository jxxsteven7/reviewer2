# Reviewer 2

[English](README.md) | **简体中文**

**学术圈的在线多人聚会游戏合集。** 每人用自己的手机加入房间。有个昵称就能玩，账号是可选的。

## 这是什么

- **学术主题**：审稿、投稿、组会、基金、答辩。
- **共享词库**：按领域划分的学术术语，由社区贡献。
- **为同行而做**：不以盈利为目标，不放广告。

### 第一个游戏：团队猜词

两个课题组（红组、蓝组）围绕 25 个学术术语对战。每组的 PI 知道哪些牌属于自己组，但只能给出**一个简短的提示 + 一个数字**，学生们根据提示去翻牌。翻到无关论文或对方的牌，回合结束；翻到**二号审稿人**，当场被拒稿，本组直接判负。

暂名**双盲**（Double Blind），代码里的模块叫 `keywords`，规则见 [docs/games/keywords.md](docs/games/keywords.md)。

## 特点

- 中英双语
- **中国大陆**可玩：不用 Google 服务和公共 CDN
- 手机优先；能在微信里玩
- 锁屏断线后自动重连，回到原来的座位
- 服务器权威：队员即使打开开发者工具，也看不到未翻开牌的颜色
- 账号可选：头像、战绩，以及一个只用来找回密码、不保存的邮箱
- 比赛：连打几局计分，并授予称号

## 当前状态

🚧 早期开发。第一个游戏已在 <https://playreviewer2.com> 上线，你也可以自己运行一份（[本地运行](#本地运行)）。

## 技术栈

| 部分 | 选型 |
|---|---|
| 语言 | TypeScript，npm workspace |
| 前端 | Vue 3 + Vite，vue-i18n |
| 后端 | Node.js + Socket.IO |
| 存储 | 房间在内存里；反馈和账号在 SQLite（`node:sqlite`）里；头像存成文件 |
| 测试 | Vitest，端到端用 Playwright |
| 部署 | 一个 Node 进程、一个端口，外加一个小发信程序 |

## 目录结构

| 路径 | 内容 |
|---|---|
| `client/src/` | Vue 应用：`core/` 共用部分，`games/<game>/` 各游戏的界面，`locales/` 全部界面文字 |
| `server/src/` | 服务器：`core/` 房间，`games/<game>/` 各游戏的规则，`accounts/` 账号，`store/` 数据库 |
| `shared/` | 前后端共用的类型和规则 |
| `mailer/` | 发送账号邮件的程序 |
| `words/` | 词库，每个领域一个 JSON 文件 |
| `e2e/`、`scripts/`、`docs/` | 端到端测试、仓库检查脚本、文档 |

## 本地运行

需要 [Node.js](https://nodejs.org) 22.22.2 或更高（Node 24 需要 24.15 或更高），但不能是 23 或 25。

```bash
npm install   # also turns on the git hooks
npm run dev   # front end on http://localhost:5173, server on port 3000
```

其他命令、在手机上测试和环境变量见 [docs/development.md](docs/development.md)。

## 参与贡献

规则见 **[CONTRIBUTING.md](CONTRIBUTING.md)**（英文），简单说：

1. `main` 受保护：所有改动都从自己的分支或 fork 发 Pull Request。
2. 每个 PR 都要作者以外的人 review，通过且 CI 绿了之后由协作者合并。
3. 提交里不出现 AI 或 agent 署名。
4. 仓库内容使用英文；这份 README 是唯一的翻译文件。
5. 每个 PR squash 合并成一个带版本号的提交，见 [docs/rules/versioning.md](docs/rules/versioning.md)。

AI 助手读 `AGENTS.md`。

### 贡献词库

`words/` 下每个领域一个 JSON 文件，所有游戏共用。好的词条要短、领域内人人都认识，而且全部原创。见 [words/README.md](words/README.md)。

## 协议

代码使用 [MIT 协议](LICENSE)，`words/` 里的词库使用 [CC BY-SA 4.0](words/LICENSE)。

<!-- readme-sync: eb8f1dcf8e1d74cfc0a7392ea029bda55dbe348251489dee850f9a32dc32182d -->
