---
id: dashboard-i18n
title: dashboard 多语种架构（i18n）
sidebar_position: 3
---

# dashboard 多语种架构（i18n）

这是 RexynOps 定制版 Devtron 的第一个功能性改造：**dashboard 原生支持中英双语，可随时切换、无需刷新、不丢当前页面**。

"原生"的意思是：语言不是一层外挂的翻译插件，而是和路由、主题、权限一样，属于应用运行时的一部分——初始化早于首屏渲染，切换后 `<html lang>`、日期/数字格式、导航搜索关键词全部跟着变。

## 一、目标与非目标

| 目标 | 说明 |
| --- | --- |
| 首批两种语言 | `en`（源语言，兜底）、`zh`（简体中文） |
| 随时切换 | 登录页、左侧导航都能切；切换不刷新、不跳路由 |
| 记住选择 | 存 `localStorage`，下次打开还是上次的语言 |
| 跟随浏览器 | 首次访问按 `navigator.language` 自动选（`zh-CN`→中文） |
| 增量迁移 | 未翻译的文案保持英文，不出现空白或 `login.submit` 这种裸 key |
| 可扩展 | 新增语种只改 2 个文件，不动组件 |

非目标（明确不做，避免过度设计）：

- 不做**按用户存到后端**的语言偏好（现在按浏览器维度；接 Rexyn 用户中心时再加）；
- 不做 URL 前缀路由（`/zh/...`）——Devtron 的 SSO 回调和 `continue` 参数会把路径拼得很脆；
- 不做运行时远程词条下发（词条随镜像发布，便于版本可追溯）。

## 二、选型

| 依赖 | 版本 | 作用 |
| --- | --- | --- |
| `i18next` | 27.x | 翻译核心：插值、复数、命名空间、回退 |
| `react-i18next` | 18.x | `useTranslation`，语言变化触发重渲染 |
| `i18next-browser-languagedetector` | 8.x | 从 localStorage / navigator 探测语言 |

为什么不是 `react-intl`：Devtron 的文案大量是"运行时拼装"（导航树、模块名、状态枚举），i18next 的 `t(key, { defaultValue })` 回退语义更适合渐进式迁移；`FormattedMessage` 组件式 API 在改造存量代码时侵入性更大。

为什么不自研：复数、插值转义、回退链、语言变化订阅这四件事都能自己写，但加起来就是 300 行需要长期维护的代码，而 i18next 已经被 React 生态验证过。

## 三、目录与职责

```text
src/i18n/
├── constants.ts          语言清单、存储 key、<html lang>、Intl locale、语言归一化
├── locales/
│   ├── en.ts             源语言；同时用 typeof 推导出词条结构类型
│   └── zh.ts             用 TranslationSchema 强类型约束，少一个 key 就编译报错
├── index.ts              i18next 初始化（同步、内联资源）+ 统一导出
├── useI18n.ts            组件里唯一入口：t / language / setLanguage / 格式化
├── I18nProvider.tsx      把语言同步到 React 之外（<html lang>、document.title）
├── LanguageSwitcher.tsx  下拉切换器（登录页、后续顶栏）
├── LanguageSwitcher.scss
├── navigation.ts         导航树读取时翻译（不改上游 constants.ts）
└── format.ts             日期 / 数字 / 货币 / 相对时间
```

一条硬约定：**组件不直接 `import i18n`**。只有非 React 代码（请求拦截器、错误上报）才用 `i18n.t`，其余一律走 `useI18n()`，否则语言切换后组件不会重渲染。

## 四、初始化：为什么不会有"英文闪一下"

```tsx title="src/index.tsx"
import App from './App'
// 副作用导入：i18n 必须在任何组件渲染前完成初始化
import { I18nProvider } from './i18n'

createRoot(root).render(
    <React.StrictMode>
        <I18nProvider>
            <QueryClientProvider>
                <ThemeProvider>
                    <RouterProvider router={router} />
                </ThemeProvider>
            </QueryClientProvider>
        </I18nProvider>
    </React.StrictMode>,
)
```

关键在 `initAsync: false` + 资源内联：

```ts title="src/i18n/index.ts"
i18n.use(LanguageDetector).use(initReactI18next).init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: [...SUPPORTED_LANGUAGES],
    load: 'currentOnly',
    initAsync: false,        // 同步初始化，首屏就是正确语言
    returnNull: false,
    interpolation: { escapeValue: false },   // React 已转义，避免中文引号变实体
    detection: {
        order: ['localStorage', 'navigator'],
        lookupLocalStorage: LANGUAGE_STORAGE_KEY,
        caches: ['localStorage'],
        convertDetectedLanguage: (language) => normalizeLanguage(language),
    },
    react: { useSuspense: false },
})
```

