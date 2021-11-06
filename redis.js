const Redis = require('ioredis')
// 接続
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
})

redis.on('error', console.error)

// データ保存
let n = 1
while (n < 10000) {
  redis.set(`key-${n}`, n)
  console.log(n)
  n++
}
// 切断
redis.quit()
