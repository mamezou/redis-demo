## How to Start

```
docker-compose up -d
```

## How to Stop

```
docker-compose stop
```

## How to Delete data

```
docker-compose down -v
```

## npm package install

```
npm install mysql
npm install ioredis
```

## Write DB

```
# 同時に実行すると速度を比較できる。この時書き込み件数を減らしておく
time node mysql.js
time node redis.js
```

## into docker container

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

## Ranking

```
time node get_redis_ranking.js
time node get_mysql_ranking.js
```

## Warning

- データ生成時は docker-compose.yml の CPU リミットを外すこと。
