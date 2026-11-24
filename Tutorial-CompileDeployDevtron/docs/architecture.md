---
id: architecture
title: 运行时架构与镜像地图
sidebar_position: 2
---

# 运行时架构与镜像地图

编译之前先搞清楚"谁跟谁说话"，后面排错时能省掉大量时间。

## 一张图看懂

```text
                      浏览器
                        │  http://<nodeIP>:30080/dashboard
                        ▼
                ┌───────────────┐
                │  dashboard    │  nginx + React 静态资源
                └───────┬───────┘
                        │ /orchestrator/* 反向代理
                        ▼
                ┌───────────────┐        ┌──────────────┐
                │   devtron     │◄──────►│  postgres    │
                │ (orchestrator)│        │  (元数据库)   │
                └──┬───┬───┬────┘        └──────────────┘
                   │   │   │
        gRPC       │   │   │  NATS 消息
                   ▼   │   ▼
        ┌──────────┐   │  ┌────────────┐
        │ kubelink │   │  │ devtron-   │
        └──────────┘   │  │   nats     │
                       │  └────────────┘
        ┌──────────┐   │
        │git-sensor│◄──┤   Kafka? 不，Devtron 用 NATS + DB 解耦
        └──────────┘   │
        ┌──────────┐   │
        │   lens   │◄──┘
        └──────────┘
        ┌──────────┐
        │ kubewatch│   监听集群事件写入 DB
        └──────────┘
        ┌──────────┐
        │chart-sync│   定时同步 Helm Chart 仓库
        └──────────┘
        ┌──────────┐
        │ inception│   Operator：安装/升级 Devtron 模块
        └──────────┘
        ┌──────────┐
        │ argocd-* │   CD 引擎（devtron 通过它同步应用）
        └──────────┘
```

## 组件职责与镜像

| 组件 | 镜像 | 部署形态 | 职责 |
| --- | --- | --- | --- |
| dashboard | `rexyn-devtron/dashboard:local` | Deployment | 前端静态站 + `/orchestrator` 反代 |
| devtron | `rexyn-devtron/devtron:local` | Deployment | 主 API，几乎所有业务逻辑 |
| inception | `rexyn-devtron/inception:local` | Deployment | 监听 `Installer` CR，执行安装脚本 |
| kubelink | `rexyn-devtron/kubelink:local` | Deployment | gRPC，替 devtron 操作集群（Helm 渲染、资源读取） |
| kubewatch | `rexyn-devtron/kubewatch:local` | Deployment | 监听 K8s 事件，回写应用状态 |
| lens | `rexyn-devtron/lens:local` | Deployment | 应用/环境健康度、部署指标 |
| git-sensor | `rexyn-devtron/git-sensor:local` | StatefulSet | 拉取 Git 仓库、索引提交与分支 |
| chart-sync | `rexyn-devtron/chart-sync:local` | CronJob/Job | 同步 Chart 仓库元数据到 DB |
| migrator | `rexyn-devtron/migrator:local` | Job（Helm hook） | 数据库迁移 |
| nats | `quay.io/devtron/nats:2.9.3-alpine` | StatefulSet | 消息总线 |
| postgres | `quay.io/devtron/postgres:14.9` | StatefulSet | 元数据库（orchestrator/lens/casbin/git-sensor 四个库） |
| argocd-* | `quay.io/argoproj/argocd:v2.13.3` | Deployment/StatefulSet | CD 引擎 |
| dex | `rexyn-devtron/dex:v2.30.2` | Deployment | argocd 的 OIDC Provider |

> 注意：`ci-runner`、`image-scanner`、`notifier` 的镜像会被编译出来，但**默认不部署**——它们由 CI 流水线动态拉起，或在 Stack Manager 里启用对应模块后才出现。这和官方安装的行为一致。

## 数据库与初始化顺序

Devtron 启动时有严格的依赖顺序，理解了就不会被前几分钟的 CrashLoopBackOff 吓到：

```text
postgres 就绪
   └─► migrate Job（4 个：devtron / lens / gitsensor / casbin）执行 SQL
          └─► devtron、kubelink、lens、kubewatch、git-sensor 启动并连库
                 └─► ingress/dashboard 可用
```

在 `kubectl get pods` 里你大概率会先看到：

```text
kubelink-xxx        0/1  CrashLoopBackOff
lens-xxx            0/1  CrashLoopBackOff
postgresql-migrate  0/1  Init:0/2
```

日志内容形如 `dial tcp 10.43.x.x:5432: connect: connection refused`——**这是正常的启动竞态**，等 postgres 起来、迁移跑完，它们会自己恢复。

## 命名空间

| 命名空间 | 内容 |
| --- | --- |
| `devtroncd` | 上述几乎所有组件 |
| `argo` | Argo Workflows 的 workflow-controller（CI 用） |
| `devtron-ci` | 流水线运行时的临时 Pod |
| `devtron-cd` | 部署相关 Job |
| `registry` | 本书不使用（早期尝试过内置 registry，最终改为直接导入 containerd） |

## 端口与访问路径

| 路径 | 说明 |
| --- | --- |
| `devtron-service:80` | 对外唯一入口，我们把它的 NodePort 固定成 **30080** |
| `/dashboard` | 前端静态资源 |
| `/orchestrator/*` | 后端 API（nginx 反代到 devtron:8080） |
| `devtron:8080` | 容器内监听端口 |

登录接口是 `POST /orchestrator/api/v1/session`，**不是** `/orchestrator/user/login`（后者会返回 401，网上不少文章写错）。
