#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { RedisDemoStack } from '../lib/redis-demo-stack';

const app = new cdk.App();
const ctx = (key: string, fallback: string): string => {
  const v = app.node.tryGetContext(key);
  return v === undefined ? fallback : String(v);
};

new RedisDemoStack(app, 'RedisDemoStack', {
  // account は固定しない (--profile の資格情報で決まる)。region は東京固定
  env: { region: 'ap-northeast-1' },
  description: 'redis-demo: Valkey vs MySQL ranking benchmark (disposable, destroy after measuring)',
  // 計測ホストが clone するリポジトリ。ブランチは `-c repoBranch=feat/aws-cdk` のように上書きできる
  repoUrl: ctx('repoUrl', 'https://github.com/mamezou/redis-demo.git'),
  repoBranch: ctx('repoBranch', 'main'),
  // RDS は major のみ指定 (RDS がその major の最近のマイナーを選ぶ)。`-c mysqlVersion=8.4.11` で固定可
  mysqlVersion: ctx('mysqlVersion', '8.4'),
  // ElastiCache Valkey。ローカルの valkey/valkey:8 (8.1.x) と揃える
  valkeyVersion: ctx('valkeyVersion', '8.1'),
});

cdk.Tags.of(app).add('Project', 'redis-demo');
