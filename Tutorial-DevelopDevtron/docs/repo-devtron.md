---
id: repo-devtron
title: devtron｜核心仓库的骨架
sidebar_position: 1
---

# devtron｜核心仓库的骨架

## 它是什么

`devtron` 是整个平台唯一的"业务单体"：

- 提供全部 HTTP API（`/orchestrator/*`）
- 承载所有业务规则（应用、流水线、环境、Chart、权限）
- 内嵌部署用的 Helm Chart（`charts/devtron`）
- 通过 gRPC 调 kubelink、通过 NATS 与其他服务解耦

一句话：**除了"直接读写集群"和"访问外部系统"，剩下的逻辑都在这里。**

## 顶层目录

```text
devtron/
├── main.go                 # 入口：启动 HTTP server、初始化 NATS、连 DB
├── App.go                  # 应用装配（依赖 wire）
├── Wire.go                 # ← 你写：ProviderSet
├── wire_gen.go             # ← wire 生成：不要手改
├── api/                    # HTTP 层
│   ├── router/             # 路由注册
│   ├── restHandler/        # 各资源的 Handler
│   ├── bean/               # 请求/响应 DTO
│   ├── middleware/         # 中间件（鉴权、CORS、panic 恢复）
│   └── auth/               # 登录、token
├── pkg/                    # 业务层（56 个域）
├── internal/               # 内部实现（sql / middleware / util / constants）
│   └── sql/
│       ├── repository/     # 数据访问
│       └── models/         # GORM 模型
├── scripts/
│   ├── sql/                # 数据库迁移脚本（up/down）
│   ├── casbin/             # 权限模型与初始策略
│   └── devtron-reference-helm-charts/   # 部署应用时用的内置参考 chart
├── charts/devtron/         # 部署 Devtron 自身的 Helm Chart
├── vendor/                 # 依赖（vendor 模式）
└── util/                   # 工具函数与全局配置
```

## 三层结构：api → pkg → internal

Devtron 的分层非常清晰，**读懂这条线，就掌握了 80% 的代码**：

```text
api/restHandler   ←  只做：解析参数、取用户身份、调 service、包响应
      │
      ▼
pkg/<domain>      ←  业务逻辑：校验、编排、调其他 service、发 NATS 消息
      │
      ▼
internal/sql/repository  ←  只做：CRUD，不写业务
```

举一个真实例子（简化）：

```go title="api/restHandler/ChartRefRestHandler.go（示意）"
func (handler ChartRefRestHandlerImpl) Create(w http.ResponseWriter, r *http.Request) {
    userId, err := handler.userAuthService.GetLoggedInUser(r)   // ① 身份
    if err != nil { common.WriteJsonResp(w, err, "unauthorized", http.StatusUnauthorized); return }

    var request bean.ChartRefRequest
    decoder := json.NewDecoder(r.Body)
    if err := decoder.Decode(&request); err != nil { ... }      // ② 解码

    resp, err := handler.chartRefService.CreateChartRef(&request, userId)  // ③ 业务
    common.WriteJsonResp(w, err, resp, http.StatusOK)          // ④ 响应
}
```

Handler 里**不该出现**：SQL、k8s client 调用、复杂 if-else 业务判断。看到这些就说明分层被破坏了。

## pkg 下的 56 个域怎么认

不用全记，按"你关心什么"分类：

| 类别 | 关键包 |
| --- | --- |
| 应用 | `app`、`appStore`、`appWorkflow`、`appClone`、`appStatus` |
| 流水线 | `pipeline`、`build`、`workflow`、`deployment` |
| Chart/部署 | `chart`、`chartRepo`、`argoApplication`、`gitops`、`generateManifest` |
| 集群 | `cluster`、`k8s`、`clusterTerminalAccess`、`kubernetesResourceAuditLogs` |
| 权限 | `auth`、`userResource`、`policyGovernance`、`team` |
| 配置 | `attributes`、`variables`、`config`、`dockerRegistry`、`notifier` |
| 基础设施 | `sql`、`server`、`util`、`eventProcessor`、`asyncProvider`、`executor` |

:::tip 快速定位
不知道某个功能在哪个包时，用路由反查：

```bash
grep -rn "你要找的路径片段" $ROOT/devtron/api/router/*.go
```
:::

## 入口：main.go 做了什么

```go
func main() {
    // 1. 读配置（环境变量 + ConfigMap）
    // 2. 初始化 logger / DB / NATS / k8s client
    // 3. 调用 App.go 里的 InitializeApp（wire 装配整个对象图）
    // 4. 启动 HTTP server，注册路由
    // 5. 启动后台协程（cron、事件消费）
}
```

`InitializeApp` 是理解依赖关系的最佳入口——它一行行地把 repository、service、handler 串起来，读它等于读了一遍架构图。

## 与其它仓库的边界

| 交互对象 | 方式 | 位置 |
| --- | --- | --- |
| kubelink | gRPC | `client/grpc/kubelink` |
| git-sensor | HTTP | `pkg/gitSensor` / `client` |
| lens | HTTP | `pkg/...`（健康度聚合） |
| Argo CD | k8s CR + API | `pkg/argoApplication`、`client/argocdServer` |
| NATS | 发布/订阅 | `pkg/eventProcessor`、`pkg/asyncProvider` |
| 数据库 | GORM | `internal/sql/repository` |

## 我要改它，从哪下手

| 目标 | 入口 |
| --- | --- |
| 加一个 REST 接口 | `api/router/<X>Router.go` → `api/restHandler/<X>RestHandler.go` → `pkg/<domain>` |
| 加一张表 | `scripts/sql/` 新建迁移 → `internal/sql/models` 加 struct → `internal/sql/repository` 加方法 |
| 改部署行为 | `pkg/pipeline/CdHandler.go`、`pkg/chart/` |
| 改权限模型 | `auth_model.conf`、`scripts/casbin/`、`pkg/auth` |
| 改启动参数/环境变量 | `util/GlobalConfig.go`、`env_gen.json` |

## 动手验证

```bash
cd $ROOT/devtron

# 看路由总数
grep -c "Path(" api/router/*.go | awk -F: '{s+=$2} END {print s" 条路由"}'

# 看某个域被谁引用
grep -rn "pkg/pipeline" --include=*.go api/ | head

# 看 wire 装配了多少 provider
grep -c "New" wire_gen.go

# 看迁移脚本数量
ls scripts/sql/*.up.sql | wc -l
```
