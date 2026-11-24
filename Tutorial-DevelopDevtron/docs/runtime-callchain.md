---
id: runtime-callchain
title: 运行时调用链：一次部署经历了什么
sidebar_position: 2
---

# 运行时调用链：一次部署经历了什么

抽象讲架构容易忘，不如跟一条真实链路走一遍。下面以"在 Devtron 里点一次 **Deploy**"为例，看请求如何穿过各个组件。

## 第 0 步：前端发请求

```text
浏览器 → nginx(dashboard Pod) → /orchestrator/app/application/... (反代)
       → devtron Service → devtron Pod:8080
```

dashboard 容器里就是 nginx + 静态资源，`nginx.conf` 里有一条：

```nginx
location /orchestrator/ {
    proxy_pass http://devtron-service.devtroncd:80;
}
```

所以**前后端同源**，没有跨域问题，也不需要额外配 CORS。

## 第 1 步：devtron 的中间件链

请求进入 `devtron` 后，先过一串中间件（`api/middleware`）：

```text
Recovery → CORS → Auth(token 校验) → RBAC(casbin) → 路由匹配 → Handler
```

关键点：

- Token 是 JWT，由 `/orchestrator/api/v1/session` 签发，`sub` 是用户名
- RBAC 用 **casbin**，策略定义在 `auth_model.conf`，权限数据存 postgres 的 `casbin_rule` 表
- 如果请求头带 `token`，会走"用户态"；集群内部的组件调用走 service account

## 第 2 步：Handler → Service

以"触发部署"为例，调用栈大致是：

```text
api/restHandler/...RestHandler.go      ← 解析请求、鉴权、组装 DTO
   └── pkg/pipeline/CdHandler.go       ← 业务编排
          ├── pkg/chart/...            ← 渲染 Helm chart（环境覆盖 + 应用覆盖）
          ├── pkg/argoApplication/...  ← 组装 Argo Application CR
          └── internal/sql/repository  ← 写 DB（部署历史、状态）
```

:::tip 找入口的技巧
Devtron 的命名很规整：`api/router` 里注册路由 → 对应 `api/restHandler/<X>RestHandler.go` → 再往 `pkg/<domain>` 找 Service。

```bash
grep -rn "deploy" $ROOT/devtron/api/router/*.go | head
```
:::

## 第 3 步：需要集群信息时，调 kubelink

devtron 自己**不直接**大规模操作集群，很多读取/渲染动作委托给 kubelink（gRPC）：

```text
devtron ──gRPC(50051)──► kubelink ──client-go──► kube-apiserver
```

典型场景：

| 动作 | 走 kubelink |
| --- | --- |
| 列出集群里的 Deployment/Pod | ✓ |
| 渲染 Helm chart 的 manifest | ✓ |
| 读取应用的实际资源状态 | ✓ |
| 写 DB、鉴权、业务规则 | ✗（devtron 自己做） |

## 第 4 步：生成/更新 Argo Application

Devtron 把"要部署成什么样"翻译成一个 Argo CD 的 `Application` CR：

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: myapp-dev
  namespace: devtroncd
spec:
  source:
    repoURL: <gitops repo 或 chart repo>
    path: ...
    helm:
      values: ...
  destination:
    server: https://kubernetes.default.svc
    namespace: myapp-dev
```

然后 Argo CD 的 application-controller 负责把这份声明同步到集群。

验证：

```bash
kubectl get applications -A | head
kubectl -n devtroncd get application myapp-dev -o yaml | head -40
```

## 第 5 步：状态如何回流

这是很多人困惑的地方——**部署完了，UI 上的状态是谁更新的？**

```text
kube-apiserver 事件
   └──► kubewatch（watch 集群资源）──写 DB──► devtron 读取后展示
   └──► Argo CD 更新 Application.status
          └──► devtron 定时/事件驱动拉取
```

所以：

- **应用是否健康**：来自 kubewatch + lens 的聚合
- **部署是否成功**：来自 Argo Application 的 sync/health 状态
- **流水线是否成功**：来自 Argo Workflows 的 workflow 状态（CI 部分）

## 第 6 步：CI 又是另一条链路

"Build"（CI）和 "Deploy"（CD）在 Devtron 里是两条完全不同的路径：

```text
点 Build
  └─► devtron 创建 Argo Workflow
        └─► workflow-controller 调度 Pod
              └─► ci-runner 容器（dind）执行 git clone → docker build → push
                    └─► 回写镜像 tag 到 devtron DB
```

`ci-runner` 是**短生命周期**的：每次构建起一个 Pod，跑完销毁。这也是为什么正常状态下你看不到它常驻。

## 一图总结（时序）

```text
用户    dashboard   devtron    kubelink   ArgoCD   kubewatch   ci-runner
 │          │          │          │         │         │           │
 │─点击部署─►│          │          │         │         │           │
 │          │─POST─────►│          │         │         │           │
 │          │          │─gRPC─────►│         │         │           │
 │          │          │◄─manifest─│         │         │           │
 │          │          │─创建/更新 Application►│         │           │
 │          │          │          │         │─sync────►│           │
 │          │          │◄─────────事件/状态───│         │           │
 │          │◄─轮询─────│          │         │         │           │
 │◄─看到状态─│          │          │         │         │           │
 │          │          │          │         │         │           │
 │─点击构建─►│─POST─────►│─创建 Workflow──────────────────────►│（Pod 拉起）
```

## 动手验证

部署完成后，用这几条命令观察链路：

```bash
# 1) 看 Argo Application 是否真的被创建
kubectl get applications -A

# 2) 看 kubelink 的 gRPC 调用日志
kubectl -n devtroncd logs deploy/kubelink --tail=50 | grep -i "grpc\|GetResource"

# 3) 看 kubewatch 在监听什么
kubectl -n devtroncd logs deploy/kubewatch --tail=50

# 4) 看 devtron 处理了哪些请求
kubectl -n devtroncd logs deploy/devtron --tail=100 | grep -E "POST|GET"
```
