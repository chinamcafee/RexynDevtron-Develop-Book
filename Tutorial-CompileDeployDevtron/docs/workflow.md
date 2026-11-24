---
id: workflow
title: 日常迭代工作流
sidebar_position: 2
---

# 日常迭代工作流

环境搭好之后，真正的工作是"改代码 → 看到效果"。这一节给出不同场景下的最短路径。

:::info 所有命令都在 rexyn-dev 上执行
编译用的是**工作区内容**，与分支无关；但为了避免"改着改着发现改在上游分支上"，开工前先确认一次：

```bash
ROOT=$HOME/InnovationProjects/DevtronProjects
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  printf "%-22s %s\n" "$r" "$(git -C "$ROOT/$r" branch --show-current)"
done
```

全部应为 `rexyn-dev`。上游同步（`git merge upstream/main`）之后要重编哪些组件，见[分支策略 · 同步后重建](./branch-strategy#6-上游同步之后要重建什么)。
:::

## 场景一：只改后端（devtron 主程序）

```bash
cd $ROOT/devtron
# 改代码...
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local .

for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/devtron:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done

kubectl -n devtroncd rollout restart deploy/devtron
kubectl -n devtroncd rollout status deploy/devtron
```

耗时：增量构建 1–3 分钟 + 导入 10 秒 + 滚动重启 30 秒。

:::tip 更快的方式：跳过镜像
调试单个后端服务时，可以用 `kubectl cp` + `kubectl exec` 直接替换容器里的二进制，但**只适合临时验证**，重启即失效。要长期生效还是重编镜像。
:::

## 场景二：改前端（dashboard）

```bash
cd $ROOT/dashboard
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/dashboard:local .

for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/dashboard:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done
kubectl -n devtroncd rollout restart deploy/dashboard
```

**但日常开发不要这么做**——用 Vite 热更新：

```bash
# 终端 1：后端
kubectl -n devtroncd port-forward svc/devtron-service 8000:80

# 终端 2：前端
cd $ROOT/dashboard
yarn install
yarn start
```

在 `vite.config.mts` 里把 `/orchestrator` 代理到 `http://127.0.0.1:8000`，即可获得秒级热更新。

## 场景三：改某个微服务（比如 kubelink）

```bash
cd $ROOT/devtron-services/kubelink
docker build --platform linux/arm64 -t rexyn-devtron/kubelink:local .

for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/kubelink:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done
kubectl -n devtroncd rollout restart deploy/kubelink
```

## 场景四：改完想跑单测（不进镜像）

```bash
# 需要本机有 Go 1.26
cd $ROOT/devtron
go test ./pkg/pipeline/... ./pkg/app/...

cd $ROOT/devtron-services/kubelink
go test ./...
```

:::note vendor 模式
devtron 用 vendor 目录构建，`go test` 时会直接读 `vendor/`。如果你新增了依赖，需要：

```bash
go mod tidy && go mod vendor
```
:::

## 场景五：改了 wire 依赖注入

Devtron 全系用 `wire` 生成 `wire_gen.go`。新增一个 Provider 后：

```bash
go install github.com/google/wire/cmd/wire@latest
cd $ROOT/devtron
wire          # 重新生成 wire_gen.go
```

忘了跑 `wire` 会得到很迷惑的编译错误：

```text
not enough return values / undefined: NewXxx
```

## 场景六：想同时跑多个版本做对比

给镜像多打几个 tag：

```bash
docker tag rexyn-devtron/devtron:local rexyn-devtron/devtron:v1
docker tag rexyn-devtron/devtron:local rexyn-devtron/devtron:v2
```

然后用 `kubectl set image` 快速切换：

```bash
kubectl -n devtroncd set image deploy/devtron devtron=rexyn-devtron/devtron:v2
kubectl -n devtroncd rollout status deploy/devtron
```

## 场景七：环境彻底重建

```bash
# 1) 删集群
orbctl delete -f k3s137-1 k3s137-2 k3s137-3

# 2) 重新按「搭集群」章节建（3 分钟）
# 3) 重新导入镜像（2 分钟）
/tmp/import-images.sh

# 4) 重新部署（5 分钟）
helm upgrade --install devtron $ROOT/devtron/charts/devtron -n devtroncd --create-namespace \
  -f $ROOT/local-values.yaml --set 'installer.modules={cicd}' --set 'argo-cd.enabled=true'
```

镜像还在本机 Docker 里，不需要重新编译——这是"镜像与集群解耦"的好处。

## 清理磁盘

```bash
# 构建缓存（最占空间）
docker builder prune -f

# 悬空镜像
docker image prune -f

# 看谁在占
docker system df
```

## 一条命令的"改-编-推-重启"

```bash title="hotup.sh"
#!/bin/bash
# 用法：./hotup.sh devtron        （对应 deploy/devtron）
#      ./hotup.sh dashboard
#      ./hotup.sh kubelink
set -e
COMP=${1:?usage: hotup.sh <component>}
ROOT=$HOME/InnovationProjects/DevtronProjects

case $COMP in
  dashboard) CTX="$ROOT/dashboard"; DF="-f Dockerfile.local" ;;
  kit-sensor|git-sensor) CTX="$ROOT/devtron-services/git-sensor"; DF="" ;;
  *) if [ -d "$ROOT/devtron-services/$COMP" ]; then
       CTX="$ROOT/devtron-services/$COMP"
     else
       CTX="$ROOT/$COMP"
     fi
     DF="" ;;
esac

echo ">>> build $COMP from $CTX"
docker build --platform linux/arm64 $DF -t "rexyn-devtron/$COMP:local" "$CTX"

echo ">>> import to nodes"
for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save "rexyn-devtron/$COMP:local" | orb -m $n sudo k3s ctr -n k8s.io images import - >/dev/null
  echo "    ok $n"
done

echo ">>> restart"
export KUBECONFIG=$HOME/.kube/k3s137.yaml
kubectl -n devtroncd rollout restart "deploy/$COMP" 2>/dev/null || \
kubectl -n devtroncd rollout restart "sts/$COMP"
kubectl -n devtroncd rollout status "deploy/$COMP" --timeout=180s
```
