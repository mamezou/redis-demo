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
  let n = 0
  const insert = 'INSERT INTO demo (name, n) VALUES ?'
  const values = []
  while (n < 100000) {
    values.push(`key-${n}`, n + 1)
    //console.log(n);
    n++
  }
  connection.query(insert, [values], function (err) {
    if (err) throw err
    console.log('書き込み成功しました。')
    connection.end()
  })

  console.log(values)
})