如果以后词条涨到几百 KB，再改成 `initAsync: true` + 按语言动态 `import()`；那时候才需要 Suspense 和骨架屏。

## 五、语言判定与持久化

```ts
SUPPORTED_LANGUAGES = ['en', 'zh']
LANGUAGE_STORAGE_KEY = 'rexyn.devtron.language'   // 带 rexyn 前缀，避免与 Devtron 自身存储冲突
```

判定顺序：

```text
localStorage 有值？
  ├── 是 → 归一化（zh / zh-CN / zh-Hans / zh-TW → zh；其余 → en）
  └── 否 → navigator.language → 归一化 → 写回 localStorage
```

三个容易踩的点：

1. **必须归一化**。`zh-CN`、`zh-TW`、`zh-Hans` 都是"中文"，但 i18next 默认会去找 `zh-CN` 资源，找不到就掉回英文。`normalizeLanguage` 把它们统一收敛到 `zh`。
2. **`load: 'currentOnly'`**。否则 i18next 会尝试 `zh-CN → zh → en` 的链式回退，白白多查两次。
3. **不要用 cookie**。Devtron 的 SSO 回调会跨域跳转，cookie 的 `SameSite` 和域名匹配很容易把语言偏好弄丢；`localStorage` 同源、无过期，够用。

`I18nProvider` 负责把语言同步到 React 之外：

```tsx
useEffect(() => {
    document.documentElement.lang = HTML_LANG[language]   // en | zh-CN
    document.documentElement.dir = 'ltr'
    document.title = DOCUMENT_TITLE[language]             // Devtron / Devtron 控制台
}, [language])
```

`<html lang>` 不是装饰：浏览器翻译提示、屏幕阅读器发音、中文字体回退（避免把中文渲染成日文字形）都依赖它。

## 六、词条规范

### 6.1 key 用语义，不用文案

```ts
// 好
login.submit: 'Login'
// 坏：文案一改 key 就废
'Login': 'Login'
```

### 6.2 结构由英文定义，中文强类型对齐

```ts title="src/i18n/locales/en.ts"
export const en = { /* ... */ }
export type TranslationSchema = typeof en
```

```ts title="src/i18n/locales/zh.ts"
export const zh: TranslationSchema = { /* 少一个 key 就 tsc 报错 */ }
```

这是这套方案里最值钱的一条：**漏翻译会在编译期暴露，而不是等用户切到中文才发现某处是英文**。

### 6.3 插值不要拼接

```ts
// 推荐
t('login.ssoLoginWith', { provider: item.name })   // "Login with {{provider}}" / "使用 {{provider}} 登录"
// 禁止
`Login with ${item.name}`
```

语序在不同语言里会变，拼接等于把语序写死。

### 6.4 术语表（中文）

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

## 七、三类接入点

### 7.1 普通组件

```tsx
const { t } = useI18n()

<Button text={t('login.submit')} />
<span>{t('login.ssoLoginWith', { provider: item.name })}</span>
```

### 7.2 导航树：不改上游常量

`src/components/Navigation/constants.ts` 是上游文件，直接改它会让每次 `merge upstream/develop` 都冲突。做法是**读取时翻译**：

```ts title="src/i18n/navigation.ts"
export const translateNavigationList = (groups, t) =>
    groups.map((group) => ({
        ...group,
        title: t(`nav.group.${group.id}`, { defaultValue: group.title }),
        items: group.items?.map((item) => translateItem(item, t)),
    }))
```

```tsx title="src/components/Navigation/Navigation.tsx"
const NAVIGATION_LIST = useMemo(
    () => translateNavigationList(getNavigationList(serverMode), t),
    [serverMode, t],
)
```

这套写法有三个好处：

1. 上游改标题，缺词条时自动显示英文原文，不会空白；
2. 新增导航项不需要同步改翻译文件才能上线；
3. `git diff upstream/develop -- src/components/Navigation/constants.ts` 永远是空的。

顺带把译名并进 `keywords`，中文搜索"应用组"也能命中。

### 7.3 非 React 代码

```ts
import { i18n } from '@I18n'
i18n.t('login.sessionExpired')
```

只推荐用在 Toast、埋点、请求拦截器这类拿不到 hook 的地方。

## 八、日期、数字与货币

不要在组件里直接 `new Intl.DateTimeFormat()`，否则切了中文日期还是 `Oct 28, 2026`：

```tsx
const { formatDateTime, formatNumber, formatCurrency } = useI18n()

formatDateTime(row.deployedOn)          // 2026年10月28日 14:30 / Oct 28, 2026, 2:30 PM
formatNumber(1234567)                   // 1,234,567
formatCurrency(1234.5, 'CNY')           // ¥1,234.50
```

