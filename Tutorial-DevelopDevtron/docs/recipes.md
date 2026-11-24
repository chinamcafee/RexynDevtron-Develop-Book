---
id: recipes
title: 二次开发实战配方
sidebar_position: 1
---

# 二次开发实战配方

前面按仓库讲"是什么"，这一章讲"怎么做"。每个配方都是端到端可执行的。

## 配方 1：给后端加一个 API 并让前端用上

**目标**：新增 `GET /orchestrator/app/{appId}/summary`，返回应用名 + 部署次数，并在应用详情页显示。

### 后端（`devtron`）

1. DTO：

```go title="api/bean/app_summary.go"
package bean

type AppSummary struct {
    AppName         string `json:"appName"`
    DeploymentCount int    `json:"deploymentCount"`
}
```

2. Service 方法（放到 `pkg/app/AppListingService.go`）：

```go
func (impl AppListingServiceImpl) GetAppSummary(appId int, userId int32) (*bean.AppSummary, error) {
    app, err := impl.appRepository.FindById(appId)
    if err != nil { return nil, err }
    count, err := impl.deploymentRepository.CountByAppId(appId)
    if err != nil { return nil, err }
    return &bean.AppSummary{AppName: app.AppName, DeploymentCount: count}, nil
}
```

3. Handler：

```go title="api/restHandler/AppListingRestHandler.go"
func (h AppListingRestHandlerImpl) GetAppSummary(w http.ResponseWriter, r *http.Request) {
    userId, err := h.userAuthService.GetLoggedInUser(r)
    if err != nil { common.WriteJsonResp(w, err, nil, http.StatusUnauthorized); return }

    appId, _ := strconv.Atoi(mux.Vars(r)["appId"])
    res, err := h.appListingService.GetAppSummary(appId, userId)
    common.WriteJsonResp(w, err, res, http.StatusOK)
}
```

4. 路由：

```go title="api/router/AppListingRouter.go"
appListingRouter.Path("/{appId}/summary").
    HandlerFunc(router.appListingRestHandler.GetAppSummary).Methods("GET")
```

5. `wire` + 构建 + 部署：

```bash
cd $ROOT/devtron && wire && docker build --platform linux/arm64 -t rexyn-devtron/devtron:local .
for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/devtron:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done
kubectl -n devtroncd rollout restart deploy/devtron
```

6. 验证：

```bash
curl -s -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/app/1/summary | jq
```

### 前端（`dashboard`）

```tsx title="src/Pages/Applications/AppSummary.tsx"
const [summary, setSummary] = useState<{appName: string; deploymentCount: number}>();

useEffect(() => {
  get(`${URLS.APP}/${appId}/summary`).then((r) => setSummary(r.result));
}, [appId]);

return <div>{summary?.appName} 已部署 {summary?.deploymentCount} 次</div>;
```

## 配方 2：改 CI 构建行为（加构建缓存）

**目标**：让 `ci-runner` 在 build 时使用 registry 作为层缓存。

1. 改 `ci-runner`：

```go title="ci-runner/helper/（示意）"
args := []string{"buildx", "build",
    "--cache-from", fmt.Sprintf("type=registry,ref=%s:cache", image),
    "--cache-to", fmt.Sprintf("type=registry,ref=%s:cache,mode=max", image),
    "-t", image, "."}
```

2. 重新构建 ci-runner 镜像（不需要导入集群，因为它是流水线临时拉起的）：

```bash
docker build --platform linux/arm64 -t rexyn-devtron/ci-runner:local $ROOT/devtron-services/ci-runner
```

3. 让集群能拿到这个镜像：导入三节点，或推到你的 registry 并在 Devtron 里配好。

4. 触发一次构建，看日志里有没有 `cache-from`。

## 配方 3：加一个新的通知渠道

