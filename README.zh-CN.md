# Reviewer 2

[English](README.md) | **简体中文**

**学术圈的在线多人聚会游戏合集。** 在浏览器里玩，每人用自己的手机或电脑加入同一个房间。输入昵称就能进，不用注册。

## 这是什么

- **学术主题**：游戏围绕审稿、投稿、组会、基金申请、答辩这些圈内日常设计。只做学术版，不做通用版。
- **共享词库**：核心是一套按领域划分的学术术语词库，由社区贡献，所有游戏共用。
- **为同行而做**：不以盈利为目标，不放广告。

### 第一个游戏：团队猜词

两个课题组（红组、蓝组）围绕 25 个学术术语对战。每组的队长知道哪些牌属于自己组，但只能给出**一个词 + 一个数字**作为提示，组里其他人根据提示去翻牌。翻到无关论文或对方的牌，回合结束；翻到**二号审稿人**，当场被拒稿，本组直接判负。项目名就是这么来的。

游戏暂名**双盲**（Double Blind），代码里的模块叫 `keywords`，完整规则见 [docs/games/keywords.md](docs/games/keywords.md)。

## 特点

- 中英双语界面
- 全球可玩，**包括中国大陆**：不用任何 Google 服务，不用公共 CDN，字体、脚本、图标全部自托管
- 手机优先，能在微信内置浏览器里玩
- 手机锁屏或浏览器切到后台断线后自动重连，回到原来的房间、队伍和角色
- 服务器权威，按角色过滤数据：队员即使打开浏览器开发者工具，也看不到未翻开牌的颜色

## 当前状态

🚧 早期开发中。第一个游戏已经可以在本地运行后玩（见[本地运行](#本地运行)），但还没有上线。上线后的地址是 <https://playreviewer2.com>。

第一版包括：游戏大厅、创建和加入房间、选队伍和角色、队长和队员两种视角、投屏视图、实时同步、断线自动重连、中英双语界面、默认的"学术圈通用"词库和校验脚本，以及"再来一局"。

## 技术栈

| 部分 | 选型 |
|---|---|
| 语言 | TypeScript，前后端统一，使用 npm workspaces |
| 前端 | Vue 3 + Vite，vue-i18n |
| 后端 | Node.js + Socket.IO |
| 存储 | 房间状态放在服务器内存里，第一版没有数据库 |
| 测试 | Vitest，端到端测试用 Playwright |
| 部署 | 一个 Node 进程同时提供前端静态文件和 WebSocket，一个域名、一个端口 |

## 目录结构（规划中）

| 路径 | 内容 |
|---|---|
| `client/src/core/` | 前端公共层：连接、房间、大厅、i18n |
| `client/src/games/` | 各个游戏的界面，如 `keywords/` |
| `client/src/locales/` | `zh.json` 和 `en.json` |
| `server/src/core/` | 后端公共层：房间管理、玩家身份、连接 |
| `server/src/games/` | 各个游戏的规则和状态 |
| `shared/` | 前后端共用的类型定义 |
| `words/` | 词库，每个领域一个 JSON 文件 |
| `docs/` | 文档和项目规则 |

## 本地运行

需要 [Node.js](https://nodejs.org) 22.13 或更高版本，但不能是 23 或 25（测试框架不支持这两个版本）。CI 使用 24 LTS。

```bash
npm install   # also turns on the git hooks
npm run dev   # front end on http://localhost:5173, server on port 3000
```

`npm run build && npm start` 在同一个端口 <http://localhost:3000> 上运行生产构建。其他命令、在手机上测试、在生产环境运行和环境变量见 [docs/development.md](docs/development.md)。

## 参与贡献

欢迎贡献代码、词库和想法。完整规则见 **[CONTRIBUTING.md](CONTRIBUTING.md)**（英文），核心规则如下：

1. **`main` 受保护**：任何人（包括维护者）都不直接提交或推送 `main`，所有改动都通过 Pull Request 合入。
2. **在自己的分支上开发**：项目成员用 git worktree 加独立分支。外部贡献者 fork 本仓库，在自己 fork 的分支上开发。
3. **所有代码都必须 review**：无论是人写的还是 AI 写的、成员的还是外部贡献者的，都要作者以外的人 approve 后才能合并。
4. **提交里不出现 AI 或 agent 署名**：提交者本人对提交的内容负责。
5. **仓库内容使用英文**：代码、注释、提交信息、文档和规则都用规范的英文。这份中文 README 是唯一的翻译文档，CI 会检查它和英文版保持同步。
6. **每个 PR 都 squash 合并并带版本号**：合入 `main` 后是一个标题为 `vX.Y.Z <type>: <summary>` 的提交。每个 PR 由 CI 自动把小版本号加一，中版本和大版本由维护者决定。详见 [docs/rules/versioning.md](docs/rules/versioning.md)。

用 Codex 或 Claude Code 开发时，它们会自动读取 `AGENTS.md` 和 `CLAUDE.md`，按同一套规则工作。规则文件在 `docs/rules/` 下，可以在对话里用 `@` 引用，例如 `@docs/rules/review.md`。

### 项目成员

每项工作开一个 worktree 和分支，主目录始终停在 `main`：

```bash
git fetch origin
git worktree add ../fix-reconnect -b fix/reconnect origin/main
cd ../fix-reconnect
# edit and commit, then:
git push -u origin fix/reconnect
```

然后在 GitHub 上发起 Pull Request，等待 review。目录布局、本地 hook、合并后清理等细节见 [docs/rules/git.md](docs/rules/git.md)。

### 外部贡献者（fork）

1. 在 GitHub 上 **Fork** 本仓库。
2. 克隆你的 fork，把本仓库添加为 `upstream`，然后从最新的上游 `main` 新建分支：

   ```bash
   git clone git@github.com:<your-username>/reviewer2.git
   cd reviewer2
   git remote add upstream https://github.com/jxxsteven7/reviewer2.git
   git fetch upstream
   git switch -c fix/lobby-typo upstream/main
   ```

3. 提交改动并推送到你的 fork：`git push -u origin fix/lobby-typo`。
4. 在本仓库向 `main` 发起 Pull Request，按模板填写。
5. 维护者 review。后续修改继续推送到同一个分支即可。PR 通过后由维护者合并。

大的改动请先开 Issue 讨论。

### 贡献词库

`words/` 目录下的词库由所有游戏共用，每个学术领域一个 JSON 文件。好的词条要短，而且领域内人人都认识，比如"注意力""收敛""基线""泛化"。词库 PR 改 `words/` 下的文件，改了格式时也一起改 `scripts/check-words.mjs` 和它的测试；和其他 PR 一样需要 review。格式、选词标准以及各个游戏怎么使用词库，见 [words/README.md](words/README.md)。

所有词条必须原创，不得使用任何商业桌游的官方词表。

## 协议

仓库公开前会补上协议文件，计划代码使用 MIT，词库使用 CC BY-SA 4.0。

<!-- readme-sync: 1708f2b69e7bb774c04c3bded29636ffa116b8291e48f53b731dd32e7c981c35 -->
