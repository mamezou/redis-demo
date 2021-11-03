const mysql = require('mysql')

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
  console.log('MySQLに接続しました。')
  connection.query('DROP TABLE IF EXISTS demo')
  const sql =
    'CREATE TABLE demo (id INTEGER PRIMARY KEY AUTO_INCREMENT, name VARCHAR(50), value INTEGER)'
  connection.query(sql, function (err, result) {
    if (err) throw err
    console.log('Table created')
  })
  let n = 1
  while (n < 100000) {
    const post = { value: n, name: `key-${n}` }
    const query = connection.query(
      'INSERT INTO demo SET ?',
      post,
      function (error, results, fields) {
        if (error) throw error
        // Neat!
      }
    )
    n++
    console.log(query.sql)
  }
})
