# Redis (Valkey) vs MySQL ランキング性能比較デモ

ゲームのランキングボードを想定し、同じデータを Redis 互換の Valkey (sorted set) と MySQL (テーブル) に入れて、
書き込み・Top-N 取得・特定ユーザーの順位検索・ページングの速度を比較します。

- ローカル: `docker compose` の Valkey 8 + MySQL 8.4 に対して計測
- AWS: CDK で EC2 (計測ホスト) + ElastiCache Valkey + RDS MySQL を **使い捨て** で展開し、SSM 経由で同じ計測を実行

2022 年版 (Node 14 / redis 6 / mysql 5.7 / `time` コマンド計測) からの変更点は [docs/MIGRATION.md](docs/MIGRATION.md)、
料金やバージョンなど外部事実の出典は [docs/SOURCES.md](docs/SOURCES.md) にまとめています。

## 必要なもの

- Node.js 22 以上 (`.nvmrc` = 22。`engines.node >= 22`)
- Docker (compose v2。`docker compose` サブコマンド)
- AWS 版のみ: AWS CLI v2、`demo01` プロファイル (SSO)、`jq`

## ローカルで計測する (3 コマンド)

```bash
npm ci
docker compose up -d
npm run seed -- --users 100000   # 両方に同じ 10 万件を投入 (既存データは作り直し)
npm run bench                    # 計測して Markdown 表を stdout に出力
```

- 接続先は環境変数で指定します (`.env.example` を `.env` にコピーすると読み込まれます)。未設定なら `127.0.0.1` の compose 環境に繋ぎます
- 終了: `docker compose down -v` (データも削除)

### 比較条件

- CPU / メモリ制限はかけません (旧版の `cpus: 0.1` の手動付け外しは廃止)。ローカルでは両コンテナが同じホストの資源を共有し、
  AWS では `cache.t4g.micro` と `db.t4g.micro` (どちらも 2 vCPU バースト型) を単一ノードで使います
- クライアント (Node) は 1 接続。計測は `performance.now()` による内部計測で、各項目 5 回実行の中央値と p95 (nearest-rank 法。5 回なら最大値) を出します
- MySQL の `ranking` テーブルには `(score, user)` の複合インデックスと `user` の一意インデックスを張っています (旧版はインデックスなし)。
  `ORDER BY score DESC, user DESC` は sorted set の同点時の並び (メンバーの逆辞書順) に合わせています
- 結果の整合性 (Top-1 と固定ユーザー `mamezou` の順位・スコア) を両ストアで突き合わせ、表の上に表示します

### 計測項目

| # | 項目 | Redis 側 | MySQL 側 |
|---|---|---|---|
| 1a | 単純 write N 件 (既定 10,000)。1 件ずつ `await`、パイプライン/バッチなし | `SET key-i i` ×N | `INSERT INTO demo (name, value) VALUES (?, ?)` ×N |
| 1b | 同上。Redis は 1 パイプライン、MySQL は 1,000 行/文の複数行 INSERT | `pipeline(SET ×N)` | `INSERT ... VALUES (...),(...)` ×(N/1000) |
| 2 | Top-N 取得 (既定 100) | `ZREVRANGE ranking 0 N-1 WITHSCORES` | `SELECT user, score FROM ranking ORDER BY score DESC, user DESC LIMIT N` |
| 3 | 特定ユーザー (`mamezou`) のスコアと順位 | `ZSCORE` + `ZREVRANK` (1 パイプライン) | `SELECT score ... WHERE user = ?` + `SELECT COUNT(*) + 1 ... WHERE score > ?` |
| 4 | ページング (既定 offset 10,000 から 500 件) | `ZREVRANGE ranking 10000 10499 WITHSCORES` | `... ORDER BY score DESC, user DESC LIMIT 10000, 500` |

オプション: `npm run bench -- --runs 5 --writes 10000 --top 100 --page-offset 10000 --page-size 500 --user mamezou`

### 実行例 (この dev VM でのローカル計測。`--users 20000`)

環境: Linux x86_64 (3 vCPU)、Docker 24.0.2 / Compose v2.18.1、Node v24.13.1、valkey/valkey:8 (8.1.10)、mysql:8.4 (8.4.11)。
2026-09-11 に `docker compose up -d` → `npm run seed -- --users 20000` → `npm run bench` を実行した出力そのままです。

```
[seed] ランキングデータ 20,000 件を生成 (seed=42)
[seed] 生成完了 99.7 ms
[seed] 接続: redis://127.0.0.1:6379 / mysql://127.0.0.1:3306/demo
[seed] Redis: ZADD 20,000 件 (1000 件/コマンド) 40.1 ms
[seed] MySQL: INSERT 20,000 件 (1000 行/文) 388 ms
[seed] 完了: Redis ZCARD=20,000, MySQL COUNT(*)=20,000
```

## 計測結果

