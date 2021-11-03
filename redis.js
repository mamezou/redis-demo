const Redis = require('ioredis')
// 接続
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
})

redis.on('error', console.error)
redis.on('connect', () => {
  console.info('Redisに接続されました。')
})
// データ保存
let n = 1
while (n < 1000000) {
  redis.set(`key-${n}`, n)
  console.log(n)
  n++
}
// 切断
redis.quit()
