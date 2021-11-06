const mysql = require('mysql')

const getRanking = async () => {
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
  })

  const query = await connection.query(
    'SELECT * FROM ranking ORDER BY score DESC LIMIT 5',
    (error, rows, fields) => {
      const result = rows.map((item) => {
        return {
          user: item.user,
          score: item.score,
        }
      })
      console.log(result)
    }
  )
  connection.end()
}
getRanking()
