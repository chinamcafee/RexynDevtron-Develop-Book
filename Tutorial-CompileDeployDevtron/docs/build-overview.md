---
id: build-overview
title: 编译总览与策略
sidebar_position: 1
---

# 编译总览与策略

:::info 2026-11-24 起，镜像前缀统一为 `rexyn-devtron`
早期实测用的是 `devtron-local/*` 前缀。自本项目群进入 RexynOps 定制阶段起，所有自建镜像统一改名到 **`rexyn-devtron/*`**，本文命令、values 与校验脚本都已按新前缀更新。两者镜像内容完全一致，只有仓库名前缀不同；集群里残留的 `devtron-local/*` 旧镜像应清除（见[日常迭代工作流](./workflow)的清理小节），不要与新镜像混用。
:::

## 要编哪些镜像

一共 **13 个核心镜像** + **3 个周边镜像**（周边三个来自独立的 fork 仓库，可自建也可搬运；其中 `devtron-utils` 对全新部署并非必需）：

| 来源仓库 | 镜像 | 预计耗时（M2 及同级，首次冷缓存） |
| --- | --- | --- |
| devtron | `devtron:local` | 25–35 min |
| devtron-services | `git-sensor:local` | 8–10 min |
| devtron-services | `kubelink:local` | 15–20 min |
| devtron-services | `kubewatch:local` | 10–14 min |
| devtron-services | `lens:local` | 7–9 min |
| devtron-services | `chart-sync:local` | 5–7 min |
| devtron-services | `ci-runner:local` | 6–8 min |
| devtron-services | `image-scanner:local` | 6–8 min |
| devtron-services | `authenticator:local` | 5–7 min |
| dashboard | `dashboard:local` | 10–12 min |
| inception | `inception:local` | 4–6 min |
| migrator | `migrator:local`（本地改造版） | 2–3 min |
| notifier | `notifier:local` | 4–6 min |
| kubectl（fork） | `kubectl:fork` | 3–5 min |
| dex（fork） | `dex:fork` | 8–10 min |
| chart-versions-fix（fork，可选） | `devtron-utils:fork` | 2–3 min |
| 或直接搬运（最省事） | `dex:v2.30.2`、`devtron-utils:dup-chart-repo-v1.1.0`、`kubectl:local` | < 1 min |

:::info 为什么这么慢
每个 Dockerfile 都是"全新容器 + 空 Go 构建缓存"，`go build` 要把全部依赖重新编译一遍。并行 4 个任务时，16 核机器大约 60–80 分钟能全部跑完。
:::

## 统一命名规范

所有产物统一打到 `rexyn-devtron/` 前缀下，tag 一律 `local`（三方搬运件沿用原 tag 或改 `local`）：

```text
rexyn-devtron/devtron:local
rexyn-devtron/dashboard:local
rexyn-devtron/git-sensor:local
...
rexyn-devtron/kubectl:fork     # 从 chinamcafee/kubectl 编译
rexyn-devtron/dex:fork         # 从 chinamcafee/dex 编译
rexyn-devtron/devtron-utils:fork  # 可选，全新部署不需要
```

这样 Helm values 里只需改一个 `registry` 字段：

```yaml
components:
  devtron:
    registry: rexyn-devtron
    image: "devtron:local"
```

拼接规则在 chart 的 `_helpers.tpl` 里：

```gotemplate
{{- define "common.image" -}}
{{- $registryName := .component.registry | default .global.containerRegistry -}}
{{- $imageName := .extraImage | default .component.image -}}
...
{{- printf "%s/%s:%s" $registryName $imageName $imageTag -}}
```

## 为什么直接用仓库自带的 Dockerfile

三个理由：

1. **它才是官方发布镜像的真实构建方式**（CI 就是 `docker build` 这些文件）；
2. 多阶段构建把 Go 工具链、`wire` 代码生成、运行时的 `ca-certificates`、`scripts/` 目录都处理好了，自己写 Dockerfile 容易漏；
3. 编译产物与官方镜像结构一致，出问题时能直接对比。

