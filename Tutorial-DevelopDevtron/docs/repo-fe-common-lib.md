---
id: repo-fe-common-lib
title: devtron-fe-common-lib｜前端公共组件库
sidebar_position: 2
---

# devtron-fe-common-lib｜前端公共组件库

## 它是什么

`dashboard` 的"私有 UI 库"。所有跨页面复用的组件、hooks、工具函数、类型定义都在这里，以 npm 包 `@devtron-labs/devtron-fe-common-lib` 的形式被 dashboard 引用。

```text
devtron-fe-common-lib  ──npm──►  dashboard
```

它是**独立发版**的：版本号跟着 dashboard 的 `package.json` 走。

## 目录结构

```text
src/
├── Shared/
│   ├── Components/     # 通用 UI 组件（按钮、表格、抽屉、Toast...）
│   ├── Hooks/          # 自定义 hooks（useAsync, useDebounce...）
│   ├── Services/       # 通用 API 调用
│   ├── Store/          # 共享状态
│   ├── Providers/      # Context Provider（主题、权限...）
│   ├── Helpers.tsx     # 工具函数
│   ├── constants.tsx
│   ├── types.ts
│   └── validations.tsx
├── Common/             # 更底层的通用资源
├── Assets/             # 图标、图片
├── Pages/              # 少量共享页面片段
└── index.ts            # 导出入口
```

## 版本关系（最容易踩的坑）

```text
dashboard/package.json
  "@devtron-labs/devtron-fe-common-lib": "4.0.14-pre-2"

devtron-fe-common-lib/package.json
  "version": "4.0.14-pre-2"
```

两者必须**精确一致**。改 common-lib 后如果没发版，dashboard 用的是 npm 上的旧版本，你的改动不会生效。

### 三种联调方式

| 方式 | 适用 | 命令 |
| --- | --- | --- |
| A. 本地打包 + resolutions | 要出镜像 | `yarn pack` → dashboard 里 `"resolutions": {"...": "file:./common-lib.tgz"}` |
| B. `yarn link` | 只做本地调试 | `yarn link` 两边各一次 |
| C. 真发版 | 团队协作 | 改版本号 → `npm publish` → dashboard 改依赖 |

:::danger 千万别提交 `yarn link`
`yarn link` 只改本地全局状态，不进 `package.json`，所以不会破坏 CI；但也意味着**别人拉你的代码不会得到同样的行为**。团队协作必须走 A 或 C。
:::

## 加一个通用组件的流程

### 1. 建组件

```text
src/Shared/Components/MyButton/
├── MyButton.tsx
├── MyButton.scss
├── types.ts
└── index.ts
```

```tsx title="MyButton.tsx"
import { MyButtonProps } from './types';
import './MyButton.scss';

export const MyButton = ({ label, onClick, variant = 'primary' }: MyButtonProps) => (
  <button className={`my-btn my-btn--${variant}`} onClick={onClick}>
    {label}
  </button>
);
```

### 2. 导出

```ts title="src/Shared/Components/index.ts"
export * from './MyButton';
```

### 3. 本地构建

```bash
cd $ROOT/devtron-fe-common-lib
yarn install
yarn build      # 产出 dist/
```

### 4. 在 dashboard 里用

如果走 resolutions + tgz：

```bash
yarn pack       # 生成 devtron-labs-devtron-fe-common-lib-4.0.14-pre-2.tgz
cp devtron-labs-devtron-fe-common-lib-4.0.14-pre-2.tgz $ROOT/dashboard/common-lib.tgz
```

dashboard 的 `package.json`：

```json
"resolutions": {
  "@devtron-labs/devtron-fe-common-lib": "file:./common-lib.tgz"
}
```

然后 `yarn install`（去掉 `--immutable`）。

## 我要改它，从哪下手

| 需求 | 位置 |
| --- | --- |
| 加通用按钮/表格/抽屉 | `src/Shared/Components/` |
| 加通用 hook | `src/Shared/Hooks/` |
| 改主题变量 | `src/Shared/Providers/` + SCSS 变量 |
| 加通用 API 封装 | `src/Shared/Services/` |
| 加类型定义 | `src/Shared/types.ts` |

## 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| dashboard 编译报 `Module not found: @devtron-labs/devtron-fe-common-lib` | tgz 路径不对 / 没 install | 检查 `file:` 路径，重跑 `yarn install` |
| 组件改了但 dashboard 没变 | 用的是 npm 版本 | 确认 resolutions 生效（`yarn why @devtron-labs/devtron-fe-common-lib`） |
| 类型报错 | dist 没重新生成 | `yarn build` 后再 pack |
| `--immutable` 冲突 | lock 与 package.json 不一致 | 去掉 `--immutable` 或提交新 lock |

## 动手验证

```bash
cd $ROOT/devtron-fe-common-lib

# 组件数量
ls src/Shared/Components | wc -l

# 导出是否完整
grep -c "export" src/index.ts

# 构建产物
yarn build && ls dist | head
```
