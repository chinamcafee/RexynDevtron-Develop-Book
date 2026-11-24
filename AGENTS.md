# AGENTS.md — RexynDevtron-Develop-Book（电子书 / 文档仓库）

> 本文件是文档仓库的 AI 入口。两本 Docusaurus 电子书是**叙述层的事实源**：实现细节写在这里，各代码仓库的 `AGENTS.md` 只保留精简结论。

## 1. 仓库与分支（唯一例外）

- 独立 git 仓库：`origin` = `git@github.com:chinamcafee/RexynDevtron-Develop-Book.git`，**没有 upstream**。
- **允许直接在 `main` 上提交与推送**，不需要 `rexyn-dev`（这是全项目群唯一的例外）。
- 忽略：`node_modules/`、`build/`、`.docusaurus/`、`.cache-loader/`、日志与系统文件。

## 2. 两本书的分工

| 书 | 内容 | 目录 |
| --- | --- | --- |
| Tutorial-DevelopDevtron | 源码剖析与二次开发（含 RexynOps 定制机制） | `Tutorial-DevelopDevtron/docs` |
| Tutorial-CompileDeployDevtron | 编译、镜像、部署与验证 | `Tutorial-CompileDeployDevtron/docs` |

## 3. 文档与代码的同步契约

任何实现变更，按"先细节、后精简"两步走：

```text
1. 实现改动
2. 详细设计/原理/命令写进两本书对应章节（Develop 书优先）
3. 把结论、边界、验证命令大幅精简后回写到对应仓库的 AGENTS.md
```

不允许"下周补文档"。

## 4. 章节映射（常用）

| 变更点 | Develop 书 | Compile 书 |
| --- | --- | --- |
| 仓库增删 / 分支模型 | `overview`、`rexyn-branch-strategy` | `repos`、`branch-strategy` |
| Rexyn 定位 / 接口面 | `rexyn-positioning` | `architecture` |
| 后端 API / 错误码 | `devtron-api`、`backend-error-codes` | — |
| 业务域 / wire / 内置 chart | `devtron-domain`、`devtron-wire`、`devtron-inner-charts` | `workflow`、`deploy` |
| 微服务 | `repo-services` + `svc-*` | `build-services` |
| 前端 / 多语种 | `repo-dashboard`、`repo-fe-common-lib`、`dashboard-i18n` | `build-dashboard` |
| 迁移 / 通知 / 安装 / chart | `repo-migrator`、`repo-notifier`、`repo-inception`、`repo-charts` | `deploy`、`build-misc` |
| 运行时链路 | `runtime-callchain` | `architecture` |
| 构建 / 镜像清单 / 兼容矩阵 | — | `build-overview`、`appendix`、`compat-matrix` |

## 5. 新增或调整章节时

1. 在对应 `docs/*.md` 写内容，`id` 与文件名保持一致；
2. 更新 `sidebars.js`（分部分归类）；
3. 更新对应书的 `README.md` 目录清单；
4. 跑一次构建确认没有断链：

```bash
cd Tutorial-DevelopDevtron && npm run build
cd Tutorial-CompileDeployDevtron && npm run build
```

## 6. 写作约定

- 中文正文，代码/命令/字段名保留英文。
- 路径写成 `$ROOT/...` 或相对路径，不写个人机器绝对路径。
- 命令必须能直接复制执行；环境相关的 IP、密码用占位符并注明获取方式。
- 不复制大段源码；给文件路径 + 关键片段。
- 章节内用"结论先行"结构：先表格/短句给结论，再展开原因。

## 7. 不要做的事

- 不把"临时验证过程、失败尝试、临时路径"写进正文。
- 不在书里承诺未实现的能力；未完成项统一放"已知边界"。
- 不新建与既有章节重叠的内容，先搜索现有章节。
