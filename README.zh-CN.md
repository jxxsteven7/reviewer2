# Reviewer 2

[English](README.md) | **简体中文**

**学术圈的在线多人聚会游戏合集。** 每人用自己的手机加入房间。有个昵称就能加入；推荐注册账号，可以保存头像和战绩。

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
- 账号可选：头像和战绩；见[隐私](#隐私)
- 比赛：连打几局计分，并授予称号
- 公开房间：用账号和陌生人一起玩，可以举报不守规矩的玩家

## 隐私

我们对玩家的承诺：

- **推荐注册，但不强制。** 输入昵称就能玩；注册账号后，头像、战绩和称号会一直保存。
- **密码**只存单向哈希，谁都读不出原文，运营者也不行。
- **账号的邮箱从不保存。** 服务器只存它的一个带密钥的指纹，用来核对邮箱和发送找回密码的邮件。
- **日志里没有 IP 地址和名字。** 统计只有数字：人数、房间数和国家。
- **建议**只有项目的运营者能看到，除非你同意把它公开成 GitHub issue：issue 里只有建议内容和你留的署名，不会有联系方式。联系方式按原样保存，90 天后删除。建议本身作为项目的建议存档永久保留。
- **公开房间里的举报**只有运营者能看到，和建议一样永久保留。举报会记下谁举报了谁、被举报者当时在房间里的名字、房间号和举报人填写的说明。
- **注销账号**会删掉它的全部数据，只有用它提过的建议、计入它的致谢、它发出的和针对它的举报会保留，但不再和账号关联；备份里的副本到期后也会消失。

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

本地运行不需要任何外部服务的密钥。要试邮件功能，把 `.env.example` 复制成 `.env`，再在 `npm run dev` 旁边运行 `npm run dev:mailer`：邮件只会打印出来，不会发送。其他命令、在手机上测试和环境变量见 [docs/development.md](docs/development.md)。

## 参与贡献

规则见 **[CONTRIBUTING.md](CONTRIBUTING.md)**（英文），简单说：

1. `main` 受保护：所有改动都从自己的分支或 fork 发 Pull Request。
2. 每个 PR 都要作者以外的人 review（维护者自己只改[给人读的文档](docs/rules/versioning.md#docs-for-people)的 PR 除外），通过且 CI 绿了之后由协作者合并。
3. 提交里不出现 AI 或 agent 署名。
4. 仓库内容使用英文；这份 README 是唯一的翻译文件。
5. 每个 PR squash 合并成一个提交；除了只改给人读的文档的 PR，都带版本号，见 [docs/rules/versioning.md](docs/rules/versioning.md)。

AI 助手读 `AGENTS.md`。

建议被采纳、贡献了词库或参与早期测试的玩家，会署名或以匿名方式列在 [ACKNOWLEDGMENTS.md](ACKNOWLEDGMENTS.md) 和首页最下方的致谢名单里。赞助者列在 [SPONSORS.md](SPONSORS.md) 里，首页最下方也有。

### 贡献词库

`words/` 下每个领域一个 JSON 文件，所有游戏共用。好的词条要短、领域内人人都认识，而且全部原创。见 [words/README.md](words/README.md)。

## 支持作者

Reviewer 2 免费、无广告。如果你喜欢，可以在首页底部用微信给作者点一杯可乐，或者在 [GitHub Sponsors](https://github.com/sponsors/jxxsteven7) 上赞助作者。

## 协议

代码使用 [MIT 协议](LICENSE)，`shared/src/han-variants.ts` 除外：它由 OpenCC 的数据生成，仍按 [Apache License 2.0](shared/LICENSE-OpenCC) 授权。`words/` 里的词库使用 [CC BY-SA 4.0](words/LICENSE)。

<!-- readme-sync: 4afd91665f02319dd76cf9a9d98b10e2a66cce9c60d6d18021611665f5e551d2 -->
