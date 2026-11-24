/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
  tutorial: [
    'intro',
    {
      type: 'category',
      label: '第一部分 · 认识 Devtron 的仓库版图',
      collapsed: false,
      items: ['repos', 'architecture'],
    },
    {
      type: 'category',
      label: '第二部分 · 准备环境',
      collapsed: false,
      items: ['prereq', 'clone', 'branch-strategy'],
    },
    {
      type: 'category',
      label: '第三部分 · 编译全部组件',
      collapsed: false,
      items: ['build-overview', 'build-services', 'build-devtron', 'build-dashboard', 'build-misc'],
    },
    {
      type: 'category',
      label: '第四部分 · 搭集群并部署',
      collapsed: false,
      items: ['cluster', 'import-images', 'deploy', 'verify'],
    },
    {
      type: 'category',
      label: '第五部分 · 运维与二次迭代',
      collapsed: false,
      items: ['troubleshooting', 'workflow', 'appendix'],
    },
    {
      type: 'category',
      label: '第六部分 · 兼容性扩展',
      collapsed: false,
      items: ['compat-matrix'],
    },
  ],
};

module.exports = sidebars;
