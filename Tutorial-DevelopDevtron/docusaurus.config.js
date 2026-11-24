// @ts-check
const { themes } = require('prism-react-renderer');

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'Devtron 源码剖析与二次开发',
  tagline: '按仓库拆解 Devtron 生态，找到每一个可扩展点',
  favicon: 'img/favicon.svg',

  url: 'https://devtron-source.example.com',
  baseUrl: '/',

  organizationName: 'chinamcafee',
  projectName: 'Tutorial-DevelopDevtron',

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
        title: 'Devtron 源码剖析',
        logo: { alt: 'Devtron', src: 'img/logo.svg' },
        items: [
          { type: 'docSidebar', sidebarId: 'develop', position: 'left', label: '电子书' },
          { href: 'https://github.com/chinamcafee', label: 'GitHub', position: 'right' },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: '文档',
            items: [
              { label: '全景导读', to: '/docs/overview' },
              { label: 'devtron 核心仓库', to: '/docs/repo-devtron' },
              { label: '二次开发实战', to: '/docs/recipes' },
            ],
          },
          {
            title: '相关',
            items: [
              { label: 'Devtron 官方文档', href: 'https://docs.devtron.ai' },
              { label: '配套电子书：编译与部署', to: '/docs/intro' },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} chinamcafee. Built with Docusaurus 3.10.`,
      },
      prism: {
        theme: themes.github,
        darkTheme: themes.dracula,
        additionalLanguages: ['bash', 'yaml', 'docker', 'go', 'json', 'tsx', 'typescript'],
      },
      colorMode: {
        defaultMode: 'light',
        respectPrefersColorScheme: true,
      },
    }),
};

module.exports = config;
