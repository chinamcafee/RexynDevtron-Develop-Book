---
id: branch-strategy
title: 切到 rexyn-dev 分支并建立同步基线
sidebar_position: 3
---

# 切到 rexyn-dev 分支并建立同步基线

克隆完成之后、编译之前，还有一步不能省：**给 11 个仓库统一切一个同名分支 `rexyn-dev`**。

原因不是洁癖。这套代码要做深度定制，同时还要定期和上游同步；如果定制提交落在上游分支上，"我们的改动"和"上游的改动"就再也分不开了。

## 1. 分支模型

```text
upstream/main（或 develop / master）   ← 官方，只 fetch
        │
        │ 定期 merge
        ▼
origin/rexyn-dev                       ← 唯一长期分支，11 个仓库同名
        │
        ├── feat/xxx                    ← 可选，短期
        └── fix/xxx
```

| 分支 | 角色 | 能不能提交 |
| --- | --- | --- |
| `main` / `develop` / `master` | 上游镜像，diff 的基准 | **不能** |
| `rexyn-dev` | 定制主线，所有构建都从这里出 | 能 |
| `feat/*`、`fix/*` | 短期分支，合回 `rexyn-dev` 后删掉 | 能 |

## 2. 一次性建分支

```bash
export ROOT=$HOME/InnovationProjects/DevtronProjects
cd "$ROOT"

for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex chart-versions-fix; do
  git -C "$r" switch -c rexyn-dev
done
```

命令是幂等的"一次成功"型：如果某个仓库已经有 `rexyn-dev`，`switch -c` 会报 `already exists`，改用 `git -C "$r" switch rexyn-dev` 即可。

:::note 工作区里的未跟踪文件不会丢
`switch -c` 只移动 HEAD，不动工作区。`dashboard/Dockerfile.local`、`dex/Dockerfile.local`、`migrator/Dockerfile.local`、`chart-versions-fix/Dockerfile.local` 这几个本地构建改造版会原样留在工作区——它们**故意不提交**，这样 `rexyn-dev` 的基线才能和上游逐字节一致，方便 `git diff upstream/main` 看出我们的定制。
:::

## 3. 校验

```bash
cd "$ROOT"
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex chart-versions-fix; do
  base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
  printf "%-22s %-10s %-10s behind=%-3s dirty=%s\n" \
    "$r" "$(git -C "$r" branch --show-current)" "$(git -C "$r" rev-parse --short HEAD)" \
    "$(git -C "$r" rev-list --count HEAD..origin/$base)" \
    "$(git -C "$r" status --porcelain | wc -l | tr -d ' ')"
done
```

期望输出（2026-11-24 建分支时的实测值）：

```text
devtron                rexyn-dev  cebc4158b  behind=0   dirty=0
devtron-services       rexyn-dev  a702900ed  behind=0   dirty=0
dashboard              rexyn-dev  ecea7af01  behind=0   dirty=1
devtron-fe-common-lib  rexyn-dev  7fab7bcc   behind=0   dirty=0
inception              rexyn-dev  7beef37    behind=0   dirty=0
migrator               rexyn-dev  e026843    behind=0   dirty=1
notifier               rexyn-dev  3325764    behind=0   dirty=0
charts                 rexyn-dev  cd8f109    behind=0   dirty=0
kubectl                rexyn-dev  42c02a9e   behind=0   dirty=0
dex                    rexyn-dev  0beb8a88   behind=0   dirty=1
chart-versions-fix     rexyn-dev  3384cc5    behind=0   dirty=1
```

三个判据：

1. 分支名全是 `rexyn-dev`；
2. `behind=0`（没有落后上游）；
3. `dirty` 只可能是那 4 个 `Dockerfile.local`。

## 4. 建立同步基线

这一步是为了回答"我这份代码到底是什么版本"，将来编出来的镜像和官方不一致时，第一件事就是查它。

```bash
cd "$ROOT"
{
  echo "# rexyn-dev baseline  $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
           notifier charts kubectl dex chart-versions-fix; do
    base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
    printf "%-22s %-10s %s  (upstream/%s)\n" \
      "$r" "$(git -C "$r" rev-parse --short HEAD)" \
      "$(git -C "$r" log -1 --format='%ad' --date=short)" "$base"
  done
} | tee rexyn-baseline.txt
```

得到的文件长这样：

