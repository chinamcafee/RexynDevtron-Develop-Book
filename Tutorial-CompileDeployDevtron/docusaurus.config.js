// @ts-check
const { themes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Devtron 编译与本地部署',
  tagline: '从 8 个 fork 仓库到 OrbStack 上的可运行 Devtron',
  favicon: 'img/favicon.svg',

  url: 'https://devtron-local.example.com',
  baseUrl: '/',

  organizationName: 'chinamcafee',
  projectName: 'Tutorial-CompileDeployDevtron',

  onBrokenLinks: 'warn',
  onBrokenAnchors: 'warn',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          routeBasePath: 'docs',
          editUrl: undefined,
        },
        blog: false,
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/social-card.svg',
      navbar: {
        title: 'Devtron 编译与本地部署',
        logo: { alt: 'Devtron', src: 'img/logo.svg' },
        items: [
          { type: 'docSidebar', sidebarId: 'tutorial', position: 'left', label: '电子书' },
          { href: 'https://github.com/chinamcafee', label: 'GitHub', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: '文档',
            items: [
              { label: '开始之前', to: '/docs/intro' },
              { label: '编译全部组件', to: '/docs/build-services' },
              { label: '部署到集群', to: '/docs/deploy' },
            ],
          },
          {
            title: '相关',
            items: [
              { label: 'Devtron 官方文档', href: 'https://docs.devtron.ai' },
              { label: 'devtron-labs', href: 'https://github.com/devtron-labs' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} chinamcafee. Built with Docusaurus 3.10.`,
      },
      prism: {
        theme: themes.github,
        darkTheme: themes.dracula,
        additionalLanguages: ['bash', 'yaml', 'docker', 'go', 'json', 'diff'],
      },
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
    }),
};

module.exports = config;
