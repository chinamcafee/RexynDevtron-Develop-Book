/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  develop: [
    'intro',
    {
      type: 'category',
      label: '第一部分 · 全景',
      collapsed: false,
      items: ['overview', 'runtime-callchain'],
    },
    {
      type: 'category',
      label: '第二部分 · devtron（核心）',
      collapsed: false,
      items: [
        'repo-devtron',
        'devtron-api',
        'devtron-domain',
        'devtron-wire',
        'devtron-inner-charts',
      ],
    },
    {
      type: 'category',
      label: '第三部分 · devtron-services（微服务）',
      collapsed: false,
      items: [
        'repo-services',
        'svc-git-sensor',
        'svc-kubelink',
        'svc-kubewatch-lens',
        'svc-chart-sync',
        'svc-ci-runner',
        'svc-image-scanner',
        'svc-authenticator-commonlib',
      ],
    },
    {
      type: 'category',
      label: '第四部分 · 前端',
      collapsed: false,
      items: ['repo-dashboard', 'repo-fe-common-lib', 'dashboard-i18n'],
    },
    {
      type: 'category',
      label: '第五部分 · 周边仓库',
      collapsed: false,
      items: [
        'repo-inception',
        'repo-migrator',
        'repo-notifier',
        'repo-charts',
        'repo-kubectl',
        'repo-dex',
        'repo-chart-versions-fix',
      ],
    },
    {
      type: 'category',
      label: '第六部分 · 二次开发',
      collapsed: false,
      items: ['recipes', 'dev-workflow', 'reading-guide'],
    },
    {
      type: 'category',
      label: '第七部分 · RexynOps 定制',
      collapsed: false,
      items: ['rexyn-positioning', 'rexyn-branch-strategy'],
    },
  ],
};

module.exports = sidebars;
