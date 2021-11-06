const Redis = require('ioredis')
const mysql = require('mysql')

const faker = require('faker')

// データ初期化
const datas = [
  {
    user: 'mamezou',
    score: 500,
  },
]

for (i = 1; i < 1000000; i++) {
  // ユーザー名を生成する
  const user = faker.name.findName() + i

  // 配列にデータを格納する
  datas.push({
    user,
    score: Math.floor(Math.random() * 1000000000),
  })
}

for (i = 1; i < 5; i++) {
  console.log(`ユーザー「${datas[i].user}」のスコアは「${datas[i].score}」です`)
}

// Redis への データ保存
const redis = new Redis({
  host: '127.0.0.1',
  port: 6379,
})

redis.on('error', console.error)
redis.del('ranking')
datas.forEach((item) => {
  redis.zadd('ranking', item.score, item.user)
})
// 切断
redis.quit()

// MySQL へのデータ保存
const connection = mysql.createConnection({
  host: 'localhost',
  user: 'demo',
  password: 'demo',
  database: 'demo',
})

connection.connect((err) => {
  if (err) {
    console.log('error connecting: ' + err.stack)
    return
  }
  // テーブル作成
  connection.query('DROP TABLE IF EXISTS ranking')

  const sql =
    'CREATE TABLE ranking (id INTEGER PRIMARY KEY AUTO_INCREMENT, user VARCHAR(50), score INTEGER)'
  connection.query(sql, function (err, result) {
    if (err) throw err
  })

  // データ格納
  const writeMysql = async () => {
    await Promise.all(
      datas.map((item) => {
        return connection.query('INSERT INTO ranking SET ?', {
          user: item.user,
          score: item.score,
        })
      })
    )
    // 切断
    connection.end()
  }
  writeMysql()
})
