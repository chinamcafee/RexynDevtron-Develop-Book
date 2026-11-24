---
id: devtron-wire
title: devtron｜wire 依赖注入与扩展点
sidebar_position: 4
---

# devtron｜wire 依赖注入与扩展点

## 为什么值得单独讲

Devtron 里几乎所有"加功能"的操作都会碰到 wire：

- 新增一个 Service → 要加 Provider
- Service 需要新的 Repository → 要加参数
- 加了参数却忘了跑 `wire` → 编译报错或运行时 nil

理解 wire 之后，你会发现这个项目的依赖关系其实是**编译期就能看全**的。

## 三个文件的关系

```text
Wire.go       你写：声明"这些构造函数能组成一个对象图"
   │
   ├── wire (命令) 生成
   ▼
wire_gen.go   自动生成：按依赖顺序调用构造函数
   │
   └── 被 App.go 调用
   ▼
App.go        你写：InitializeApp 里调用 wire_gen 的函数
```

### 示例：一个最小的 ProviderSet

```go title="pkg/example/Wire.go"
//go:build wireinject
// +build wireinject

package example

import "github.com/google/wire"

var ExampleSet = wire.NewSet(
    NewExampleRepository,
    NewExampleService,
    NewExampleRestHandler,
)
```

```go title="pkg/example/wire_gen.go（自动生成，示意）"
func InitializeExampleHandler(db *gorm.DB, logger *zap.SugaredLogger) *ExampleRestHandlerImpl {
    repo := NewExampleRepository(db, logger)
    svc := NewExampleService(repo, logger)
    return NewExampleRestHandler(svc, logger)
}
```

### 关键规则

| 规则 | 说明 |
| --- | --- |
| `Wire.go` 必须有 `//go:build wireinject` | 否则正常编译也会解析，导致重复定义 |
| 构造函数返回 `(T, error)` 或 `T` | wire 支持两种 |
| 同一个类型只能有一个 Provider | 否则 wire 报 `multiple bindings` |
| `wire_gen.go` 不要手改 | 下次 `wire` 会覆盖 |
| 接口绑定用 `wire.Bind` | `wire.Bind(new(IFoo), new(FooImpl))` |

## 在 Devtron 里怎么加一个新组件

以"新增一个 `AuditService`"为例。

### 1. 写实现

```go title="pkg/audit/AuditService.go"
type AuditService interface {
    Record(event AuditEvent) error
}

type AuditServiceImpl struct {
    logger *zap.SugaredLogger
    repo   AuditRepository
}

func NewAuditService(logger *zap.SugaredLogger, repo AuditRepository) *AuditServiceImpl {
    return &AuditServiceImpl{logger: logger, repo: repo}
}
```

### 2. 声明 ProviderSet

```go title="pkg/audit/Wire.go"
//go:build wireinject
// +build wireinject

package audit

import "github.com/google/wire"

var AuditSet = wire.NewSet(
    NewAuditRepository,
    NewAuditService,
    wire.Bind(new(AuditService), new(*AuditServiceImpl)),
)
```

### 3. 挂到主图里

```go title="Wire.go（根目录）"
var MainSet = wire.NewSet(
    // ... 已有的
    audit.AuditSet,
)
```

### 4. 重新生成

```bash
cd $ROOT/devtron
go install github.com/google/wire/cmd/wire@latest
wire
```

`wire` 会把新的构造函数插进 `wire_gen.go`，并把 `AuditService` 传给需要它的地方。

### 5. 验证

```bash
git diff --stat wire_gen.go     # 应该看到变化
go build ./...                  # 应该通过
```

## 常见错误对照表

| 报错 | 原因 | 解决 |
| --- | --- | --- |
| `inject: no provider found for X` | 某个类型没有 Provider | 加 `NewX` 到 Set 里 |
| `multiple bindings for X` | 两个 Provider 返回同一类型 | 用 `wire.Bind` 区分接口/实现 |
| `undefined: NewXxx` | 忘记跑 `wire` | `wire` 重新生成 |
| `cycle detected` | 循环依赖 | 拆出一个中间层（如 Event bus） |
| 运行时 panic: nil pointer | 手改了 `wire_gen.go` 或漏跑 wire | 重新 `wire`，别手改 |

## 扩展点：不用改 core 就能插入的地方

Devtron 设计上留了几个"插件位"，比 fork 改 core 更优雅：

### 1. Plugin（`pkg/plugin`）

Devtron 有插件机制，允许在流水线的特定阶段执行外部逻辑：

```bash
ls $ROOT/devtron/pkg/plugin
```

适合：构建前后做自定义检查、发通知、改 manifest。

### 2. Webhook（`api/webhook`）

```text
外部系统 → POST /orchestrator/webhook/... → 触发部署/构建
```

适合：让 GitLab/Jenkins 等外部 CI 触发 Devtron。

### 3. `extraManifests`（chart 层）

部署 Devtron 时可以在 values 里加任意 K8s 资源：

```yaml
extraManifests:
  - apiVersion: v1
    kind: ConfigMap
    metadata:
      name: my-extra
      namespace: devtroncd
    data:
      foo: bar
```

适合：加 sidecar、ConfigMap、NetworkPolicy，而不 fork chart。

### 4. `customOverrides`

chart 里每个组件都支持 `customOverrides`，直接注入环境变量：

```yaml
components:
  devtron:
    customOverrides:
      MY_FEATURE_FLAG: "true"
```

适合：临时打开某个实验特性，不需要重新编译。

## 一张决策图：改哪里

```text
需要新逻辑？
├── 只是加个开关/配置        → customOverrides / ConfigMap
├── 只是加个 K8s 资源        → extraManifests
├── 在流水线某阶段插逻辑     → Plugin
├── 外部触发                 → Webhook / api-token
└── 改核心行为               → fork 改 pkg/ + wire 重新生成
```

## 动手验证

```bash
cd $ROOT/devtron

# wire_gen.go 里有多少个构造函数调用
grep -c "= New" wire_gen.go

# 找出所有 ProviderSet
grep -rn "wire.NewSet" --include=Wire.go . | wc -l

# 看某个 Service 被谁依赖
grep -rn "NewCiCdPipelineOrchestrator" --include=*.go . | head
```

最后一条命令很实用：它告诉你这个 Service 在哪里被构造、在哪里被注入，顺着就能画出依赖图。
