---
id: intro
title: 这本书怎么用
sidebar_position: 1
slug: /intro
---

# 这本书怎么用

## 它解决什么问题

Devtron 的官方文档告诉你"怎么用"，但很少告诉你"它内部长什么样、我要改一个功能该动哪里"。当你想要：

- 给 Devtron 加一个 API
- 在控制台加一个页面
- 改 CI 流水线的构建逻辑
- 换掉某个微服务的实现
- 搞清楚一次"部署"到底经过了哪些组件

官方文档基本帮不上忙，只能读源码。而 Devtron 有 11 个仓库（8 个核心 + 3 个周边）、20 万行代码，直接跳进去很容易迷路。

这本书的作用是**先给你地图，再带你走几条主干道**。

## 组织方式：一个仓库一章

每一章的结构固定为四段：

| 段落 | 回答的问题 |
| --- | --- |
| **它是什么** | 这个仓库在 Devtron 生态里扮演什么角色 |
| **代码长什么样** | 目录结构、关键包、核心类型 |
| **它怎么跟别人协作** | 上下游是谁、用什么协议、数据往哪流 |
| **我要改它，从哪下手** | 常见二次开发场景的入口文件 |

## 阅读顺序建议

```text
必读（所有人）      全景 → 运行时调用链
后端开发             repo-devtron → devtron-api → devtron-domain → devtron-wire
                    → 按需看 devtron-services 各章
前端开发             repo-dashboard → repo-fe-common-lib
平台/运维            repo-inception → repo-migrator → repo-charts
写代码之前           recipes（实战配方）→ dev-workflow（本地调试）
```

## 前置知识

- Go：能看懂 `wire` 生成的代码、理解 `interface` + 构造函数注入
- React/TypeScript：能看懂 hooks 与路由
- Kubernetes：知道 Deployment / CRD / Operator 是什么
- 最好先跟着配套电子书《Devtron 编译 + 本地部署》把环境跑起来，边读边验证

## 一个约定

书里所有路径都相对于你的本地工作目录：

```bash
export ROOT=$HOME/InnovationProjects/DevtronProjects
```

```text
$ROOT/devtron/                  ← 核心仓库
$ROOT/devtron-services/         ← 微服务 monorepo
$ROOT/dashboard/                ← 前端
$ROOT/devtron-fe-common-lib/    ← 前端公共库
$ROOT/inception/                ← Operator
$ROOT/migrator/                 ← 数据库迁移
$ROOT/notifier/                 ← 通知
$ROOT/charts/                   ← Chart 仓库
```

:::tip 配合源码阅读
每章末尾的"动手验证"都会给出可以直接执行的命令（grep / go doc / kubectl），建议边读边跑。对照真实代码看，比纯读文字有效得多。
:::

## 版本

内容基于 Devtron **2.2.1**（`devtron` 仓库 `main` 分支，`devtron-services` 同步版本），运行环境为 **k3s v1.37.2+k3s1（Kubernetes 1.37）**。目录结构与包名在不同版本间可能有调整，读之前先确认：

```bash
git -C $ROOT/devtron log -1 --format='%h %ad %s' --date=short
git -C $ROOT/devtron-services log -1 --format='%h %ad %s' --date=short
```

:::info 本工作区的工作分支
11 个仓库都已切到同名分支 **`rexyn-dev`**，上游分支只作只读镜像。本文所有"我要改它"的操作都默认你在 `rexyn-dev` 上；分支模型与上游同步流程见[第七部分 · RexynOps 定制](./rexyn-positioning)。
:::
