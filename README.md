# Redis VS MySQL Demo

このリポジトリではRedisとMySQLを用いた速度比較のデモを行います。  
ゲームのランキングボードを想定し、RedisとMySQLの両方で検索を行い、比較します。

# Requirement

- Node.js（Tested version 14.17.6）
- Docker（Tested version 20.10.14, build a224086）
- Docker Compose（Tested version 1.29.2, build 5becea4c）

# Install

- Step1: Clone the repository

```
git clone https://github.com/mamezou/redis-demo.git
cd redis-demo
```

- Step2: Up docker-compose

```
docker-compose up -d
```

- Step3: Install node modules

```
npm install
```

# Usage 1 : Write data to Redis and MySQL

10000データをRedisとMySQLに書き込み、速度を比較します。

```
time node write_to_redis.js
time node write_to_mysql.js

# データが格納されているか確認
docker-compose exec mysql mysql -u demo -p demo -e "select count(*) from demo;"
docker-compose exec redis redis-cli keys "*"
```

# Usage 2 : Read data from Redis and MySQL

100万のランキングデータをRedisとMySQLから読み込み、速度を比較します。  
Redisではソート済みハッシュを用いて格納しています。

- Step1: Write data to Redis（First time only）

```
# ランキングデータ生成時は`docker-compose.yml`の`cpus: 0.1`を2箇所コメントアウトしてください。
node store_ranking_data.js
```

※データ生成後は`docker-compose.yml`に記載がある`cpus: 0.1`のコメントアウトを外してください。

- Step2: Read data from Redis

```
time node get_redis_ranking.js
time node get_mysql_ranking.js
```

## Enter the Docker container and check the data

```
docker-compose exec mysql mysql -u demo -p
use demo
select * from ranking order by score desc limit 10000,500;
select count(*) from ranking;
select * from ranking where user='mamezou';

docker-compose exec redis redis-cli
zrevrange ranking 10000 10500
zcard ranking
zscore ranking mamezou
```

## How to Stop

```
docker-compose stop
```

## How to Delete data

```
docker-compose down -v
```