- 計測日時: 2026-09-11T14:42:48.747Z
- クライアント: Node v24.13.1 (linux/x64)
- Redis 互換: Valkey 8.1.10 @ redis://127.0.0.1:6379
- MySQL: 8.4.11 @ mysql://127.0.0.1:3306/demo
- ランキング件数: 20,000 (Redis sorted set `ranking` / MySQL テーブル `ranking`)
- 各項目 5 回実行。単位 ms。p95 は nearest-rank 法 (5 回なら最大値)
- 整合性: Top-1 一致 (Melissa Blanda 6647 / Melissa Blanda 6647), mamezou の順位・スコア 一致 (Redis 20000 位 500 / MySQL 20000 位 500)

| # | 項目 | Redis 側の操作 | MySQL 側の操作 | Redis 中央値 | Redis p95 | MySQL 中央値 | MySQL p95 | MySQL/Redis |
|---|---|---|---|---:|---:|---:|---:|---:|
| 1a | 単純 write 10,000 件 (1 件ずつ await、パイプライン/バッチなし) | `SET ×10,000` | `INSERT ×10,000` | 1376 | 1429 | 6263 | 6480 | 4.6x |
| 1b | 単純 write 10,000 件 (Redis: 1 パイプライン、MySQL: 1,000 行/文の複数行 INSERT) | `pipeline(SET ×10,000)` | `INSERT ... VALUES (...),(...) ×10` | 48.4 | 66.5 | 71.0 | 81.7 | 1.5x |
| 2 | Top-100 取得 | `ZREVRANGE 0 99 WITHSCORES` | `ORDER BY score DESC LIMIT 100` | 0.53 | 0.73 | 0.41 | 1.37 | 0.8x |
| 3 | 特定ユーザー (mamezou) のスコアと順位 | `ZSCORE + ZREVRANK (1 パイプライン)` | `SELECT score WHERE user=? + SELECT COUNT(*) WHERE score>?` | 0.18 | 0.40 | 3.54 | 9.40 | 19.2x |
| 4 | ページング (offset 10,000 から 500 件) | `ZREVRANGE 10000 10499 WITHSCORES` | `ORDER BY score DESC LIMIT 10000, 500` | 0.68 | 1.26 | 3.15 | 4.08 | 4.6x |

読み方: ローカルは同一ホスト内の loopback 通信なので、Top-100 のようにサーバ側処理が軽い項目は差が出ません
(インデックスがあれば MySQL も速い)。差が出るのは往復回数が多い 1a と、MySQL 側が `COUNT(*)` で範囲走査になる 3・4 です。
AWS では EC2 ↔ ElastiCache / RDS のネットワーク往復が加わるため、1a の絶対値はローカルより大きくなります。

## AWS で計測する (3 コマンド)

```
VPC 10.42.0.0/16 (2 AZ, NAT なし)
├─ public subnet   : EC2 t4g.small (Amazon Linux 2023 ARM, SSM 管理, インバウンド 0, パブリック IP あり)
└─ isolated subnet : ElastiCache Valkey 8.1 cache.t4g.micro ×1 (6379 は EC2 の SG からのみ)
                     RDS MySQL 8.4 db.t4g.micro 単一 AZ (3306 は EC2 の SG からのみ, パスワードは Secrets Manager 自動生成)
```

前提:

- `aws sso login --profile demo01` 済み (アカウント 393531704437 / ap-northeast-1)。スタックの account は固定せず、`--profile` の資格情報で決まります (region は `ap-northeast-1` 固定)
- CDK bootstrap 済み (`aws cloudformation describe-stacks --stack-name CDKToolkit --profile demo01` で確認。未なら `cd infra && npx cdk bootstrap --profile demo01`)
- EC2 は起動時に GitHub からこのリポジトリを `git clone` するので、計測したいブランチが push 済みであること。
  `main` 以外を使うときは `-c repoBranch=<branch>` を付けます

```bash
npm run aws:deploy                                  # infra の npm ci → cdk deploy --profile demo01 (10〜15 分)
# npm run aws:deploy -- -c repoBranch=feat/aws-cdk  # main にマージ前はブランチを指定
npm run aws:bench                                   # SSM Run Command で EC2 上の seed (10 万件) + bench を実行し、結果を表示
npm run aws:destroy                                 # 計測が終わったら必ず削除
```

- `USERS=20000 npm run aws:bench` で件数変更、`BENCH_ARGS="--runs 3" npm run aws:bench` で bench の引数を渡せます
- 仕組み: `scripts/aws-bench.sh` (ローカル) がスタックの Outputs (`InstanceId` / `RedisEndpoint` / `MysqlEndpoint` / `SecretArn`) を読み、
  `aws ssm send-command` (AWS-RunShellScript) で EC2 上のスクリプトを実行します。EC2 側は `scripts/aws-env.sh` が
  Outputs と Secrets Manager から `REDIS_HOST` / `MYSQL_*` を組み立てます。SSH は使いません (インバウンドは 0)
- 手元で確認したいときは `aws ssm start-session --target <InstanceId> --profile demo01`
- `cdk synth` だけなら `npm run aws:synth`。CDK のビルド (tsc) は `npm run build`

### AWS 実行例 (2026-09-12、`feat/aws-cdk`、`npm run aws:bench` の既定 10 万件)

