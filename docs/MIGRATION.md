# 2022 年版からの移行対応表

対象: `mamezou/redis-demo` の `main` (最終コミット `4cca4be edit: readme`) を読み、旧実装の挙動を洗い出した上で、
新実装で **維持 / 変更 / 削除** したものを一覧にした。

## ファイル

| 旧 | 新 | 区分 |
|---|---|---|
| `write_to_redis.js` (`SET key-n n` を 9,999 回、`console.log(n)` 付き、await なし) | `src/bench.js` 項目 1a / 1b | 変更 |
| `write_to_mysql.js` (`demo` テーブルを作り直し `INSERT SET ?` を 9,999 回) | `src/bench.js` 項目 1a / 1b | 変更 |
| `store_ranking_data.js` (100 万件生成 → `ZADD` と `INSERT` を投げっぱなし) | `src/seed.js` | 変更 |
| `get_redis_ranking.js` (`ZREVRANGE 0 5` + 各 `ZSCORE`) | `src/bench.js` 項目 2 | 変更 |
| `get_mysql_ranking.js` (`ORDER BY score DESC LIMIT 5`) | `src/bench.js` 項目 2 | 変更 |
| README の手動確認コマンド (`zscore ranking mamezou` / `where user='mamezou'` / `zrevrange 10000 10500` / `limit 10000,500`) | `src/bench.js` 項目 3 / 4 として自動計測 | 変更 |
| `package.json` (`faker ^5`, `ioredis ^4`, `mysql ^2`、scripts なし) | `package.json` (`@faker-js/faker ^10`, `ioredis ^5`, `mysql2 ^3`、`seed` / `bench` / `aws:*`) | 変更 |
| `docker-compose.yml` (`version: '2.2'`) | compose v2 形式 (`version` キーなし) | 変更 |
| (なし) | `src/config.js` `src/clients.js` `src/data.js` `src/stats.js` `.env.example` `.nvmrc` `scripts/` `infra/` `docs/` | 追加 |

## 挙動

