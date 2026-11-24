# RexynDevtron-Develop-Book

RexynOps 定制版 Devtron 的两本电子书，作为一个整体仓库维护。

| 书 | 目录 | 内容 |
| --- | --- | --- |
| 《Devtron 源码剖析与二次开发》 | `Tutorial-DevelopDevtron/` | 按仓库拆解 Devtron 生态、二次开发切入点、Rexyn 定位与分支策略 |
| 《Devtron 编译 + 本地部署》 | `Tutorial-CompileDeployDevtron/` | 从 fork 到 13 个镜像、k3s 集群、Helm 部署与日常迭代 |

## 本地预览

```bash
cd Tutorial-DevelopDevtron        # 或 Tutorial-CompileDeployDevtron
npm install                       # 首次
npm start                         # http://localhost:3000
npm run build                     # 产物在 build/
```

两本书均使用 **Docusaurus 3.10.2**（Node ≥ 18）。

## 与其他仓库的关系

本仓库是 `DevtronProjects` 项目群的**叙述层**；事实层（仓库清单、`rexyn-dev` 基线、镜像与前缀约定、文档同步契约）在项目群根目录的 `PROJECT-GROUP-MEMORY.md`。

- 代码仓库：`devtron`、`devtron-services`、`dashboard`、`devtron-fe-common-lib`、`inception`、`migrator`、`notifier`、`charts`、`kubectl`、`dex`、`chart-versions-fix`（均为 `rexyn-dev` 分支）
- 自建镜像统一前缀：`rexyn-devtron/*`
- 本仓库**没有 upstream**，直接提交 `main` 即可（分支规则的唯一例外）

## 文档同步契约

任何代码仓库的 `rexyn-dev` 有重要变更（新增 API、改业务域、加迁移、换镜像、改分支模型、Rexyn 接口面变化），必须同批更新：

1. `PROJECT-GROUP-MEMORY.md`（事实层）
2. 两本书对应章节（叙述层，映射表见 `PROJECT-GROUP-MEMORY.md` 第六节）

不允许"下周补文档"。
