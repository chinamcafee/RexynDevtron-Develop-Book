---
id: repo-migrator
title: migrator｜数据库迁移的真相
sidebar_position: 2
---

# migrator｜数据库迁移的真相

## 它是什么

Devtron 有 4 个数据库（`orchestrator`、`lens`、`gitsensor`、`casbin`），每次升级都可能改表结构。`migrator` 就是负责跑这些迁移的组件。

在 chart 里它以 **Helm Hook Job** 的形式出现，分 4 个：

```bash
kubectl -n devtroncd get jobs | grep migrate
# postgresql-migrate-casbin
# postgresql-migrate-devtron
# postgresql-migrate-gitsensor
# postgresql-migrate-lens
```

## 一个反直觉的事实

**官方 `migrator` 镜像里装的不是这个仓库编出来的程序。**

```bash
docker run --rm --entrypoint sh quay.io/devtron/migrator:v4.16.2 -c "which migrate; ls /usr/local/bin"
# /usr/local/bin/migrate
# migrate
```

而仓库的 `main.go` 编出来叫 `migrator`，是个"克隆 Git 仓库再迁移"的自定义程序。

chart 里实际执行的是：

```bash
/bin/sh -c "migrate -path /scripts/sql -database postgres://... up"
```

也就是 **golang-migrate 的官方 CLI**。

### 为什么会这样

历史演进：早期 Devtron 用自己的 migrator 程序（从 Git 拉脚本），后来改用标准的 `migrate` CLI + 镜像内置的 `scripts/sql`，但仓库里的 `Dockerfile` 没跟着改。

所以你自己构建时必须修正，否则 Job 会以 `Exit Code 127`（`migrate: not found`）失败。

## 正确的最小 Dockerfile

```dockerfile title="migrator/Dockerfile.local"
FROM golang:1.25-alpine AS build-env
RUN apk add --no-cache git gcc musl-dev
RUN go install -tags 'postgres' github.com/golang-migrate/migrate/v4/cmd/migrate@v4.16.2

FROM alpine:3.21
RUN apk add --no-cache ca-certificates git bash
COPY --from=build-env /go/bin/migrate /usr/local/bin/migrate
ENTRYPOINT ["/usr/local/bin/migrate"]
```

## 迁移脚本从哪来

不在 migrator 镜像里，而在 **devtron 镜像**里：

```text
devtron/scripts/sql/
├── 001_xxx.up.sql / .down.sql
├── 002_...
└── ...
```

chart 的 Job 会：

1. 用 `devtron` 镜像跑一个 initContainer，把 `/scripts` 拷到共享卷；
2. 用 `migrator` 镜像跑主容器，`migrate -path /shared/sql up`。

所以**改了 devtron 的 SQL 脚本，必须重新构建 devtron 镜像**——只换 migrator 镜像没用。

## 迁移的执行顺序

```text
postgres Pod 就绪
   ├── postgresql-migrate-casbin     → casbin 库（权限）
   ├── postgresql-migrate-devtron    → orchestrator 库（主库）
   ├── postgresql-migrate-gitsensor  → gitsensor 库
   └── postgresql-migrate-lens       → lens 库
          ↓
     各服务启动并连库
```

四个 Job 是并行的（互相独立），但都要等 postgres。

## 我要改它

| 需求 | 位置 |
| --- | --- |
| 加一张表 | `devtron/scripts/sql/` 新建 `NNN_xxx.up.sql` + `.down.sql` |
| 加一个库 | chart 的 postgres 初始化脚本 + 新建 migrate Job |
| 改迁移版本（跳版） | Job 的 `MIGRATE_TO_VERSION` 环境变量 |
| 回滚 | `migrate ... down 1` |

### 写迁移脚本的规范

```sql
-- 099_create_my_table.up.sql
CREATE TABLE IF NOT EXISTS my_table (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    created_on TIMESTAMP DEFAULT now()
);

-- 099_create_my_table.down.sql
DROP TABLE IF EXISTS my_table;
```

三条铁律：

1. **必须有 down 脚本**（回滚要用）；
2. 用 `IF NOT EXISTS` / `IF EXISTS`，保证幂等；
3. 不要修改已发布的迁移文件，永远新增。

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `Exit Code 127` + `migrate: not found` | 用了仓库原始 Dockerfile | 用上面的 `Dockerfile.local` |
| `Dirty database version N` | 上次迁移中途失败 | 手动 `migrate force N` 后重跑 |
| `no change` 但表不存在 | 脚本没打进 devtron 镜像 | 重建 devtron 镜像 |
| Job 一直 Pending | PVC/资源不足 | `kubectl describe job` 看事件 |

## 动手验证

```bash
# 1) 看当前迁移版本
kubectl -n devtroncd exec postgresql-postgresql-0 -c postgres -- \
  psql "postgresql://postgres:<pw>@127.0.0.1:5432/orchestrator" \
  -c "select * from schema_migrations;"

# 2) 看某个 Job 的日志
kubectl -n devtroncd logs job/postgresql-migrate-devtron-xxxxx

# 3) 手动跑一次（调试用）
kubectl -n devtroncd run migrate-test --rm -it --restart=Never \
  --image=rexyn-devtron/migrator:local -- \
  migrate -path /scripts/sql -database "postgres://..." version
```

`schema_migrations` 表是 golang-migrate 的元数据表，`version` 列就是当前版本号，`dirty` 为 true 表示上次迁移失败需要人工干预。
