---
id: reading-guide
title: 源码阅读路线图
sidebar_position: 3
---

# 源码阅读路线图

11 个仓库（8 核心 + 3 周边）、20 万行代码，没人能"读完"。这一章给你一条**按目标驱动**的路线，避免从头翻到尾。

## 路线 0：只想跑通（2 小时）

```text
1. 读 devtron/main.go            （20 行左右，看启动顺序）
2. 读 devtron/App.go             （看装载了哪些服务）
3. 读 devtron/api/router/router.go（看有哪些业务域）
4. 读 charts/devtron/values.yaml  （看有哪些组件）
```

跑完这四步，你已经能回答"这个系统由什么组成"。

## 路线 1：开发后端功能（3 天）

```text
Day 1  请求链路
  api/router/<X>Router.go
    → api/restHandler/<X>RestHandler.go
      → pkg/<domain>/<X>Service.go
        → internal/sql/repository/<X>Repository.go

Day 2  核心业务
  pkg/pipeline/CiCdPipelineOrchestrator.go
  pkg/pipeline/CdHandler.go
  pkg/app/AppListingService.go
  pkg/chart/ChartService.go

Day 3  装配与扩展
  Wire.go → wire_gen.go
  pkg/eventProcessor
  pkg/asyncProvider
```

**关键技巧**：不要按目录顺序读，**按一次请求的顺序读**。用一个真实接口（比如 `/app/list`）从 router 一路跟到 SQL，比读十个文件更有用。

## 路线 2：开发前端功能（2 天）

```text
Day 1  框架与路由
  src/index.tsx
  src/App.tsx            （Provider 与路由）
  src/config/            （路由表、常量）
  src/services/          （API 封装）

Day 2  页面与组件
  src/Pages/Applications （最典型的列表页）
  devtron-fe-common-lib/src/Shared/Components（组件规范）
  src/Pages/App          （最复杂的表单页）
```

**关键技巧**：找一个和你要做的页面最像的现有页面，**照着抄结构**。Devtron 的页面模式很统一（列表 + 筛选 + 抽屉详情）。

## 路线 3：改 CI/CD 行为（3 天）

```text
Day 1  CI
  pkg/pipeline/CiHandler.go
  pkg/pipeline/CiService.go（组装 Argo Workflow）
  devtron-services/ci-runner/app/CiCdProcessor.go

Day 2  CD
  pkg/pipeline/CdHandler.go
  pkg/argoApplication/ArgoApplicationService.go
  pkg/chart/ChartTemplateService.go

Day 3  Helm 渲染
  kubelink/pkg/helmClient/
  devtron/scripts/devtron-reference-helm-charts/
```

## 路线 4：多集群 / 平台能力（3 天）

```text
pkg/cluster/            集群注册与凭证
kubelink/pkg/cluster/   连接管理
pkg/k8s/                资源操作封装
pkg/kubernetesResourceAuditLogs/
pkg/clusterTerminalAccess/   Web terminal
```

## 读代码的四个具体方法

### 方法 1：从路由反查（最有效）

```bash
# 你在 UI 上看到某个功能，想知道后端在哪
grep -rn "list" $ROOT/devtron/api/router/*.go | grep -i app
```

### 方法 2：从日志反查

```bash
# 日志里有一句独特的文案，直接搜代码
grep -rn "error while creating application" $ROOT/devtron --include=*.go
```

### 方法 3：从 wire 看依赖

```bash
# 想知道某个 Service 依赖谁、被谁依赖
grep -rn "NewAppListingService" $ROOT/devtron --include=*.go
```

### 方法 4：从接口定义看契约

```bash
# Go 的 interface 就是最好的文档
grep -rn "type .*Service interface" $ROOT/devtron/pkg/<domain>/*.go -A 20
```

## 一份"必读文件"清单

如果只有 4 小时，读这 10 个文件：

| # | 文件 | 为什么 |
| --- | --- | --- |
| 1 | `devtron/main.go` | 启动全景 |
| 2 | `devtron/App.go` | 依赖装配 |
| 3 | `devtron/api/router/router.go` | 业务域地图 |
| 4 | `devtron/api/middleware/`（任一） | 请求处理模型 |
| 5 | `devtron/pkg/pipeline/CdHandler.go` | 部署核心 |
| 6 | `devtron/pkg/app/AppListingService.go` | 典型业务服务 |
| 7 | `devtron/internal/sql/repository/`（任一） | 数据访问模式 |
| 8 | `charts/devtron/values.yaml` | 组件与配置全貌 |
| 9 | `devtron-services/kubelink/Main.go` | 微服务启动模式 |
| 10 | `dashboard/src/App.tsx` | 前端入口 |

## 读代码时该问的五个问题

每读一个模块，问自己：

1. **它的输入是什么？**（HTTP 请求 / gRPC / NATS 消息 / 定时任务）
2. **它的输出是什么？**（DB 写入 / K8s 资源 / 消息 / HTTP 响应）
3. **它失败会怎样？**（重试 / 回滚 / 告警）
4. **它的边界在哪？**（哪些事它不做，交给谁做）
5. **我要改它，最小改动是什么？**

能答出这五个，这个模块就算读懂了。

## 常见"读不下去"的三个原因

| 症状 | 原因 | 解法 |
| --- | --- | --- |
| 文件太多，不知从哪开始 | 没有目标 | 先定一个具体问题（"部署按钮点了之后发生什么"） |
| 代码跳来跳去跟丢了 | 没画图 | 边读边画调用栈，用纸或 mermaid |
| 看不懂某个函数 | 缺少领域知识 | 先看它的 interface 和测试用例，再看实现 |

:::tip 测试用例是最好的文档
Devtron 的 `*_test.go` 里有大量"构造输入 → 断言输出"的例子，比注释更可靠：

```bash
ls $ROOT/devtron/pkg/pipeline/*_test.go
```

读一个测试，胜过读三个实现文件。
:::

## 最后

读源码的终点不是"读完"，而是**能安全地改**。当你能做到：

- 想加一个 API，知道要动哪 4 个文件
- 想改一个行为，知道会影响哪些组件
- 改完知道怎么验证、怎么回滚

这本书的使命就完成了。