- deploy 552 秒 → bench (seed 10 万件 + 5 回計測) 約 4 分 → destroy 約 8 分。スタック削除後に RDS スナップショット / ElastiCache / Secrets の残骸なし
- EC2 t4g.small (Node v22.23.2, arm64) → Valkey 8.1.0 (cache.t4g.micro) / MySQL 8.4.9 (db.t4g.micro)。同一 VPC 内の別ホストなのでローカル (loopback) より往復が乗る
- seed: Redis ZADD 100,000 件 363 ms、MySQL INSERT 100,000 件 2,814 ms。整合性 (Top-1、mamezou の順位・スコア) 両ストア一致

| # | 項目 | Redis 中央値 | Redis p95 | MySQL 中央値 | MySQL p95 | MySQL/Redis |
|---|---|---:|---:|---:|---:|---:|
| 1a | 単純 write 10,000 件 (1 件ずつ await) | 2070 | 2598 | 32661 | 33387 | 15.8x |
| 1b | 単純 write 10,000 件 (パイプライン / 1,000 行 INSERT) | 107 | 162 | 205 | 224 | 1.9x |
| 2 | Top-100 取得 | 0.72 | 1.50 | 2.98 | 6.20 | 4.2x |
| 3 | 特定ユーザーのスコアと順位 | 0.41 | 0.88 | 29.5 | 34.6 | 72.5x |
| 4 | ページング (offset 10,000 から 500 件) | 3.60 | 4.76 | 7.19 | 8.59 | 2.0x |

ローカル計測との違い: ネットワーク往復が加わるため、1 件ずつ await する 1a は往復回数がそのまま差になり (MySQL 15.8x)、Top-100 もローカルでは MySQL が僅差で速かったのが AWS では Redis が 4.2x 速い。順位取得 (3) は 10 万件で COUNT(*) の走査が効いて 72.5x。

### 概算コスト (東京リージョン、オンデマンド、1 時間動かした場合)

単価は AWS Price List Bulk API (公式の料金 JSON/CSV、2026-09-11 取得) の値です。出典と取得方法は [docs/SOURCES.md](docs/SOURCES.md)。

| 項目 | 単価 | 1 時間あたり |
|---|---|---:|
| EC2 t4g.small (Linux) | $0.0216 / 時 | $0.0216 |
| EBS gp3 16 GB (EC2 ルート) | $0.096 / GB-月 | $0.0021 (730 時間/月で按分) |
| パブリック IPv4 アドレス (使用中) | $0.005 / 時 | $0.005 |
| ElastiCache cache.t4g.micro (Valkey) | $0.020 / 時 | $0.020 |
| RDS db.t4g.micro (MySQL, 単一 AZ) | $0.025 / 時 | $0.025 |
| RDS gp3 20 GB | $0.138 / GB-月 | $0.0038 (730 時間/月で按分) |
| Secrets Manager 1 シークレット | $0.40 / シークレット-月 | $0.0006 (時間按分) + API $0.05 / 1 万回 |
| **合計** | | **約 $0.078 / 時 (≒ $0.08)** |

- 未確認: 上記以外の従量分 (AZ 間データ転送、CloudWatch、削除待ちシークレットの課金)。計測データは数 MB 程度なので影響は小さい見込みですが、金額は確認していません
- **常時展開しません。** 計測が終わったら `npm run aws:destroy` で削除してください。1 日放置すると約 $1.9、1 か月で約 $57 かかります
- 削除後の確認: `aws cloudformation describe-stacks --stack-name RedisDemoStack --profile demo01` がエラー (does not exist) になること

## 環境変数

| 変数 | 既定 | 用途 |
|---|---|---|
| `REDIS_HOST` / `REDIS_PORT` | `127.0.0.1` / `6379` | Valkey / Redis の接続先 |
| `REDIS_TLS` | `0` | `1` で TLS 接続 (CDK の ElastiCache は転送中暗号化なしで作るので `0`) |
| `MYSQL_HOST` / `MYSQL_PORT` | `127.0.0.1` / `3306` | MySQL の接続先 |
| `MYSQL_USER` / `MYSQL_PASSWORD` / `MYSQL_DATABASE` | `demo` / `demo` / `demo` | 認証情報 (AWS では `aws-env.sh` がシークレットから設定) |
| `MYSQL_SSL` | 空 | `rds`: mysql2 内蔵の "Amazon RDS" CA、`insecure`: 検証なし TLS、それ以外の値: OS の CA で検証 |

## ファイル構成

```
src/            アプリ本体 (ESM)。config.js (環境変数) / clients.js (接続) / data.js (データ生成) / stats.js (統計) / seed.js / bench.js
scripts/        aws-bench.sh (ローカルから SSM 経由で実行) / aws-env.sh (EC2 側で環境変数を組み立て)
infra/          CDK v2 (TypeScript)。bin/redis-demo.ts / lib/redis-demo-stack.ts
docker-compose.yml  ローカル用 Valkey 8 + MySQL 8.4
docs/           MIGRATION.md (旧版との対応表) / SOURCES.md (外部事実の出典)
```
