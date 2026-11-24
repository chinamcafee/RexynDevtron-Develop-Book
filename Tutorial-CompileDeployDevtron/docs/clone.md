---
id: clone
title: Fork 并克隆到本地
sidebar_position: 2
---

# Fork 并克隆到本地

11 个仓库 = 核心 8 个（上游 `devtron-labs`）+ 周边 3 个（上游分别是 `kubernetes`、`dexidp`、`devtron-labs`）。

:::note 周边 3 个也要 fork 吗
- `kubectl`、`dex`：想"完全脱离 quay.io/devtron"就必须 fork，因为默认镜像来自那里；
- `chart-versions-fix`：全新部署**不需要**它的镜像，但仍建议 fork 存档——万一以后要恢复 2023 年前的老库，会用到。
:::

## 1. 批量 fork

GitHub Web 的 fork 页面一次只能操作一个仓库。11 个仓库推荐两种方式。

### 方式 A：网页逐个点（最稳）

对每个仓库打开：

```text
https://github.com/<upstream-owner>/<repo>/fork
```

- Owner 选择你自己的账号
- **取消勾选 "Copy the main branch only"**
- 点 "Create fork"

### 方式 B：API 批量（需要 classic PAT）

```bash
export GITHUB_TOKEN=<你的 classic token，需 repo 权限>

REPOS=(
  "devtron|devtron-labs" "devtron-services|devtron-labs" "dashboard|devtron-labs"
  "devtron-fe-common-lib|devtron-labs" "inception|devtron-labs" "migrator|devtron-labs"
  "notifier|devtron-labs" "charts|devtron-labs"
  "kubectl|kubernetes" "dex|dexidp" "chart-versions-fix|devtron-labs"
)

for item in "${REPOS[@]}"; do
  repo=${item%%|*}; owner=${item##*|}
  curl -s -X POST -H "Authorization: Bearer $GITHUB_TOKEN" \
       -H "Accept: application/vnd.github+json" \
       "https://api.github.com/repos/$owner/$repo/forks" \
       -o /dev/null -w "$owner/$repo -> %{http_code}\n"
done
```

:::warning fine-grained token 不行
Fine-grained PAT **无法**创建 fork（会返回 `403 Resource not accessible by personal access token`）。这是 GitHub 的产品限制，不是权限配错。要么用 classic PAT，要么走网页。
:::

## 2. 校验 fork 结果

```bash
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts \
         kubectl dex chart-versions-fix; do
  curl -s -H "Authorization: Bearer $GITHUB_TOKEN" \
    "https://api.github.com/repos/chinamcafee/$r" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
if d.get('message'): print('$r', 'MISSING')
else: print('$r', 'fork=',d.get('fork'), 'branch=',d.get('default_branch'), 'parent=', (d.get('parent') or {}).get('full_name'))
"
done
```

期望输出（分支要特别注意 `develop`，parent 要特别注意周边 3 个）：

```text
devtron fork= True branch= main parent= devtron-labs/devtron
devtron-services fork= True branch= main parent= devtron-labs/devtron-services
dashboard fork= True branch= develop parent= devtron-labs/dashboard
devtron-fe-common-lib fork= True branch= develop parent= devtron-labs/devtron-fe-common-lib
inception fork= True branch= main parent= devtron-labs/inception
migrator fork= True branch= main parent= devtron-labs/migrator
notifier fork= True branch= main parent= devtron-labs/notifier
charts fork= True branch= main parent= devtron-labs/charts
kubectl fork= True branch= master parent= kubernetes/kubectl
dex fork= True branch= master parent= dexidp/dex
chart-versions-fix fork= True branch= main parent= devtron-labs/chart-versions-fix
```

## 3. 克隆（origin 指向 fork）

```bash
export ROOT=$HOME/InnovationProjects/DevtronProjects
mkdir -p "$ROOT" && cd "$ROOT"

for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts \
         kubectl dex chart-versions-fix; do
  git clone "git@github.com:chinamcafee/$r.git" "$r"
done
```

如果没配 SSH key，把 `git@github.com:` 换成 `https://github.com/`。

## 4. 加上 upstream 远程

方便以后同步官方更新。注意周边 3 个的上游不是同一个组织：

```bash
cd "$ROOT"
REPOS=(
  "devtron|devtron-labs" "devtron-services|devtron-labs" "dashboard|devtron-labs"
  "devtron-fe-common-lib|devtron-labs" "inception|devtron-labs" "migrator|devtron-labs"
  "notifier|devtron-labs" "charts|devtron-labs"
  "kubectl|kubernetes" "dex|dexidp" "chart-versions-fix|devtron-labs"
)

for item in "${REPOS[@]}"; do
  repo=${item%%|*}; owner=${item##*|}
  git -C "$repo" remote add upstream "https://github.com/$owner/$repo.git"
done
```

校验：

```bash
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts \
         kubectl dex chart-versions-fix; do
  printf "%-24s %-8s %-40s %s\n" "$r" \
    "$(git -C $r rev-parse --abbrev-ref HEAD)" \
    "$(git -C $r remote get-url origin | sed 's#.*:##')" \
    "$(git -C $r ls-files | wc -l | tr -d ' ') files"
done
```

期望（文件数会随版本变化）：

```text
devtron                  main     chinamcafee/devtron.git                 18401 files
devtron-services         main     chinamcafee/devtron-services.git        47921 files
dashboard                develop  chinamcafee/dashboard.git                1835 files
devtron-fe-common-lib    develop  chinamcafee/devtron-fe-common-lib.git     1561 files
inception                main     chinamcafee/inception.git                    99 files
migrator                 main     chinamcafee/migrator.git                    946 files
notifier                 main     chinamcafee/notifier.git                    140 files
charts                   main     chinamcafee/charts.git                     1152 files
kubectl                  master   chinamcafee/kubectl.git                     779 files
dex                      master   chinamcafee/dex.git                         619 files
chart-versions-fix       main     chinamcafee/chart-versions-fix.git            10 files
```

## 5. 记录基线 commit

后面排查"为什么我编出来的和官方镜像不一致"时，这个文件很有用：

```bash
cd "$ROOT"
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator notifier charts \
         kubectl dex chart-versions-fix; do
  echo "$r $(git -C $r rev-parse HEAD)"
done | tee build-baseline.txt
```

:::tip 加速小技巧
如果之前已经克隆过官方仓库，可以用本地仓库做 reference 加速克隆：

```bash
git clone --reference /path/to/upstream/devtron.git --dissociate git@github.com:chinamcafee/devtron.git devtron
```

`--dissociate` 会把对象复制进新仓库，克隆完成后不再依赖那个本地参考仓库。

## 6. 切到 rexyn-dev 分支

克隆完不要直接在上游分支上编译或改代码。11 个仓库统一切一个同名分支：

```bash
cd "$ROOT"
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex chart-versions-fix; do
  git -C "$r" switch -c rexyn-dev
done
```

完整的校验、基线快照、以及"同步上游后要重建哪些镜像"，见下一章[切到 rexyn-dev 分支并建立同步基线](./branch-strategy)。

:::info 为什么 11 个仓库、只有 10 个要同步
`chart-versions-fix` 的上游从 2023-12-14 起就冻结了（一次性修数据工具，新部署不需要）。给它建同名分支只为"分支模型统一、批量脚本不用写例外"，它不参与定制，也不参与上游同步。
:::
:::