只有两处必须偏离原文件，都用 `Dockerfile.local` 承载：

| 组件 | 原文件问题 | 处理 |
| --- | --- | --- |
| dashboard | `FROM fholzer/nginx-brotli:v1.26.2`，该 tag 已被删除 | 换成 `v1.31.8` |
| migrator | 仓库 Dockerfile 编的是自定义 `migrator` 二进制，但 chart 调用的是 `migrate` CLI | 用 `golang-migrate` 官方 CLI 重建 |

## 构建镜像的通用模板

```bash
docker build --platform linux/arm64 -t rexyn-devtron/<name>:local <上下文目录>
```

三个要点：

- `--platform linux/arm64`：显式声明目标架构。OrbStack 的 Docker 本身就是 arm64，但不写这一行，未来在 CI 上跑 x86 时行为会变。
- `<上下文目录>`：**devtron-services 的每个子目录各自是独立上下文**，不要在 monorepo 根目录构建。
- 不要加 `--no-cache`，层缓存能省掉大量重复工作。

## 并行策略

16 核机器建议 **4 路并行**。8 路并行时内存和 I/O 会打满，反而更慢。书里给的是一个带并发上限的脚本：

```bash title="build-all.sh"
#!/bin/bash
set -u
ROOT=$HOME/InnovationProjects/DevtronProjects
LOG=/tmp/build-logs; mkdir -p "$LOG"

build_one() {
  local name=$1 ctx=$2 tag=$3 start=$(date +%s)
  if docker build --platform linux/arm64 -t "$tag" "$ctx" > "$LOG/$name.log" 2>&1; then
    echo "OK   $name $(( $(date +%s) - start ))s"
  else
    echo "FAIL $name  (see $LOG/$name.log)"
  fi
}

jobs=(
"devtron|$ROOT/devtron|rexyn-devtron/devtron:local"
"git-sensor|$ROOT/devtron-services/git-sensor|rexyn-devtron/git-sensor:local"
"kubelink|$ROOT/devtron-services/kubelink|rexyn-devtron/kubelink:local"
"kubewatch|$ROOT/devtron-services/kubewatch|rexyn-devtron/kubewatch:local"
"lens|$ROOT/devtron-services/lens|rexyn-devtron/lens:local"
"chart-sync|$ROOT/devtron-services/chart-sync|rexyn-devtron/chart-sync:local"
"ci-runner|$ROOT/devtron-services/ci-runner|rexyn-devtron/ci-runner:local"
"image-scanner|$ROOT/devtron-services/image-scanner|rexyn-devtron/image-scanner:local"
"authenticator|$ROOT/devtron-services/authenticator|rexyn-devtron/authenticator:local"
"inception|$ROOT/inception|rexyn-devtron/inception:local"
"migrator|$ROOT/migrator|rexyn-devtron/migrator:local"
"notifier|$ROOT/notifier|rexyn-devtron/notifier:local"
)

i=0
for item in "${jobs[@]}"; do
  IFS='|' read -r n c t <<< "$item"
  build_one "$n" "$c" "$t" &
  i=$((i+1))
  [ $((i % 4)) -eq 0 ] && wait
done
wait
echo "ALL DONE"
```

运行：

```bash
chmod +x build-all.sh && ./build-all.sh
```

想边跑边看某个组件进度：

```bash
tail -f /tmp/build-logs/kubelink.log
```

## 分步执行（推荐第一次这样走）

如果你想理解每一步在干什么，按后面四节逐个执行：

1. [编译 devtron-services 的 7 个微服务](./build-services)
2. [编译 devtron 主程序](./build-devtron)
3. [编译 dashboard 前端](./build-dashboard)
4. [编译 inception / migrator / notifier 与镜像搬运](./build-misc)
