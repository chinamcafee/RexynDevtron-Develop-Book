---
id: repo-dashboard
title: dashboard｜前端控制台
sidebar_position: 1
---

# dashboard｜前端控制台

## 它是什么

Devtron 的 Web 界面。技术栈：

| 项 | 选择 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | **Vite**（`vite.config.mts`） |
| 包管理 | **Yarn 4**（通过 corepack 固定版本） |
| 路由 | react-router |
| 状态 | 以 hooks + context 为主，部分 Redux |
| 样式 | SCSS + 自研组件（`devtron-fe-common-lib`） |
| 打包产物 | 静态文件，由 nginx 提供 |

## 目录结构

```text
dashboard/src/
├── index.tsx           # 入口
├── App.tsx             # 路由与全局 Provider
├── Pages/              # 页面（按业务域分目录）
│   ├── Applications/   # 应用列表/详情
│   ├── App/            # 应用配置
│   ├── ChartStore/     # Chart 商店
│   ├── GlobalConfigurations/
│   ├── Releases/
│   └── ...
├── components/         # 通用组件（会逐步迁到 common-lib）
├── services/           # API 调用封装
├── config/             # 常量、路由表
├── util/               # 工具函数
└── css/                # 全局样式
```

## 请求是怎么发出去的

`services/` 里对每类资源有一个 service 文件，底层用统一封装的 fetch：

```ts
// 示意
export const getAppList = (params) =>
  get(`${URLS.APPLICATION}/list`, params);
```

关键点：

- 所有请求前缀 `/orchestrator`（由 nginx 反代到 devtron）
- Token 放在 header `token`，或 cookie `argocd.token`
- 401 时统一跳登录页（在 `App.tsx` 的拦截器里）

## 路由与页面组织

路由表在 `src/config` 附近，页面按业务域分目录。以"应用列表"为例：

```text
/dashboard/application-management/devtron-app/list
  └── src/Pages/Applications/...
```

:::tip 找页面的方法
浏览器里看到某个页面，想看代码在哪：

1. 记下 URL 路径（如 `application-management/devtron-app/list`）
2. 在 `src/config/routes.ts`（或类似文件）里搜索这段
3. 找到对应的组件 import 路径
:::

## 新增一个页面的最小步骤

### 1. 建目录

```text
src/Pages/MyFeature/
├── index.tsx
├── MyFeature.tsx
├── types.ts
└── service.ts
```

### 2. 写页面

```tsx title="src/Pages/MyFeature/MyFeature.tsx"
import { useEffect, useState } from 'react';
import { get } from '@Services/service';
import { URLS } from '@Config/constants';

export default function MyFeature() {
  const [data, setData] = useState<any[]>([]);

  useEffect(() => {
    get(`${URLS.APP}/deployment/count/1`).then((r) => setData(r.result));
  }, []);

  return (
    <div className="p-20">
      <h2>我的新页面</h2>
      <pre>{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
```

### 3. 注册路由

在路由表里加一条，指向 `MyFeature`。

### 4. 加导航入口

菜单配置通常在 `src/config` 下的 nav 定义里，加一项即可。

### 5. 本地验证

```bash
cd $ROOT/dashboard
yarn install
yarn start
```

Vite 会起 dev server（默认 3000），改代码秒级热更新。

## 构建与部署

```bash
docker build --platform linux/arm64 -f Dockerfile.local -t rexyn-devtron/dashboard:local .
```

产物是 `dist/`，最终被 COPY 进 nginx 的 `/usr/share/nginx/html`。

:::warning 路由刷新 404
SPA 的经典问题。镜像里的 `nginx.conf` 已经配置了 `try_files $uri $uri/ /index.html`，如果你自己改 nginx 配置，别忘了这条。
:::

## 我要改它，从哪下手

| 需求 | 位置 |
| --- | --- |
| 改应用列表的列/筛选 | `src/Pages/Applications/` |
| 改部署表单 | `src/Pages/App/` 下的部署相关组件 |
| 加全局提示/弹窗 | `src/components/` 或 common-lib |
| 改主题色 | `src/css/` + `:root` 变量 |
| 加一个新的 API service | `src/services/` |

## 前端开发的两个实用约定

1. **组件优先放 common-lib**：如果组件会被多个页面用，放 `devtron-fe-common-lib`，否则后续会被要求迁移；
2. **类型定义跟着 API 走**：`types.ts` 尽量与后端 `bean` 对齐，减少运行时字段错位。

## 动手验证

```bash
cd $ROOT/dashboard

# 页面数量
find src/Pages -maxdepth 1 -type d | wc -l

# 有多少 service 文件
ls src/services | wc -l

# 找某个 API 路径在哪定义
grep -rn "deployment/count" src/ | head
```
