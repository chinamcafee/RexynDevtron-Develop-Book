---
id: dashboard-i18n
title: dashboard 全量多语种架构（i18n）
sidebar_position: 3
---

# dashboard 全量多语种架构（i18n）

这是 RexynOps 定制版 Devtron 的第一个功能性改造：**dashboard 的全部界面文案接入翻译管道，中文覆盖率 100%，新增一种语言只需增加一个语言文件**。

"全量"不是"改了登录页和导航"——dashboard 有 1200+ 个 ts/tsx 文件、2117 条唯一界面文案。逐文件手工替换既做不完，也会让上游同步彻底失守。这里采用的是一套**构建期自动包裹 + 运行时 DOM 兜底 + 源文案词典 + 语言文件自动发现**的组合方案。

## 一、最终结果

| 指标 | 数值 |
| --- | --- |
| 扫描文件（dashboard） | 1222 个（`src/**/*.ts,tsx`，排除 mock/fixture） |
| 扫描文件（common-lib） | 925 个（`devtron-fe-common-lib/src`） |
| 唯一文案 | 2452（dashboard）+ 602（common-lib） |
| 中文词典覆盖 | **100%**（两处均 100%） |
| 对上游源文件的侵入 | **0 个文件**（除 7 个接线点） |
| 新增语言成本 | 1 个文件 |

覆盖率可以用命令随时复算，不依赖人工统计：

```bash
cd $ROOT/dashboard
yarn i18n:extract     # 打印统计并生成 i18n-report.json
yarn i18n:check       # 覆盖率不足 100% 时以非 0 退出，可挂 CI
```

## 二、三层机制：为什么不能只有一套

Devtron 的文案分三类，必须用三种方式处理：

| 类型 | 例子 | 方案 | 原因 |
| --- | --- | --- | --- |
| 存量与上游新增的裸文案 | `<span>Overview</span>`、`label="User ID"` | **构建期自动包裹** → `tx('Overview')` | 2117 条散落在 541 个文件里，手工改不完；上游每次合并还会带来新文案 |
| 新写的、需要插值/复数的文案 | `t('login.ssoLoginWith', { provider })` | **结构化词条** → `locales/*.ts` 的 `messages` | 语序在不同语言里不同，拼接字符串必然出错 |
| 常量对象、common-lib、后端枚举 | `{ label: 'Sample' }`、弹窗按钮、模块名 | **运行时 DOM 兜底** → `AutoTranslate` | 不在 JSX 里、或是编译后的第三方包；且不能改常量值（会破坏 `===` 比较） |

三者共用同一个语言来源，互不冲突：

```text
localStorage / navigator
        │
        ▼
  normalizeLanguage()
        │
        ├── t('login.submit')  → messages 树（结构化）
        └── tx('Overview')     → auto 词典（源文案 → 译文）
```

## 三、构建期自动包裹是怎么做的

插件在 `tools/i18n/rexyn-i18n-auto-plugin.mjs`，以 `enforce: 'pre'` 挂在 Vite 上，对每个 `src/**/*.tsx` 做三件事：

```text
JSX 文本节点   <span>Overview</span>        →  <span>{__rexynTx("Overview")}</span>
展示型属性     label="User ID"               →  label={__rexynTx("User ID")}
注入导入       （文件首次命中时）             →  import { tx as __rexynTx } from "@I18n/runtime"
```

**为什么放在构建期，而不是一次性改源码：**

1. 上游每次 `merge` 都会带来新的英文文案，构建期处理能自动覆盖，不需要再跑一遍 codemod；
2. `git diff upstream/develop` 里看不到 413 个文件的改动噪音，冲突面接近 0；
3. `tsc` / `eslint` 仍然检查原始源码，转换不会引入类型错误；
4. 想撤回这项能力，删掉插件一行即可，源码零残留。

**跳过规则**（避免误伤）：

| 规则 | 原因 |
| --- | --- |
| `src/i18n/**`、`.d.ts`、`*.test.*` | 词条文件本身不该被翻译 |
| `<pre>` / `<code>` / `<kbd>` / `<samp>` 内的文本 | 代码样例、命令、YAML 片段不应翻译 |
| 不含两个以上字母、长度 < 2 或 > 160 | 版本号、符号、长段落 |
| 已被 `tx()` 包裹的节点 | 幂等 |

**空白处理**：多行 JSX 文本会把换行和缩进折成单个空格（`replace(/\s+/g, ' ')`），行首/行尾的行内空格用显式的 `{' '}` 保留。这条规则在插件与提取脚本里必须完全一致，否则会出现"统计 100% 但运行时查不到"的假象——本项目踩过一次，已在两处统一。

### 3.4 运行时兜底层：常量与 common-lib 怎么办

仅靠构建期插件会漏掉三类文案，实测在"全局配置""Stack 管理器"等页面仍然整屏英文：