实现上都包了 `try/catch`，非法日期或未知货币不会把页面打挂，只回落成字符串。

## 九、当前覆盖范围（诚实清单）

已接入：

| 位置 | 覆盖内容 |
| --- | --- |
| 登录页 | 副标题、SSO 按钮、管理员登录、表单标签/占位符/必填提示、帮助链接、会话过期提示 |
| 左侧导航 | 6 个一级分组、31 个导航项与子项、搜索占位、无结果提示、OSS Plus 提示 |
| 全局 | `<html lang>`、`document.title`、语言切换器（登录页 + 导航栏） |

尚未接入（按此顺序推进）：

1. 应用列表 / 应用详情（访问量最高）；
2. 全局配置（表单密集，术语最集中）；
3. 流水线编辑器（文案最多，建议最后做）；
4. `devtron-fe-common-lib` 内部组件文案——它是独立 npm 包，需要单独接入 i18n，或用 `t` 包装后传入 props。

:::tip 找硬编码文案的办法
```bash
# JSX 里的纯英文文本节点
grep -rnE '>[A-Z][a-z]+( [A-Za-z]+)*<' src/Pages | head -40
# 常见的 props 文案
grep -rnE '(label|placeholder|text|title)="[A-Z][a-z]' src/Pages | head -40
```
:::

## 十、与上游共存

这次改造对上游文件的改动控制在 **7 个接入点**，新增代码全部在 `src/i18n/`：

| 文件 | 改动 |
| --- | --- |
| `src/index.tsx` | 引入 `I18nProvider` 包裹根节点 |
| `src/components/login/Login.tsx` | 文案替换 + 挂载切换器 |
| `src/components/login/LoginForm.tsx` | 表单文案替换 |
| `src/components/Navigation/Navigation.tsx` | 导航树翻译 + 语言入口 |
| `vite.config.mts` / `tsconfig.json` | 新增 `@I18n` 别名 |
| `package.json` / `yarn.lock` | 新增 3 个依赖 |

上游同步时的冲突预判：`Navigation.tsx` 和 `Login.tsx` 是上游高频改动文件，冲突时**保留上游结构、把我们的 `t(...)` 重新贴回去**即可；`src/i18n/` 是纯新增，不会冲突。

## 十一、验证清单

```text
[ ] 首次访问（清空 localStorage）→ 按浏览器语言选中/中文
[ ] 登录页右上角切换 → 文案立即变，页面不刷新
[ ] 登录后左导航底部语言入口 → 一级/二级导航全部切换
[ ] 刷新页面 → 语言保持
[ ] 检查 <html lang> → en / zh-CN
[ ] 检查 document.title → Devtron / Devtron 控制台
[ ] 中文下搜索"应用" → 能命中"应用管理"
[ ] 切换语言后当前路由不变、表单已填内容不丢
```

工程侧：

```bash
cd $ROOT/dashboard
npx tsc --noEmit                 # 0 error（词条类型对齐）
npx eslint src/i18n --max-warnings 0
npx vite build                   # 产物里能看到 en/zh 两份资源
```

## 十二、新增一种语言

以日语为例，只需要两步：

```ts
// 1. src/i18n/constants.ts
export const SUPPORTED_LANGUAGES = ['en', 'zh', 'ja'] as const
LANGUAGE_LABELS.ja = '日本語'
HTML_LANG.ja = 'ja'
INTL_LOCALE.ja = 'ja-JP'

// 2. 新建 src/i18n/locales/ja.ts
export const ja: TranslationSchema = { /* 按类型补全 */ }
```

再在 `src/i18n/index.ts` 的 `resources` 里注册。`LanguageSwitcher` 会自动多出一项，不需要改组件。

如果将来要做阿拉伯语等 RTL 语言，把 `I18nProvider` 里的 `dir` 从写死 `'ltr'` 改成按语言查表即可——这是刻意留的扩展点。

## 十三、已知边界

| 边界 | 现状 | 后续方案 |
| --- | --- | --- |
| 后端返回的错误消息 | 仍是英文（`ServerErrors` 的 message 来自 API） | 在 `showError` 层做错误码→文案映射，不改后端 |
| `devtron-fe-common-lib` 组件内文案 | 仍是英文 | 给 common-lib 接入同一套 i18n，或在其上层包一层 |
| 富文本/含链接的句子 | 暂未使用 `<Trans>` | 文案稳定后用 `Trans` 组件 |
| 语言偏好的用户级同步 | 仅浏览器维度 | 接 Rexyn 用户中心后，登录时拉取偏好并写入 localStorage |
