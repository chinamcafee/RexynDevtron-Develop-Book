---
id: repo-chart-versions-fix
title: chart-versions-fix｜一次性清洁工，新部署无需使用
sidebar_position: 7
---

# chart-versions-fix｜一次性清洁工，新部署无需使用

## 它是什么

`chinamcafee/chart-versions-fix` fork 自 `devtron-labs/chart-versions-fix`，它对应的镜像是：

```text
quay.io/devtron/devtron-utils:dup-chart-repo-v1.1.0
```

名字里的 `dup-chart-repo` 已经说明了用途：**清理重复的 chart 仓库数据**。它不是服务、不是控制器、也不参与任何运行时逻辑，只在数据库迁移前跑一次。

## 为什么会有这个仓库

把时间线摆出来就清楚了：

```text
2023-12-14  24f519427  fix: chart sync duplicate charts (#4321)   ← devtron 主仓
2023-12-14  3384cc5    wip                                        ← chart-versions-fix
```

同一天，Devtron 做了两件事：

1. 新增迁移 `205_app_store_unique_constraint`，给 `app_store` 和 `app_store_application_version` 建唯一索引；
2. 写了一个小程序，先把历史遗留的重复行清掉，否则第 1 步会失败。

```sql title="205_app_store_unique_constraint.up.sql"
CREATE UNIQUE INDEX app_store_unique_oci_repo   ON app_store (name, docker_artifact_store_id) WHERE active=true;
CREATE UNIQUE INDEX app_store_unique_chart_repo ON app_store (name, chart_repo_id)          WHERE active=true;
CREATE UNIQUE INDEX app_store_version_unique    ON app_store_application_version (app_store_id, name, version);
```

**它不是"停更的组件"，而是"和 205 配套发布的一次性修数据工具"，任务完成即冻结。** 三年不更新是正常状态，不是技术债。

:::danger 新版本 / 未来 fork 工程：无需使用
如果你从未部署过 2023 年前的老版本，并且以后都是"fork 源码 → 全新部署"：

- 空库上 205 建唯一索引必然成功，它无事可做；
- 索引建好后 `chart-sync` 写入是 `ON CONFLICT DO NOTHING`，新重复不会再产生；
- 它不参与运行时，删掉不影响任何功能。

**唯一仍需它的场景**：恢复 2023 年前的老库 dump。此时跳过它，205 会报 `could not create unique index ... duplicate key`。
:::

## 代码结构

```text
chart-versions-fix/
├── main.go                         两个清理函数的入口
├── sql/
│   ├── AppStoreApplicationVersionRepository.go
│   └── connection.go               go-pg 连接（从环境变量读 PG_*）
├── Dockerfile                      原始构建（golang:1.20）
└── chart-version-fix-job.yaml      独立的 Job 样例
```

`main.go` 只做两件事：

| 函数 | 逻辑 |
| --- | --- |
| `cleanDuplicateAppStoreApplicationVersions` | 按 `(name, version)` 找重复版本，把 `installed_app_versions` 重指到保留行，迁移 `latest` 标记，删除重复行 |
| `cleanDuplicateAppStoreCharts` | 按 `(chart 名, repo)` 找重复 app_store，保留版本数最多的那个，其余标记 `active=false` 并删掉其版本行 |

## 协作边界

```text
postgresql-migrate-devtron (Job)
├── initContainer: clean-duplicate-chart   ← 本仓库的二进制
├── initContainer: init-devtron            ← 把 /scripts 拷到共享卷
└── container:     migrate ... up          ← 执行 001..NNN，包括 205
```

它必须排在 `migrate` 之前，因为 205 建唯一索引时要求数据已经干净。chart 里这个 initContainer 是**无条件**的，所以每次 `helm upgrade` 都会跑一次（空转）。

## 它自己的三个缺陷

如果真要保留"老库升级"能力，这三点必须知道：

1. **去重 key 过激**：版本去重只用 `(name, version)`，不含 `app_store_id`；而 205 的索引是 `(app_store_id, name, version)`。两个仓库都有 `nginx 1.0.0` 时，它会把其中一条删掉，并把已安装应用指向另一个仓库——等于悄悄改了来源。
2. **外键没处理全**：硬删 `app_store_application_version` 前只重指了 `installed_app_versions`；`chart_group_entry`、`app_store_version_values` 也有外键且无级联，这些表有数据时会删除失败。
3. **失败静默**：出错只 `log` + `return`，迁移继续跑，然后在 205 处炸掉，错误现场被推迟。

## 我要改它

对全新部署，最正确的"改造"是**删掉它**：

```text
values.yaml:255                    删掉 duplicateChartImage
templates/migrator.yaml:116-139    删掉 name: clean-duplicate-chart 的 initContainer
devtron-bom.yaml:170               同步删掉（样例配置，非渲染必需）
```

如果确实要保留老库升级能力，建议用**幂等 SQL** 替代，而不是继续维护这个 Go 程序：

```sql
-- 选每个 (app_store_id, name, version) 的最小 id 作为保留行
CREATE TEMP TABLE dup_version_map AS
SELECT id AS dup_id,
       first_value(id) OVER (PARTITION BY app_store_id, name, version ORDER BY id) AS keep_id,
       latest
FROM app_store_application_version;
DELETE FROM dup_version_map WHERE dup_id = keep_id;

-- 重指三张引用表，再删除重复行（完整脚本见编译书 4.3）
```

## 动手验证

```bash
# 1) 看这个镜像到底在哪被调用
kubectl -n devtroncd get job postgresql-migrate-devtron-xxxxx \
  -o jsonpath='{.spec.template.spec.initContainers[*].name}{"\n"}'
# clean-duplicate-chart init-devtron

# 2) 确认你的库根本不需要它
kubectl -n devtroncd exec postgresql-postgresql-0 -c postgres -- \
  psql "postgresql://postgres:<pw>@127.0.0.1:5432/orchestrator" -tAc "
select count(*) from (select name, chart_repo_id from app_store where active group by 1,2 having count(*)>1) x;
select count(*) from (select app_store_id,name,version from app_store_application_version group by 1,2,3 having count(*)>1) y;"
# 0
# 0   ← 全 0 就说明它每次都在空转

# 3) 唯一索引已经在了
kubectl -n devtroncd exec postgresql-postgresql-0 -c postgres -- \
  psql "postgresql://postgres:<pw>@127.0.0.1:5432/orchestrator" -tAc "
select indexname from pg_indexes where indexname like 'app_store%unique%';"
```
