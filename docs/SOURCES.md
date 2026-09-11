# 外部事実の出典 (2026-09-11 確認)

推測で書かないため、README / CDK で使った外部事実は以下の公式ソースで確認した。確認できなかったものは「未確認」と明記する。

## 料金 (東京 ap-northeast-1、オンデマンド、USD)

aws.amazon.com の料金ページは表が JavaScript で動的に描画され、取得したテキストに数値が含まれなかった。
代わりに AWS 公式の **Price List Bulk API** (料金ページと同じデータの JSON/CSV) を使った。取得方法:

```bash
BASE=https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws
curl -s $BASE/AmazonElastiCache/current/ap-northeast-1/index.csv | grep '"cache.t4g.micro"' | grep OnDemand
curl -s $BASE/AmazonRDS/current/ap-northeast-1/index.csv | grep '"db.t4g.micro"' | grep MySQL | grep Single-AZ | grep OnDemand
curl -s $BASE/AmazonEC2/current/ap-northeast-1/index.csv | grep '"t4g.small"' | grep '"OnDemand"' | grep '"Linux"' | grep '"Shared"'
curl -s $BASE/AmazonVPC/current/ap-northeast-1/index.csv | grep PublicIPv4 | grep OnDemand
curl -s $BASE/AWSSecretsManager/current/ap-northeast-1/index.csv | grep OnDemand
```

| 項目 | 値 | 出典 (PriceDescription の原文) |
|---|---|---|
| ElastiCache cache.t4g.micro (Valkey) | $0.020 / 時 | AmazonElastiCache ap-northeast-1 (Version 20260911124427): "$0.02 per T4G Micro Cache node-hour (or partial hour) running Valkey" (Redis OSS は $0.025) |
| RDS db.t4g.micro MySQL 単一 AZ | $0.025 / 時 | AmazonRDS ap-northeast-1 (Version 20260911124502): "$ 0.025 per RDS db.t4g.micro Single-AZ instance hour (or partial hour) running MySQL" |
| RDS gp3 ストレージ (MySQL 単一 AZ) | $0.138 / GB-月 | 同上: "$0.138 per GB-month of provisioned GP3 storage running MySQL" |
| EC2 t4g.small Linux 共有テナンシー | $0.0216 / 時 | AmazonEC2 ap-northeast-1 (Version 20260910195514): "$0.0216 per On Demand Linux t4g.small Instance Hour" |
| EBS gp3 | $0.096 / GB-月 | 同上: "$0.096 per GB-month of General Purpose (gp3) provisioned storage - Asia Pacific (Tokyo)" |
| パブリック IPv4 (使用中) | $0.005 / 時 | AmazonVPC ap-northeast-1: "$0.005 per In-use public IPv4 address per hour" |
| Secrets Manager | $0.40 / シークレット-月、$0.05 / 1 万 API | AWSSecretsManager ap-northeast-1: "$0.40 per Secret", "$0.05 per 10000 API Requests" |

