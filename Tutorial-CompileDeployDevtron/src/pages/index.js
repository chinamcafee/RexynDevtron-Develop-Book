import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const features = [
  {
    title: '8 个仓库，不多不少',
    body: '从 devtron-labs 的 60+ 仓库里筛出真正参与编译的 8 个，并说明每一个为什么在清单里（或不在）。',
  },
  {
    title: '13 个镜像，逐个编译',
    body: '每一条 docker build 都给出完整上下文、耗时预期、失败症状与替代方案，包括两个必须改造的 Dockerfile。',
  },
  {
    title: '一套能跑的环境',
    body: '三节点 k3s + NodePort 30080 + Helm values 覆盖，最终得到一个完全由你源码编译的 Devtron。',
  },
];

export default function Home() {
  return (
    <Layout title="Devtron 编译与本地部署" description="从 8 个 fork 仓库到 OrbStack 上可运行的 Devtron">
      <header className={styles.hero}>
        <div className="container">
          <h1 className={styles.title}>Devtron 编译 + 本地部署</h1>
          <p className={styles.subtitle}>
            从 8 个 fork 仓库出发，编译全部组件，在本机 OrbStack 上跑出一个功能完整的 Devtron OSS。
          </p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/docs/intro">
              开始阅读
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/appendix">
              直接抄命令
            </Link>
          </div>
        </div>
      </header>
      <main className="container margin-vert--lg">
        <div className="row">
          {features.map((f) => (
            <div className="col col--4" key={f.title}>
              <div className="padding--md">
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            </div>
          ))}
        </div>
      </main>
    </Layout>
  );
}
