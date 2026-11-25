---
id: rexyn-branch-strategy
title: rexyn-dev 分支模型与上游同步
sidebar_position: 3
---

# rexyn-dev 分支模型与上游同步

深度定制最怕的不是写代码，而是**半年后无法再和上游合并**。所以第一件事不是改代码，而是先把分支模型钉死。

## 一、模型：一条长期分支，两层上游

```text
upstream/main 或 upstream/develop        ← 官方仓库，只 fetch，不提交
        │
        │ 定期 fetch + merge
        ▼
origin/rexyn-dev                         ← 我们唯一的长期分支（11 个仓库同名）
        │
        ├── feat/xxx    （短期，按需，合并回 rexyn-dev 后删除）
        └── fix/xxx
```

三条规则：

1. **`main` / `develop` / `master` 是"上游镜像"，永远不在上面提交**。它们只做两件事：跟随上游快进、作为 diff 的基准。
2. **`rexyn-dev` 是唯一长期分支**，所有定制提交都落在这里，且**分支名在 11 个仓库里完全一致**——这样批量脚本、CI、文档都不需要写例外表。
3. **短期分支可选用**。一个人开发时直接在 `rexyn-dev` 上提交也合法；多人协作或大改动再开 `feat/*`。

:::warning 为什么不在上游已有分支上开发
在上游的 `main` 上直接提交，会让"本地 main"和"upstream/main"永久分叉：既不能用 `git merge --ff-only` 快进，也说不清"哪些提交是我们的、哪些是上游的"。一旦要 rebase，冲突会成倍放大。

用独立分支名 `rexyn-dev` 还有一个隐形好处：`git push origin rexyn-dev` 永远不会撞到上游同名分支，也不会误推到 `upstream`。
:::

## 二、当前基线（2026-11-24 建分支时）

11 个仓库都是从各自**上游默认分支的最新提交**切出来的，没有夹带任何本地提交：

| 仓库 | 分支 | 基线提交 | 提交日期 | 上游默认分支 |
| --- | --- | --- | --- | --- |
| `devtron` | `rexyn-dev` | `cebc4158b` | 2026-11-13 | `main` |
| `devtron-services` | `rexyn-dev` | `a702900ed` | 2026-11-03 | `main` |
| `dashboard` | `rexyn-dev` | `ecea7af01` | 2026-10-28 | `develop` |
| `devtron-fe-common-lib` | `rexyn-dev` | `7fab7bcc` | 2026-10-28 | `develop` |
| `inception` | `rexyn-dev` | `7beef37` | 2025-04-01 | `main` |
| `migrator` | `rexyn-dev` | `e026843` | 2024-05-21 | `main` |
| `notifier` | `rexyn-dev` | `3325764` | 2026-11-03 | `main` |
| `charts` | `rexyn-dev` | `cd8f109` | 2026-11-17 | `main` |
| `kubectl` | `rexyn-dev` | `42c02a9e` | 2026-11-18 | `master` |
| `dex` | `rexyn-dev` | `0beb8a88` | 2026-11-21 | `master` |
| `chart-versions-fix` | `rexyn-dev` | `3384cc5` | 2023-12-14 | `main`（冻结） |

这个表就是"我们的定制从哪开始"的锚点。**每次做上游同步后，把这张表更新一遍**——它是排查"为什么编出来的和官方镜像不一致"的第一份证据。

:::note 基线时刻的未跟踪文件
`dashboard/`、`dex/`、`migrator/`、`chart-versions-fix/` 下各有一个 `Dockerfile.local`（本地构建改造版），它们是**故意不提交**的：`rexyn-dev` 的基线要保持和上游逐字节一致，才能一眼看出我们的定制 diff。这些文件的用法在《编译 + 本地部署》里。
:::

## 三、一次性建分支（已执行，留作复现）

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex chart-versions-fix; do
  git -C "$r" switch -c rexyn-dev