- ElastiCache 料金ページ (https://aws.amazon.com/elasticache/pricing/) の本文には「Valkey はノードベースで他エンジンより 20% 安い」との記載があり、上の $0.020 vs $0.025 と整合する
- 未確認: AZ 間データ転送、CloudWatch、削除待ち (scheduled deletion) 中のシークレットの課金有無

## イメージタグ / エンジンバージョン

| 事実 | 出典 |
|---|---|
| Docker Hub `valkey/valkey` に `8`, `8.1`, `8.1.10`, `8.0`, `8.0.11` (および `-alpine` / `-trixie`) がある。`8` = 8.1.10 | https://hub.docker.com/r/valkey/valkey/tags (WebFetch)。ローカルで `docker run --rm valkey/valkey:8 valkey-server --version` → `v=8.1.10` |
| Docker Hub 公式 `mysql` に `8.4.11`, `8.4`, `8` (`-oraclelinux9`, `-oracle` 変種あり) がある。`8.4` = 8.4.11 | https://hub.docker.com/_/mysql (WebFetch)。ローカルで `docker run --rm mysql:8.4 mysqld --version` → `8.4.11` |
| ElastiCache for Valkey の対応バージョン: 7.2, 8.0, 8.1, 8.2, 9.0, 9.1 (8.2 は 8.1 互換 + ベクトル検索) | https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/engine-versions.html |
| RDS for MySQL 8.4 の対応マイナー: 8.4.4〜8.4.11 (8.4.3 は一覧にない)。「major のみ指定した場合、RDS はその major の最近のリリースを既定にする」 | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/MySQL.Concepts.VersionMgmt.html ("If a major version is specified but a minor version is not, Amazon RDS defaults to a recent release of the major version you have specified.") |
| MySQL 5.7 / 8.0 は RDS では Extended Support のみ (8.0 の標準サポート終了 2026-07-31) | 同上 |

CDK では `MysqlEngineVersion.of('8.4', '8.4')` (major のみ) を既定にし、`-c mysqlVersion=8.4.11` で固定できるようにした。
`aws-cdk-lib 2.179.0` の定数は `VER_8_4_3` までで、8.4.3 は RDS の対応一覧から外れているため使わない。

## ElastiCache のノードタイプと CloudFormation

| 事実 | 出典 |
|---|---|
| `cache.t4g.micro` は Valkey の現行世代ノード (最小 Valkey 7.2、2 vCPU、0.5 GiB、ベースライン 10%/vCPU)。T2 は新規作成不可 | https://docs.aws.amazon.com/AmazonElastiCache/latest/dg/CacheNodes.SupportedTypes.html |
| リージョン別の対応可否は料金ページ参照 (東京での `cache.t4g.micro` Valkey は上の料金表に行があることで確認) | 同上 + Price List API |
| `AWS::ElastiCache::CacheCluster` の `Engine` は `memcached | redis` のみ。「Valkey クラスターを作るには `AWS::ElastiCache::ReplicationGroup` を使う」 | https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticache-cachecluster.html |

このため CDK では `CfnReplicationGroup` を `engine: 'valkey'`, `numCacheClusters: 1`, `automaticFailoverEnabled: false`, `multiAzEnabled: false` で使い、
単一ノード (レプリカなし) にしている。エンドポイントは `PrimaryEndPoint.Address`。

- 未確認: `ReplicationGroup` を `NumCacheClusters: 1` で作成したときの実際の起動時間と、`cdk destroy` 完了までの所要時間 (deploy は本作業では実行していない)

## Amazon Linux 2023 (EC2 計測ホスト)

| 事実 | 出典 |
|---|---|
| 最新 AL2023 AMI は SSM パラメータ `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64` (arm64) で取得できる。カーネル固定版 `al2023-ami-kernel-6.1-arm64` / `6.12` / `6.18` もある。2026-08-17 以降 `kernel-default` は 6.18 を指す | https://docs.aws.amazon.com/linux/al2023/ug/ec2.html |
| CloudFormation では `AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>` 型のパラメータで参照する | 同上 |
| AL2023 の Node.js は `nodejs20` / `nodejs22` / `nodejs24` パッケージ。`nodejs22` + `nodejs22-npm` で `node` と `npm` が入る。複数版は `alternatives` で切替 | https://docs.aws.amazon.com/linux/al2023/ug/nodejs.html |

CDK の `MachineImage.latestAmazonLinux2023({ cpuType: ARM_64 })` (aws-cdk-lib 2.179.0) は synth 結果で
`/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-6.1-arm64` を参照していた (CDK 既定がカーネル 6.1 固定版)。

- 未確認: AL2023 の `nodejs22` パッケージの具体的な Node バージョン (22.x のどれか)。`@faker-js/faker 10` は `^22.13.0` を要求するため、
  古い 22.x だと `npm ci` が警告/失敗する可能性がある。user-data は `node --version` を出力するので、失敗時は SSM のログで確認する

## mysql2 の TLS (`MYSQL_SSL=rds`)

`mysql2 3.24.4` の `ssl: 'Amazon RDS'` プロファイルは `aws-ssl-profiles 1.1.2` (120 証明書) を読み込む (`node_modules/mysql2/lib/constants/ssl_profiles.js`)。
東京リージョンの `rds-ca-rsa2048-g1` が含まれるかは PEM の中身までは確認していない (未確認)。CDK の既定は RDS への TLS なし
(隔離サブネット内の平文接続) で、`MYSQL_SSL` は任意項目。

## CDK / ツールのバージョン

| 事実 | 出典 |
|---|---|
| `aws-cdk-lib 2.179.0`, `aws-cdk 2.1021.0`, `typescript ~5.7.2`, `@types/node 22.10.2`, `ts-node ^10.9.2` | `/home/yuki/job/instructor/aws-demo/package.json` と同じ版 |
| `ioredis 5.11.1`, `mysql2 3.24.4`, `@faker-js/faker 10.6.0` | `npm view` (2026-09-11)。`ioredis` は 6.0.0 も出ているが指定どおり v5 系にした |