| 漏掉的类型 | 例子 | 为什么插件管不到 |
| --- | --- | --- |
| 常量/配置对象里的展示字段 | `SWITCH_ITEM_SEGMENTS = [{ label: 'Sample' }]`、`ModulesSection = [{ name: 'Discover' }]` | 不是 JSX 字面量，而是对象属性值 |
| `devtron-fe-common-lib` 内部文案 | 弹窗按钮、表格空态、分页器 | 独立 npm 包，编译产物无法插桩 |
| 后端返回的静态枚举名 | 模块名、集成状态 | 运行时才有值 |

**不能**直接翻译常量值——代码里有大量 `item.label === 'Custom'`、`route.name === 'Installed'` 的比较，改了值就会破坏逻辑。

因此增加一层 `src/i18n/AutoTranslate.tsx`，在 React 树外做 DOM 兜底：

```text
渲染完成 → 遍历文本节点 + placeholder/title/aria-label
        → 在 auto 词典里精确查表 → 命中则替换
        → MutationObserver 监听后续变更（路由切换、弹窗、异步数据）
```

三个关键设计：

1. **只做精确命中**：词典 key 是完整的界面文案，不会误伤用户输入或接口返回的业务数据；
2. **不改源码常量值**：`label === 'Custom'` 这类比较仍然成立；
3. **跳过代码区**：`pre/code/kbd/samp`、`textarea`、`contenteditable`、`[data-i18n-skip]`。

代价是首屏多一次全量 DOM 遍历（毫秒级），以及"英文先出现、下一帧变中文"的极短闪烁；对内部管理台可以接受。

**词典必须显式覆盖 common-lib**：DOM 层只做精确命中，词典里没有的文案不会翻译。提取 common-lib 文案的方式：

```bash
I18N_ROOT=../devtron-fe-common-lib \
I18N_ZH_LOCALE=$PWD/src/i18n/locales/zh.ts \
yarn i18n:extract
```

翻译结果写成 JSON 后合并：

```bash
node tools/i18n/merge-translations.mjs /tmp/trans1.json
```

当前 common-lib 收录 602 条，覆盖其 `src` 下的 JSX 文本、展示型属性与常量对象。

## 四、语言自动发现：一个文件 = 一种语言

`src/i18n/locales/` 下的每个 `.ts` 文件都会被 `import.meta.glob` 自动注册，**不需要改任何注册代码**：

```ts
// src/i18n/locales/index.ts
const discovered = import.meta.glob<LocaleModule>(['./*.ts', '!./index.ts'], { eager: true })

export const LOCALES = Object.entries(discovered).reduce(/* 校验 meta/messages，按 code 建索引 */)
export const SUPPORTED_LANGUAGES = Object.keys(LOCALES).sort()
```

一个语言文件由三部分组成：

```ts
export const meta = {
    code: 'zh',
    label: '简体中文',      // 切换器里显示的名字，用该语言自身书写
    htmlLang: 'zh-CN',     // 写入 <html lang>
    intlLocale: 'zh-CN',   // Intl 日期/数字格式化
    direction: 'ltr',      // 预留给阿拉伯语等 RTL 语言
}

export const messages: TranslationSchema = { /* 结构化词条，类型由 en.ts 强制对齐 */ }

export const auto: Record<string, string> = { /* 源文案 → 译文，供构建期包裹的 tx() 查表 */ }
```

`LANGUAGE_LABELS`、`HTML_LANG`、`INTL_LOCALE`、`TEXT_DIRECTION` 这些映射全部由 `meta` 派生，不再手写。**加一种语言 = 新建一个文件**，语言切换器、`<html lang>`、日期格式会自动跟上。

## 五、运行时行为

```ts
i18n.init({
    resources,                    // 由 LOCALES 自动汇总
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'currentOnly',
    initAsync: false,             // 同步初始化，首屏就是正确语言
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
})
```

| 行为 | 说明 |
| --- | --- |
| 首次访问 | 按 `navigator.language` 选（`zh-CN`/`zh-TW`/`zh-Hans` 都归一化到 `zh`），并写回 localStorage |
| 记住选择 | `localStorage["rexyn.devtron.language"]` |
| 切换语言 | 写 localStorage → **整页刷新**；入口通过 portal 插入头部动作区，与 Create / 头像**线性排列**（登录页在卡片右上角） |
| `<html lang>` / `dir` | 由 `I18nProvider` 同步，影响字体回退、屏幕阅读器、RTL |
| `document.title` | 走 `t('app.title')`，随语言变化 |

:::warning 为什么要刷新页面
`tx()` 是构建期注入的普通函数调用，不在 React 的订阅体系里，语言变化无法触发这些组件重渲染。用整页刷新换取"2116 条文案 100% 覆盖"，是这个取舍的核心。手动用 `t()` 的页面本来可以无刷新，但为了行为一致，统一走刷新。
:::

