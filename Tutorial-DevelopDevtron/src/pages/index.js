import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const features = [
  {
    title: '一个仓库一章',
    body: '8 个仓库逐章拆解：它是什么、代码长什么样、怎么跟别人协作、要改它从哪下手。',
  },
  {
    title: '四段式结构',
    body: '每章固定四段：定位 / 目录与关键包 / 与其他组件的边界 / 二次开发入口，方便横向对比。',
  },
  {
    title: '配方式实战',
    body: '加 API、加页面、改 CI、加通知渠道、加表……七个端到端配方，照着做就能落地。',
  },
];

export default function Home() {
  return (
    <Layout title="Devtron 源码剖析与二次开发" description="按仓库拆解 Devtron 生态，找到每一个可扩展点">
      <header className={styles.hero}>
        <div className="container">
          <h1 className={styles.title}>Devtron 源码剖析与二次开发</h1>
          <p className={styles.subtitle}>
            8 个仓库的地图、调用链、扩展点，以及七个可以直接照做的二次开发配方。
          </p>
          <div className={styles.actions}>
            <Link className="button button--primary button--lg" to="/docs/intro">
              开始阅读
            </Link>
            <Link className="button button--secondary button--lg" to="/docs/recipes">
              直接看配方
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