```text
# rexyn-dev baseline  2026-11-24T08:52:11Z
devtron                cebc4158b  2026-11-13  (upstream/main)
devtron-services       a702900ed  2026-11-03  (upstream/main)
dashboard              ecea7af01  2026-10-28  (upstream/develop)
devtron-fe-common-lib  7fab7bcc   2026-10-28  (upstream/develop)
inception              7beef37    2025-04-01  (upstream/main)
migrator               e026843    2024-05-21  (upstream/main)
notifier               3325764    2026-11-03  (upstream/main)
charts                 cd8f109    2026-11-17  (upstream/main)
kubectl                42c02a9e   2026-11-18  (upstream/master)
dex                    0beb8a88   2026-11-21  (upstream/master)
chart-versions-fix     3384cc5    2023-12-14  (upstream/main)
```

`inception`（2025-04）、`migrator`（2024-05）、`chart-versions-fix`（2023-12）这三个日期很旧，但都是上游真实现状，不是克隆出错——官方也早就没在这三个仓库上动了。

:::tip 把它纳入版本管理
`rexyn-baseline.txt` 建议提交到项目群根目录（不进任何一个子仓库），和 `local-values.yaml` 放在一起。每次上游同步后重新生成一份，就得到一条"版本时间线"。
:::

## 5. 分支和构建的关系

一个常见误解：以为切了分支要重新 `docker build`。其实不用——`docker build` 用的是**工作区内容**，不是某个分支的快照。分支只影响两件小事：

| 影响点 | 说明 |
| --- | --- |
| `dashboard` 的 `health.html` / `SENTRY_RELEASE_VERSION` | `Dockerfile.local` 里用 `git rev-parse --short=9 HEAD` 取版本号，切分支后这个值会变 |
| 镜像里的版本标识 | 部分 `Makefile` 会把 commit 编进二进制；从 `main` 切到 `rexyn-dev` 后 commit 未变，所以值不变 |

真正需要重建的时机是**代码变了**，不是**分支变了**。

## 6. 上游同步之后要重建什么

同步（`git merge upstream/main`）会引入上游改动，按改动范围决定重建清单：

| 上游改了什么 | 要重建 | 要不要重新部署 |
| --- | --- | --- |
| `devtron` 的 Go 代码 / `scripts/sql` / 内置 chart | `devtron:local` | 是（含迁移 Job） |
| `devtron-services/<svc>` | 对应服务镜像 | 是 |
| `devtron-services/common-lib` | **所有** Go 服务 + `devtron` | 是 |
| `dashboard` / `devtron-fe-common-lib` | `dashboard:local` | 是 |
| `devtron/charts/devtron` | 不用重建镜像，`helm upgrade` 即可 | 是 |
| `charts`（集成模块） | 不用重建，重新同步 Chart Store | 否 |
| `kubectl` / `dex` | `kubectl:fork` / `dex:fork` | 是（替换镜像） |

同步 + 重建的完整循环：

```bash
cd "$ROOT/devtron"
git fetch upstream --prune && git merge upstream/main

# 按上表挑要编的，例如只动了 devtron
docker build --platform linux/arm64 -t rexyn-devtron/devtron:local .
for n in k3s137-1 k3s137-2 k3s137-3; do
  docker save rexyn-devtron/devtron:local | orb -m $n sudo k3s ctr -n k8s.io images import -
done
kubectl -n devtroncd rollout restart deploy/devtron
```

更细的重建策略见[日常迭代工作流](./workflow)。

## 7. 一次同步全部 10 个仓库

```bash
cd "$ROOT"
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  echo "===== $r ====="
  base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
  git -C "$r" fetch upstream --prune --quiet
  if git -C "$r" merge --no-edit "upstream/$base"; then
    git -C "$r" push origin rexyn-dev
  else
    echo "!! $r 冲突，停下来处理：cd $r && git status"
    break
  fi
done
```

`chart-versions-fix` 不在循环里：它的上游从 2023-12-14 起就没有新提交，同步它只会得到一个空 merge。

:::warning 冲突了不要硬来
高发区是 `vendor/`、`wire_gen.go`、`go.mod` 的 `replace` 行、`dashboard/yarn.lock`。原则：**生成物和依赖清单一律取上游，然后重新生成**；只保留我们真正写的代码。细节见配套电子书《源码剖析与二次开发》的“rexyn-dev 分支模型与上游同步”一章。
:::

## 8. 接下来

分支就位、基线落盘，可以回去继续[编译总览](./build-overview)了。编译产物与分支无关——你现在在 `rexyn-dev` 上编出来的，就是将来定制版的第一个基线镜像。