## 六、词条与翻译规范

1. **源文案即 key**（`auto` 词典）：与代码里的英文逐字一致，包括大小写和标点；改英文等于改 key，`i18n:extract` 会立刻把旧条目变成"缺失"。
2. **key 不做语义化重命名**：存量代码的文案就是契约，重命名会让翻译历史断代。
3. **结构化词条用语义 key**（`messages`）：`login.submit` 而不是 `'Login'`，方便插值与复数。
4. **术语统一**：

| 英文 | 中文 | 备注 |
| --- | --- | --- |
| Application | 应用 | 不译"应用程序" |
| Pipeline | 流水线 | |
| Environment | 环境 | |
| Chart | Chart | 不译"图表" |
| Image | 镜像 | |
| Registry | 镜像仓库 | |
| Cluster | 集群 | |
| Authorization | 授权 | 与 Authentication（认证）区分 |

## 七、覆盖率工具与 CI

```bash
yarn i18n:extract   # i18n-report.json：总量、覆盖率、Top 20 文件、缺失清单
yarn i18n:todo      # i18n-todo.json：待翻译清单（含出现次数）
yarn i18n:check     # 覆盖率 < 100% 时退出码 1
```

建议把 `i18n:check` 挂到 CI 的 lint 阶段。上游合并后新增的英文文案会自动出现在缺失清单里，形成"翻译债可见"的机制，而不是等用户切到中文才发现。

## 八、新增一种语言（只加一个文件）

以日语为例：

```ts
// src/i18n/locales/ja.ts
import type { TranslationSchema } from './en'

export const meta = {
    code: 'ja',
    label: '日本語',
    htmlLang: 'ja',
    intlLocale: 'ja-JP',
    direction: 'ltr',
}

export const messages: TranslationSchema = { /* 结构必须与 en.ts 完全一致 */ }

export const auto: Record<string, string> = { /* 按 i18n-todo.json 逐条翻译 */ }
```

保存后：

- 语言切换器自动多出"日本語"；
- `<html lang>`、日期/数字格式自动切到 `ja-JP`；
- `yarn i18n:extract` 立刻按新语言计算覆盖率。

不需要改 `constants.ts`、`index.ts`、`I18nProvider`、切换器组件中的任何一行。

## 九、与上游共存

| 改动类型 | 文件数 | 说明 |
| --- | --- | --- |
| 新增 | 12 个 | `src/i18n/**`（10，含 `AutoTranslate.tsx`）、`tools/i18n/rexyn-i18n-auto-plugin.mjs`、`tools/i18n/extract.mjs` |
| 接线 | 8 个 | `index.tsx`、`App.tsx`、`Login.tsx`、`LoginForm.tsx`、`Navigation.tsx`、`vite.config.mts`、`tsconfig.json`、`package.json` |
| 依赖 | 3 个运行时 + 4 个构建期 | i18next 27 / react-i18next 18 / browser-languagedetector 8；@babel/{parser,traverse,generator,types} |

上游合并后的标准动作：

```bash
git merge upstream/develop
yarn i18n:check        # 新增文案会出现在缺失清单
# 补完 zh.ts 的 auto 词条，再提交
```

## 十、已知边界

| 边界 | 现状 | 后续方案 |
| --- | --- | --- |
| 被表达式切开的句子 | `Deploy {name} now` 会拆成两段分别翻译，中文语序可能生硬 | 改为 `t('deploy.action', { name })` 结构化词条，逐句人工改造 |
| 动态拼接的字符串（变量里的英文） | 构建期不处理；若整段文本最终作为一个文本节点渲染，运行时可命中 | 用 `t()` / `tx()` 显式包裹 |
| `devtron-fe-common-lib` 组件内部文案 | 静态文本已被运行时兜底层覆盖；含变量的拼接句子仍是英文 | 给 common-lib 接入同一套 i18n（需本地构建并 vendor） |
| 后端返回的错误消息 | 仍是英文（来自 API，且通常带变量） | 在 `showError` 做错误码→文案映射 |
| 语言偏好的用户级同步 | 仅浏览器维度 | 接 Rexyn 用户中心后登录时拉取偏好 |

## 十一、验证记录

```text
[✓] tsc --noEmit                     0 error
[✓] eslint src/i18n --max-warnings 0 0 error
[✓] vite build                       成功（插件处理 2479 个模块，耗时约 2s）
[✓] i18n:extract                     dashboard 2452/2452 + common-lib 602/602，覆盖率 100%
[✓] moment / dayjs locale 随语言初始化（相对时间不再出现 A Few Seconds Ago）
[✓] 产物包含 en/zh 两套词条与 tx 运行时
```

构建期插件的耗时：2479 次 transform 调用约 2 秒（占整体构建约 27%），可以接受；如后续明显变慢，可加 `id` 白名单只处理 `src/Pages` 与 `src/components`。
