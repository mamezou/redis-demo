# AWS で計測する手順(deploy → bench → destroy)

> 対象: `demo01`(393531704437, ap-northeast-1)。**常時展開しない**。計測後は必ず destroy。概算 $0.08/時(docs/SOURCES.md)。

## 前提
- `aws sso login --profile demo01`(`aws sts get-caller-identity --profile demo01` で 393531704437)
- CDK bootstrap 済み(`CDKToolkit` スタックが存在)
- 計測対象ブランチが GitHub に push 済み(EC2 の user-data が clone する)

## 手順
```bash
npm run aws:deploy -- -c repoBranch=feat/aws-cdk --require-approval never   # 10〜15 分
npm run aws:bench                                                           # SSM Run Command で seed + bench、結果を表示
npm run aws:destroy -- --force                                              # 必ず実行
aws cloudformation describe-stacks --profile demo01 --stack-name RedisDemoStack   # "does not exist" で完了
```

## 期待結果 / NG 判定
- deploy: Outputs に InstanceId / RedisEndpoint / MysqlEndpoint / SecretArn。NG: ROLLBACK → `cdk destroy` で片付けて原因確認
- bench: Markdown 表(4 項目 × 中央値 / p95)。NG: EC2 が SSM Online にならない(user-data の `npm ci` 失敗など)→ `aws ssm get-command-invocation` と EC2 のシステムログを確認
- destroy: スタック消滅。RDS スナップショット・ElastiCache・Secrets の残骸が無いこと