| 旧実装の挙動 | 新実装 | 区分 | 理由 |
|---|---|---|---|
| 単純 write の件数: `while (n < 10000)` で **9,999 件** | 既定 **10,000 件** (`--writes`) | 変更 | off-by-one を解消し、README の「10000 データ」に合わせた |
| Redis の write は await なし (投げっぱなし)、MySQL は 1 接続にキュー | 1a: 1 件ずつ await (往復回数が支配的な条件)、1b: Redis パイプライン / MySQL 複数行 INSERT | 変更 | 「何を測っているか」を明示。旧版は実質パイプライン相当だった |
| write 先: Redis キー `key-{n}`、MySQL テーブル `demo (id, name VARCHAR(50), value INT)` | 同じ名前・同じ列 | 維持 | |
| write テストのデータは残る | 計測後に `UNLINK` / `DROP TABLE demo` で削除 | 変更 | 冪等にするため。ランキングデータは残す |
| ランキング件数 100 万 (`store_ranking_data.js` 固定) | 既定 10 万 (`npm run seed -- --users N` で変更可。100 万は `--users 1000000`) | 変更 | `cache.t4g.micro` (0.5 GiB) と `db.t4g.micro` で確実に収まる既定にした。件数は引数で戻せる |
| ユーザー名: `faker.name.findName() + i`、スコア: `Math.random() * 1e9`、先頭に固定ユーザー `mamezou` (score 500) | `firstName lastName i`、`faker.number.int(0..999,999,999)`、先頭に `mamezou` (500)、**seed 固定** (`--seed 42`) | 変更 | 再現性 (同じ seed なら同じデータ)。固定ユーザーは維持 |
| Redis: sorted set `ranking` に `ZADD` (1 件 1 コマンド、`DEL` してから) | sorted set `ranking` に `ZADD` (1,000 件/コマンド、`DEL` してから) | 維持 (構造) / 変更 (投入方法) | |
| MySQL: `ranking (id INT PK AUTO_INCREMENT, user VARCHAR(50), score INT)`、インデックスなし、1 行 1 INSERT | `ranking (id, user VARCHAR(64) utf8mb4_bin, score INT)` + `UNIQUE(user)` + `INDEX(score, user)`、1,000 行/文 | 変更 | インデックスなしの全表ソートは比較として不公平。`utf8mb4_bin` と `ORDER BY score DESC, user DESC` で sorted set の同点順序に一致させる |
| データ投入後の件数確認は手動 (`select count(*)` / `zcard`) | seed が `ZCARD` と `COUNT(*)` を検証して不一致なら exit 1 | 変更 | |
| 計測: 外部 `time node ...` (起動・接続時間込み) | `performance.now()` による内部計測、各 5 回の中央値と p95 | 変更 | 起動時間を除外し、ばらつきを表示 |
| Top-N: Redis `ZREVRANGE 0 5` (6 件) + 各 `ZSCORE` ×6、MySQL `LIMIT 5` | Top-100 (`--top`)、Redis は `WITHSCORES` で 1 コマンド、MySQL `LIMIT 100` | 変更 | 件数を揃え、Redis 側の不要な往復をなくした |
| 特定ユーザー検索: README の手動例のみ | 項目 3: `ZSCORE` + `ZREVRANK` (1 パイプライン) vs `SELECT score` + `SELECT COUNT(*)+1 WHERE score > ?` | 変更 | 順位の定義: Redis は同点をメンバー順で区別、MySQL は同点を同順位にする。スコアは 10 億通りなので同点はまれ |
| ページング: README の手動例 `zrevrange 10000 10500` (501 件) / `limit 10000,500` (500 件) | 項目 4: 両方 offset 10,000 から 500 件 (`--page-offset` / `--page-size`)。件数不足なら offset を自動調整して表に注記 | 変更 | 件数を揃えた |
| 接続先: `localhost` / `demo:demo@demo` をコードに直書き | 環境変数 `REDIS_*` / `MYSQL_*` (+ `.env`)。既定はローカル | 変更 | AWS でも同じコードを使うため |
| Node 14、CommonJS (`require`) | Node 22+、ESM (`import`)、`engines.node >= 22`、`.nvmrc` | 変更 | |
| `redis:6.0.10` | `valkey/valkey:8` (取得時点 8.1.10) | 変更 | ElastiCache Valkey 8.1 と揃える |
| `mysql:5.7` | `mysql:8.4` (取得時点 8.4.11) | 変更 | RDS MySQL 8.4 と揃える。5.7 は RDS では Extended Support のみ |
| `cpus: 0.1` / `mem_limit: 200M` をデータ生成時に手でコメントアウトし、計測時に戻す | 削除。CPU / メモリ制限なし | 削除 | 手作業の付け外しは再現性を損なう。AWS 版はインスタンスサイズで条件を固定する |
| MySQL コンテナ `restart: always` | なし | 削除 | 使い捨て環境のため |
| ポート公開 `6379:6379` / `3306:3306` (全インターフェース) | `127.0.0.1:6379:6379` / `127.0.0.1:3306:3306` | 変更 | ローカル以外から `demo:demo` で繋がらないようにする |
| 名前付きボリューム `redis_data` / `mysql_data` | `valkey_data` / `mysql_data` | 維持 (方式) / 変更 (名前) | |
| healthcheck なし (起動直後に実行すると接続エラー) | 両コンテナに healthcheck、クライアント側も最大 60 秒リトライ | 変更 | `docker compose up -d` 直後に `npm run seed` できるように |
| `docker-compose stop` / `docker-compose down -v` | `docker compose stop` / `docker compose down -v` | 維持 (compose v2 の書き方) | |
| 結果表示: `console.log` の配列 | Markdown 表 (stdout)。進捗は stderr | 変更 | `npm run bench > result.md` で保存できる |
| AWS 展開手順なし | `infra/` (CDK) + `scripts/aws-*.sh` + `npm run aws:deploy / aws:bench / aws:destroy` | 追加 | |

## 旧版で見つかった不具合 (新版では該当コードを廃止)

- `store_ranking_data.js`: `mysql` の `connection.query()` は Promise ではなく Query オブジェクトを返すため `Promise.all` は何も待たない。
  `connection.end()` は「キュー済みのクエリを実行してから COM_QUIT を送る」仕様 (mysqljs/mysql README "Terminating connections") なので
  投入自体は完走するが、エラーはどこにも捕捉されず、完了・件数の確認もない。Redis 側も `zadd` を await せず `quit()` している
  (コマンドは順に送られるので投入は完走する)。新版は両方とも await し、`ZCARD` / `COUNT(*)` を検証する
- `write_to_redis.js` / `write_to_mysql.js`: `n < 10000` で 9,999 件
- `get_redis_ranking.js`: `zrevrange('ranking', 0, 5)` は 6 件 (MySQL 側は 5 件)