1. `notifier/src/destination/myChannel.ts` 实现发送逻辑；
2. 在渠道枚举/注册表里注册；
3. `notifier/src/config` 加配置类型；
4. 重新构建镜像并 `notifier.enabled=true`；
5. UI 里新建 destination，点"发送测试通知"。

## 配方 4：改部署模板（所有新应用默认带探针）

**目标**：新建应用的 Deployment 默认带 liveness/readiness。

1. 改内置参考 chart：

```yaml title="devtron/scripts/devtron-reference-helm-charts/deployment-chart/values.yaml"
livenessProbe:
  enabled: true
  path: /
  initialDelaySeconds: 30
readinessProbe:
  enabled: true
  path: /
  initialDelaySeconds: 10
```

2. 重建 devtron 镜像（因为 chart 被打进镜像）；
3. 导入 + 重启；
4. 新建一个应用，看生成的 manifest。

:::warning 只影响新应用
已存在的应用用的是创建时复制出去的 chart 副本，不会自动更新。
:::

## 配方 5：加一个新的数据库表和 Repository

1. 迁移脚本：

```sql
-- devtron/scripts/sql/200_create_my_table.up.sql
CREATE TABLE IF NOT EXISTS my_table (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_on TIMESTAMP DEFAULT now()
);
```

```sql
-- devtron/scripts/sql/200_create_my_table.down.sql
DROP TABLE IF EXISTS my_table;
```

2. Model：

```go title="internal/sql/models/MyTable.go"
type MyTable struct {
    Id        int       `gorm:"column:id;primaryKey"`
    Name      string    `gorm:"column:name"`
    CreatedOn time.Time `gorm:"column:created_on"`
}

func (MyTable) TableName() string { return "my_table" }
```

3. Repository：

```go title="internal/sql/repository/MyTableRepository.go"
type MyTableRepository interface {
    Save(model *models.MyTable) error
    FindByName(name string) (*models.MyTable, error)
}
```

4. 注册到 wire；
5. 重建镜像 → 迁移 Job 自动跑新脚本（`helm upgrade` 会重建 Job）。

## 配方 6：切换某个组件用另一个实现

**目标**：把 `lens` 换成一个返回固定健康度的 mock，用于演示。

1. 在 `lens` 仓库实现一个 `MockService`，实现同样的 interface；
2. 在 `Wire.go` 里改绑定：

```go
wire.Bind(new(DeploymentMetricService), new(*MockDeploymentMetricService))
```

3. 重建 lens 镜像 → 导入 → 重启。

这就是 wire 带来的好处：**换实现只改一行绑定**。

## 配方 7：给 Devtron 加一个自定义 CRD

1. 用 kubebuilder 在 `devtron` 仓库外新建一个 Operator 项目（或复用 `inception` 的骨架）；
2. 部署到 `devtroncd`；
3. 在 Devtron 的 Resource Browser 里就能看到这个 CRD 的实例。

:::tip 更轻的做法
如果只是想在 UI 上看到/编辑某种资源，不需要写 Operator——Devtron 的 Resource Browser 本身就能展示任意 CRD。
:::

## 一张"改哪里"的速查表

| 我想… | 改这个 | 要重建 |
| --- | --- | --- |
| 加 API | `devtron` | devtron 镜像 |
| 加页面 | `dashboard` | dashboard 镜像 |
| 加公共组件 | `devtron-fe-common-lib` + dashboard | dashboard 镜像 |
| 改构建流程 | `ci-runner` | ci-runner 镜像 |
| 改部署模板 | `devtron/scripts/devtron-reference-helm-charts` | devtron 镜像 |
| 改健康度算法 | `lens` | lens 镜像 |
| 改集群读取 | `kubelink` | kubelink + devtron（若接口变了） |
| 加表 | `devtron/scripts/sql` + `internal/sql` | devtron 镜像 |
| 加通知渠道 | `notifier` | notifier 镜像 |
| 改安装流程 | `inception` | inception 镜像 |
