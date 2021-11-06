const Redis = require('ioredis')

const getRanking = async () => {
  const redis = new Redis({
    host: '127.0.0.1',
    port: 6379,
  })

  redis.on('error', console.error)

  const higherRank = await redis.zrevrange('ranking', 0, 5)

  const result = await Promise.all(
    higherRank.map(async (item) => {
      const score = await redis.zscore('ranking', item)
      return {
        user: item,
        score,
      }
    })
  )
  console.log(result)
  // 切断
  redis.quit()
}
getRanking()
