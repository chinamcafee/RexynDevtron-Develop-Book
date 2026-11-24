---
id: build-dashboard
title: 编译 dashboard 前端
sidebar_position: 4
---

# 编译 dashboard 前端

dashboard 是 React + Vite + Yarn 4 项目，它依赖同组织的 `devtron-fe-common-lib`。

```text
dashboard (React SPA)  ──depends on──►  @devtron-labs/devtron-fe-common-lib
                                          version: 4.0.14-pre-2
```

## 1. 先看原 Dockerfile 能不能直接用

```bash
cd $ROOT/dashboard
head -30 Dockerfile
```

```dockerfile
FROM node:24-alpine AS builder
WORKDIR /app
RUN corepack enable yarn && yarn set version 4.9.2
COPY package.json . / yarn.lock . / .yarn/ .yarn/ / .yarnrc.yml ./
RUN apk add --no-cache git
RUN yarn install --immutable --network-timeout 600000
COPY . .
RUN echo `git rev-parse --short=9 HEAD` > health.html && yarn build

FROM fholzer/nginx-brotli:v1.26.2     # ← 这里会失败
```

构建会立刻报错：

```text
ERROR: fholzer/nginx-brotli:v1.26.2: not found
```

**原因**：这个 tag 已被上游删除（现存最早的是 `v1.29`）。

## 2. 用 `Dockerfile.local` 修正基础镜像

不动仓库原文件，另建一份：

```bash
cd $ROOT/dashboard
sed 's#fholzer/nginx-brotli:v1.26.2#fholzer/nginx-brotli:v1.31.8#' Dockerfile > Dockerfile.local
grep -n "^FROM" Dockerfile.local
```

```text
1:FROM node:24-alpine AS builder
23:FROM fholzer/nginx-brotli:v1.31.8
```

然后构建：

```bash
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/dashboard:local .
```

首次约 10–12 分钟（`yarn install` 是大头）。

## 3. 构建过程发生了什么

| 阶段 | 动作 | 耗时占比 |
| --- | --- | --- |
| `yarn set version 4.9.2` | 通过 corepack 固定 Yarn 版本 | 小 |
| `yarn install --immutable` | 按 `yarn.lock` 精确安装依赖 | **最大** |
| `yarn build` | Vite 打包到 `dist/` | 中 |
| `COPY dist /usr/share/nginx/html` | 静态资源进 nginx | 小 |

`--immutable` 表示"锁文件必须与 package.json 完全一致"，任何不一致都会失败。这也是为什么**不要**随手改 `package.json` 的依赖版本。

## 4. 关于 devtron-fe-common-lib

`package.json` 里写的是：

```json
"@devtron-labs/devtron-fe-common-lib": "4.0.14-pre-2"
```

这个包**发布在公共 npm registry** 上，与本地仓库版本号一致：

```bash
npm view @devtron-labs/devtron-fe-common-lib version
# 4.0.15
npm view @devtron-labs/devtron-fe-common-lib@4.0.14-pre-2 version
# 4.0.14-pre-2
```

所以标准构建走的是 npm 上的包——**版本号相同，内容就是同一个 commit 的产物**。

### 如果你改的是 common-lib 源码

那就必须让 dashboard 用本地版本，两种做法：

**做法 A：yarn resolutions 指向本地 tarball**

```bash
cd $ROOT/devtron-fe-common-lib
yarn install
yarn build            # 产出 dist/
yarn pack             # 得到 devtron-labs-devtron-fe-common-lib-4.0.14-pre-2.tgz
```

在 dashboard 里加：

```json
"resolutions": {
  "@devtron-labs/devtron-fe-common-lib": "file:./common-lib.tgz"
}
```

把 tgz 放到 `$ROOT/dashboard/common-lib.tgz`，构建时去掉 `--immutable`：

```dockerfile
RUN yarn install --network-timeout 600000
```

**做法 B：用 `yarn link`（只适合本地调试，不适合出镜像）**

```bash
cd $ROOT/devtron-fe-common-lib && yarn link
cd $ROOT/dashboard && yarn link @devtron-labs/devtron-fe-common-lib
yarn start
```

:::tip 结论
- 只想跑起来：**不用管**，直接用 npm 上的包；
- 要改公共组件库：用做法 A，把 tgz 打进镜像，保证可复现。
:::

## 5. 验证镜像

```bash
docker run --rm --platform linux/arm64 -d -p 18080:8080 --name dash-test rexyn-devtron/dashboard:local
sleep 3
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:18080/
curl -s http://127.0.0.1:18080/env-config.js | head -5
docker rm -f dash-test
```

期望 `200`，且 `env-config.js` 里能看到 `ENABLE_CI_JOB: true` 之类的运行时配置。

## 6. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `yarn install` 卡在 `Fetching` | 网络慢 | 加 `--network-timeout 600000`（Dockerfile 已有） |
| `The lockfile would have been modified` | 用了 `--immutable` 但依赖被改过 | 去掉 `--immutable`，或先 `yarn install` 提交新 lock |
| 页面白屏 | 静态资源 404 | 检查 nginx 是否把 `/dashboard` 前缀配好（镜像里 `nginx.conf` 已处理） |
| `health.html` 内容为空 | 构建上下文里没有 `.git` | 无害；它只用于健康检查显示版本 |

## 7. 前端本地开发（不改镜像时）

```bash
cd $ROOT/dashboard
yarn install
yarn start          # Vite dev server，默认 3000 端口
```

把后端指向集群：

```bash
kubectl -n devtroncd port-forward svc/devtron-service 8000:80
```

然后在 `vite.config.mts` 的 proxy 里把 `/orchestrator` 指到 `http://127.0.0.1:8000`（或用环境变量），即可实现前端热更新 + 真实后端联调。
