## How to Start

```
sudo docker-compose up -d
```

## npm package install

```
npm install mysql
npm install ioredis
```

## Write DB

```
# 同時に実行すると速度を比較できる
node mysql.js
node redis.js
```

## into docker container

```
sudo docker-compose exec mysql bash
mysql --u demo -h localhost -p

sudo docker-compose exec redis bash
redis-cli
```
