---
id: devtron-api
title: devtron｜API 层与路由
sidebar_position: 2
---

# devtron｜API 层与路由

## 路由是怎么注册的

入口在 `api/router/`。每个业务域一个 `*Router.go`，实现一个 `Init*Router` 方法，最终由 `server` 汇总挂载：

```go title="api/router/router.go（结构示意）"
func (r RouterImpl) Init(config *RouterConfig) {
    // 每个子路由挂到 /orchestrator 下
    userRouter.InitUserRouter(config.Router.PathPrefix("/user"))
    appRouter.InitAppRouter(config.Router.PathPrefix("/app"))
    chartRouter.InitChartRouter(config.Router.PathPrefix("/chart"))
    ...
}
```

所以最终路径形如：

```text
/orchestrator/app/application/list
/orchestrator/chart/ref
/orchestrator/user/login
```

## Handler 的标准写法

所有 Handler 都遵循同一套模板，看懂一个就懂全部：

```go title="api/restHandler/（通用模板，已简化）"
func (h XxxRestHandlerImpl) DoSomething(w http.ResponseWriter, r *http.Request) {
    // 1) 身份
    userId, err := h.userAuthService.GetLoggedInUser(r)
    if err != nil {
        common.WriteJsonResp(w, err, "unauthorized", http.StatusUnauthorized)
        return
    }

    // 2) 路径参数
    vars := mux.Vars(r)
    id, err := strconv.Atoi(vars["id"])
    if err != nil {
        common.WriteJsonResp(w, err, nil, http.StatusBadRequest)
        return
    }

    // 3) Body
    var req bean.XxxRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        common.WriteJsonResp(w, err, nil, http.StatusBadRequest)
        return
    }

    // 4) 业务
    resp, err := h.xxxService.DoSomething(&req, id, userId)

    // 5) 响应
    common.WriteJsonResp(w, err, resp, http.StatusOK)
}
```

响应格式统一为：

```json
{ "code": 200, "status": "OK", "result": { } }
```

错误时：

```json
{ "code": 400, "status": "Bad Request", "result": "具体错误" }
```

:::warning 相对路径的一个陷阱
`json.NewDecoder(r.Body).Decode(&req)` 之后 Body 已被消费，**不能在 Handler 里重复读**。这在写"审计日志需要原 Body"的需求时要特别注意——要么提前 `io.ReadAll` 缓存，要么在中间件里做。**必须**先解码再转交 Service。
:::

## 三个必须知道的特殊路由

| 路径 | 作用 | 备注 |
| --- | --- | --- |
| `POST /orchestrator/api/v1/session` | 登录，返回 JWT | 不是 `/user/login`，别写错 |
| `GET /orchestrator/devtron/auth/verify` | 校验 token 是否有效 | dashboard 每次刷新都会调 |
| `GET /orchestrator/health` | 健康检查 | k8s probe 用 |

## 中间件链

`api/middleware/` 里，按注册顺序执行：

```text
RecoveryMiddleware    ← defer recover，避免 panic 打挂进程
    ↓
CORSMiddleware        ← 允许 dashboard 域
    ↓
AuthMiddleware        ← 解析 token，注入 context
    ↓
RBACMiddleware        ← casbin 校验：sub/res/act/obj
    ↓
业务 Handler
```

`auth_model.conf` 定义了 casbin 的模型：

```ini
[request_definition]
r = sub, res, act, obj

[policy_definition]
p = sub, res, act, obj, eft

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && matchKeyByPart(r.res, p.res) && matchKeyByPart(r.act, p.act) && matchKeyByPart(r.obj, p.obj)
```

`matchKeyByPart` 是 Devtron 自定义的匹配函数，支持 `team/app` 这种分段通配。

## 新增一个 API 的完整流程

以"查询某个应用的部署次数"为例。

### 1. 定义 DTO

```go title="api/bean/deployment_count.go"
package bean

type DeploymentCountResponse struct {
    AppId int `json:"appId"`
    Count int `json:"count"`
}
```

### 2. 在 Service 里实现

```go title="pkg/app/AppListingService.go（新增方法）"
func (impl AppListingServiceImpl) GetDeploymentCount(appId int, userId int32) (*bean.DeploymentCountResponse, error) {
    // 权限校验
    if _, err := impl.userService.CheckUserExists(userId); err != nil { return nil, err }
    // 查库
    count, err := impl.deploymentRepository.CountByAppId(appId)
    if err != nil { return nil, err }
    return &bean.DeploymentCountResponse{AppId: appId, Count: count}, nil
}
```

### 3. 加 Handler 方法

```go title="api/restHandler/AppListingRestHandler.go"
func (h AppListingRestHandlerImpl) GetDeploymentCount(w http.ResponseWriter, r *http.Request) {
    userId, err := h.userAuthService.GetLoggedInUser(r)
    if err != nil { common.WriteJsonResp(w, err, nil, http.StatusUnauthorized); return }

    vars := mux.Vars(r)
    appId, _ := strconv.Atoi(vars["appId"])

    res, err := h.appListingService.GetDeploymentCount(appId, userId)
    common.WriteJsonResp(w, err, res, http.StatusOK)
}
```

### 4. 注册路由

```go title="api/router/AppListingRouter.go"
appListingRouter.Path("/deployment/count/{appId}").
    HandlerFunc(router.appListingRestHandler.GetDeploymentCount).
    Methods("GET")
```

### 5. 重新生成 wire（如果新增了依赖）

```bash
cd $ROOT/devtron
wire
```

### 6. 验证

```bash
TOKEN=$(curl -s -X POST http://192.168.139.95:30080/orchestrator/api/v1/session \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<PW>"}' | jq -r .result.token)

curl -s -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/app/deployment/count/1 | jq
```

## 接口文档在哪

Devtron 用 OpenAPI 规范，定义在 `specs/` 目录：

```bash
ls $ROOT/devtron/specs
```

CI 里有 `api-spec-merger.yaml` 把分散的 spec 合并成一份。改 API 时记得同步更新 spec，否则 `make` 里的校验可能失败。

## 一个容易被忽略的细节：内外部 API 的差异

| 场景 | 鉴权方式 | 说明 |
| --- | --- | --- |
| dashboard 调用 | `token` header（JWT） | 常规路径 |
| 组件间调用 | Service Account / 内部 token | 例如 kubewatch 回写状态 |
| CI 回调 | `api-token` | 给流水线用的长期 token，见 `pkg/apiToken` |

`apiToken` 是一个独立概念：你可以为某个应用生成一个长期 token，让外部 CI 直接触发部署，不需要用户登录。扩展 API 时要想清楚"这个接口给谁用"。