done
```

校验（分支名一致、HEAD 与上游默认分支无差异）：

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex chart-versions-fix; do
  base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
  printf "%-22s %-10s %-10s behind=%s dirty=%s\n" \
    "$r" "$(git -C "$r" branch --show-current)" "$(git -C "$r" rev-parse --short HEAD)" \
    "$(git -C "$r" rev-list --count HEAD..origin/$base)" \
    "$(git -C "$r" status --porcelain | wc -l | tr -d ' ')"
done
```

期望：`rexyn-dev`、`behind=0`；`dirty` 只可能是上面那 4 个 `Dockerfile.local`。

## 四、日常循环

### 4.1 开工前先对齐上游（30 秒）

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  git -C "$r" fetch upstream --prune --quiet
  base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
  printf "%-22s upstream 新增 %s 个提交\n" "$r" "$(git -C "$r" rev-list --count HEAD..upstream/$base)"
done
```

有新增再去 merge，没新增就继续写。**不要每天无脑 merge**——上游一次 release candidate 合进来可能带 300 个文件，正在改的地方会被冲掉。

### 4.2 写代码、提交

```bash
cd $ROOT/devtron
git add -A
git commit -m "feat(rexyn): 新增变更计划接口 /orchestrator/rexyn/plan"
```

提交信息统一带 `rexyn` 作用域，好处是同步上游后可以一条命令筛出"我们到底改了什么"：

```bash
git log --oneline upstream/main..rexyn-dev
```

### 4.3 推到自己的 fork

```bash
cd $ROOT/devtron
git push -u origin rexyn-dev        # 首次带 -u，之后直接 git push
```

11 个仓库一起推：

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  git -C "$r" push -u origin rexyn-dev
done
```

:::danger 别把 rexyn-dev 推到 upstream
`upstream` 是只读的官方仓库，你没有写权限，误推只会得到 403；但如果哪天加了别人的仓库做 upstream 且有权，一次误推就会把定制代码送到不该去的地方。习惯上永远写 `git push origin`，不要用 `git push` 裸命令。
:::

## 五、上游同步：为什么用 merge，不用 rebase

| 方式 | 结果 | 适用 |
| --- | --- | --- |
| **merge**（推荐） | 保留上游提交为祖先，冲突只在合并点解一次 | 长期分支的定期同步 |
| rebase | 历史线性好看，但每次同步要重解全部冲突，且改写历史（推送后需要 force） | 单人、短周期、分支未共享 |
| cherry-pick | 只拿单个修复 | 紧急拿某个上游补丁 |

定期同步用 merge：

```bash
cd $ROOT/devtron
git fetch upstream --prune
git merge upstream/main            # 冲突在这里一次解决
git push origin rexyn-dev
```

一次同步全部 10 个仓库（遇冲突即停，人工处理后再继续）：

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  echo "===== $r ====="
  base=$(git -C "$r" rev-parse --abbrev-ref origin/HEAD | sed 's#origin/##')
  git -C "$r" fetch upstream --prune --quiet
  if git -C "$r" merge --no-edit "upstream/$base"; then
    git -C "$r" push origin rexyn-dev
  else
    echo "!! $r 有冲突，停下来处理：cd $r && git status"
    break
  fi
