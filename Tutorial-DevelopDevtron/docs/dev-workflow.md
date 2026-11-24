---
id: dev-workflow
title: 本地开发调试工作流
sidebar_position: 2
---

# 本地开发调试工作流

## 三种循环，按改动的范围选

| 循环 | 适用 | 反馈速度 |
| --- | --- | --- |
| A. 热重载（只跑进程） | 改业务逻辑，不需要动 K8s | 秒级 |
| B. 镜像替换 | 需要验证完整 Pod 行为 | 1–3 分钟 |
| C. 全量重建 | 改 chart/启动参数 | 5–15 分钟 |

## A. 热重载：最快的内循环

### 后端（Go）

Devtron 没有内置 air/watcher，两种做法：

**做法 1：`go run`**

```bash
cd $ROOT/devtron
# 需要一堆环境变量，从集群里借一份
kubectl -n devtroncd get deploy devtron -o jsonpath='{.spec.template.spec.containers[0].envFrom}'
```

更实际的做法是把 Pod 的环境变量导出成本地文件：

```bash
kubectl -n devtroncd exec deploy/devtron -- env | grep -vE "^(PATH|HOSTNAME|HOME)=" > /tmp/dev.env
set -a; source /tmp/dev.env; set +a
go run main.go
```

**做法 2：`air`（推荐）**

```bash
go install github.com/air-verse/air@latest
cd $ROOT/devtron
air    # 改代码自动重启
```

需要连数据库和 NATS 时，用端口转发：

```bash
kubectl -n devtroncd port-forward svc/postgresql-postgresql 5432:5432 &
kubectl -n devtroncd port-forward svc/devtron-nats 4222:4222 &
```

然后把 `PG_ADDR=127.0.0.1` / `NATS_SERVER_HOST=nats://127.0.0.1:4222`。

### 前端

```bash
cd $ROOT/dashboard
yarn start
```

配合后端端口转发：

```bash
kubectl -n devtroncd port-forward svc/devtron-service 8000:80
```

Vite 的 proxy 指向 `http://127.0.0.1:8000`。

## B. 镜像替换：验证 Pod 行为

```bash
# 1) 编
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local $ROOT/devtron

# 2) 推
for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/devtron:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done

# 3) 重启
kubectl -n devtroncd rollout restart deploy/devtron
kubectl -n devtroncd rollout status deploy/devtron --timeout=180s

# 4) 看日志
kubectl -n devtroncd logs deploy/devtron -f --tail=50
```

把它存成 `hotup.sh`（见配套电子书《编译 + 本地部署》的“日常迭代工作流”一章）。

## C. 全量重建

只有这些情况才需要：

- 改了 `charts/devtron/`（用 `helm upgrade` 即可，不用重建镜像）
- 改了 `scripts/devtron-reference-helm-charts/`（要重建 devtron 镜像）
- 改了 `scripts/sql/`（要重建 devtron 镜像 + 触发迁移 Job）

## 调试技巧

### 1. 进容器看现场

```bash
kubectl -n devtroncd exec -it deploy/devtron -- bash
# 里面通常没有 bash，用 sh
kubectl -n devtroncd exec -it deploy/devtron -- sh
```

### 2. 临时提高日志级别

```bash
kubectl -n devtroncd set env deploy/devtron LOG_LEVEL=debug
kubectl -n devtroncd rollout status deploy/devtron
```

改完记得改回去。

### 3. 用 ephemeral container 排查（不重启 Pod）

```bash
kubectl -n devtroncd debug -it deploy/devtron --image=busybox:1.36 --target=devtron
```

### 4. 追踪一次请求

```bash
# 终端 1
kubectl -n devtroncd logs deploy/devtron -f | grep -i "your-endpoint"

# 终端 2
curl -v -H "token: $TOKEN" http://192.168.139.95:30080/orchestrator/your-endpoint
```

### 5. 看 gRPC 调用

devtron ↔ kubelink 的调用不打 HTTP 日志，需要看 kubelink 侧：

```bash
kubectl -n devtroncd logs deploy/kubelink -f | grep -i "grpc"
```

## 单测

```bash
# devtron
cd $ROOT/devtron
go test ./pkg/pipeline/... -run TestCiHandler -v

# kubelink
cd $ROOT/devtron-services/kubelink
go test ./pkg/... 

# 前端
cd $ROOT/dashboard
yarn test
```

:::warning vendor 模式
`devtron` 用 `vendor/`，`go test` 时如果有新增依赖，先：

```bash
go mod tidy && go mod vendor
```
:::

## 代码规范检查

```bash
# Go
cd $ROOT/devtron && gofmt -l . | head
cd $ROOT/devtron && go vet ./pkg/...

# 前端
cd $ROOT/dashboard && yarn lint
```

## 一个真实的内循环示例

假设要修"应用列表按更新时间排序不生效"：

```text
1. 前端看请求参数        → 浏览器 Network，确认 sortBy 传了
2. 后端 grep 参数名      → grep -rn "sortBy" pkg/app/
3. 定位到 SQL 拼装       → pkg/app/AppListingService.go
4. 改代码
5. 本地跑：air           → 打接口验证返回顺序
6. 编镜像 + 导入 + 重启  → 在真实环境验证
7. 提交 + PR 到 fork     → 上游可选
```

这个流程的关键是**先用最快的方式验证逻辑（第 5 步），再做重的那一步（第 6 步）**。

## 提交：落在 rexyn-dev，不回上游

这套代码的定位是 RexynOps 的定制发行版，**不向上游提 PR**。提交路径固定：

```bash
cd $ROOT/devtron
git branch --show-current        # 必须是 rexyn-dev
git add -A
git commit -m "feat(rexyn): ..."
git push origin rexyn-dev
```

同步上游用 **merge**（不是 rebase，理由见[分支策略](./rexyn-branch-strategy#五上游同步为什么用-merge不用-rebase)）：

```bash
git fetch upstream --prune
git merge upstream/main
```

:::warning 三个不要
不要在上游分支（`main`/`develop`/`master`）上提交；不要 `git push` 裸命令（可能指向上游）；不要手改 `wire_gen.go` 与 `vendor/`。
:::
