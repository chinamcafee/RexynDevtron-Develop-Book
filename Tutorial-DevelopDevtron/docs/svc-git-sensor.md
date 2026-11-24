---
id: svc-git-sensor
title: git-sensor｜Git 仓库索引服务
sidebar_position: 2
---

# git-sensor｜Git 仓库索引服务

## 它是什么

Devtron 里所有"跟 Git 打交道"的读取动作都由它承担：

- 拉取仓库、缓存到本地磁盘
- 索引分支、标签、提交历史
- 提供"某个 commit 对应的文件树"
- 给 CI 提供"这次构建用哪个 commit"

**它不写 Git**，只读。写操作（GitOps 回写）由 devtron 自己用 git 客户端做。

## 代码结构

```text
git-sensor/
├── main.go
├── pkg/
│   ├── RepoManages.go     # 核心：仓库生命周期管理
│   └── git/               # git 命令封装（go-git 或 shell）
├── api/                   # REST handler
├── bean/                  # DTO
├── internals/             # 内部工具
├── wireset/               # wire 声明
└── scripts/
```

## 核心对象

| 概念 | 说明 |
| --- | --- |
| `GitSensorClient` | 被 devtron 调用时的客户端封装（在 devtron 仓库侧） |
| `RepoManager` | 管一个仓库：clone、fetch、查 commit |
| `CiMaterial` | Devtron 侧的"源码物料"，对应 git-sensor 里的一个仓库 |

## 它怎么被调用

```text
devtron（创建应用时）
   → POST /git-sensor/... 注册仓库
   → 定时/触发 fetch
   → GET 查询 commit 列表
```

调用的 Go 客户端在 devtron 仓库：

```bash
ls $ROOT/devtron/client/gitSensor
```

## 存储

- **元数据**：postgres 的 `git_sensor` 库（chart 里有独立的 migrate job）
- **仓库文件**：StatefulSet 挂的 PVC（`git-volume-git-sensor-0`）

```bash
kubectl -n devtroncd get pvc | grep git
kubectl -n devtroncd exec git-sensor-0 -- ls /git-sensor-volume 2>/dev/null | head
```

## 我要改它，从哪下手

| 需求 | 位置 |
| --- | --- |
| 支持新的 Git 协议/认证方式 | `pkg/git/` + `bean` 里的认证字段 |
| 改 commit 索引策略（如只索引最近 N 个） | `pkg/RepoManages.go` |
| 加一个"查询文件内容"的接口 | `api/` 加 handler + `pkg/` 加方法 |
| 改 webhook 触发 | 与 devtron 的 `pkg/gitHost` 配合 |

## 典型问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 应用创建后一直"Fetching commits" | 仓库太大 / 网络不通 / 凭证错 | 看 `kubectl logs git-sensor-0`，找 `clone failed` |
| PVC 占满 | 仓库缓存没清理 | 手动清理 `/git-sensor-volume` 下不用的仓库 |
| commit 列表不更新 | fetch 周期未到 | 触发一次 refresh，或重启 Pod |

## 动手验证

```bash
# 看它在监听什么端口
kubectl -n devtroncd get svc git-sensor-service

# 看最近的仓库操作
kubectl -n devtroncd logs sts/git-sensor --tail=50

# 看它连的库
kubectl -n devtroncd exec git-sensor-0 -- env | grep -i pg
```