done
```

### 5.1 冲突高发区（按概率排序）

| 位置 | 为什么会冲突 | 处理原则 |
| --- | --- | --- |
| `devtron/vendor/**` | 上游每次改依赖都会重排 vendor | **永远接受上游**，然后 `go mod tidy && go mod vendor` 重新生成我们的部分 |
| `devtron/wire_gen.go`、各服务 `wire_gen.go` | 生成物，上游改 Provider 就整段变 | 接受上游后用 `wire` 重新生成，**不要手工合并** |
| `go.mod` / `go.sum` 的 `replace` 行 | 上游会改 `common-lib` 的 commit 指针 | 取上游版本，再检查本地联调用的 `../devtron-services/common-lib` 有没有残留 |
| `dashboard/package.json` + `yarn.lock` | 依赖与 `devtron-fe-common-lib` 版本号强绑定 | 取上游，再按需改回我们的 resolutions |
| `devtron/charts/devtron/values.yaml` | 我们加了 Rexyn 的镜像/环境变量 | 保留我们的块，其余取上游 |
| `scripts/sql/` 号段 | 上游新增迁移号可能撞我们的号 | 我们的迁移**统一用 900+ 号段**，从根上避免 |

:::tip 迁移号段约定
上游迁移已经用到 3xx。定制迁移一律从 `900_` 开始（`900_rexyn_xxx.up.sql`），永远不和上游抢号。这一条能省掉未来 90% 的迁移冲突。
:::

### 5.2 同步后的验证矩阵

同步不是"merge 成功就完事"。按下表逐项过，任何一项红都要在推 `rexyn-dev` 之前解决：

```text
[ ] 1. git log --oneline upstream/<base>..rexyn-dev   → 只剩我们的提交
[ ] 2. cd devtron && go build ./...                    → 通过（vendor 模式）
[ ] 3. cd devtron && wire && git diff --stat wire_gen.go → 与提交一致
[ ] 4. cd devtron-services/kubelink && go build ./...  → 通过
[ ] 5. cd dashboard && yarn install && yarn build       → 通过
[ ] 6. docker build devtron / kubelink / dashboard      → 三个镜像能编出来
[ ] 7. 部署后 /orchestrator/health                      → 200
[ ] 8. 登录 + 应用列表 + 一次部署                        → 功能回归
```

第 2、3 步最容易出问题：上游改了 `common-lib` 的接口，`devtron` 的 `replace` 指向的 commit 还没更新，就会出现 `undefined: xxx`。修法是让两个仓库回到**同一时间点**：

```bash
grep -n "devtron-services" $ROOT/devtron/go.mod
grep -n "devtron-services" $ROOT/devtron-services/*/go.mod | head
```

## 六、版本与发布

定制版不跟 Devtron 的 `v2.2.1` 语义混用，自己打标签：

```text
rexyn-v0.1.0     第一个可部署的定制版（基线 = 本文第二节的表）
rexyn-v0.1.1     修 bug，不涉及上游同步
rexyn-v0.2.0     完成一次上游同步 + 新功能
```

打标签时把 11 个仓库的 commit 记进一个文件（例如 `rexyn-release-0.2.0.txt`），这是唯一能精确重建某次发布的方式：

```bash
cd $ROOT
for r in devtron devtron-services dashboard devtron-fe-common-lib inception migrator \
         notifier charts kubectl dex; do
  echo "$r $(git -C "$r" rev-parse HEAD)"
done | tee rexyn-release-0.2.0.txt
```

## 七、文档同步契约

这是本项目群的硬规则：**代码在 `rexyn-dev` 上变了，两本书的对应章节必须同批更新**，不允许"下周补文档"。

| 你改了什么 | 必须更新的章节（本书） | 必须更新的章节（编译书） |
| --- | --- | --- |
| 新增/修改 API、路由、DTO | `devtron-api`、`recipes` | — |
| 改业务域逻辑（pipeline/app/chart/argo） | `devtron-domain` | `workflow`（若影响构建产物） |
| 加 wire Provider / 换实现 | `devtron-wire` | — |
| 改内置 chart / 参考 chart | `devtron-inner-charts` | `deploy`（values 变化时） |
| 改某个微服务 | `repo-services` + 对应 `svc-*` | `build-services` |
| 加前端页面 / 组件 | `repo-dashboard`、`repo-fe-common-lib` | `build-dashboard` |
| 加数据库迁移 | `repo-migrator` | `deploy`（迁移 Job 行为） |
| 加通知渠道 | `repo-notifier` | `build-misc` |
| 改分支模型 / 同步流程 | 本章 | `branch-strategy` |
| 改 Rexyn 定位或接口面 | `rexyn-positioning` | `architecture`（若组件角色变化） |

契约的精简版本（仓库清单、基线、硬规则）在各代码仓库根目录的 `AGENTS.md`，本章是它在"开发"视角下的展开。

:::tip 一条自检命令
每完成一轮改动，问自己一句：**"如果明天有人只看电子书去复现，他会卡在哪一步？"** 答案就是这一轮必须补的那一节。
:::
