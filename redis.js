const Redis = require("ioredis");
// 接続
const redis = new Redis({
   host: "127.0.0.1",
   port: 6379
});

redis.on("error", console.error);
redis.on("connect", () => {
  console.info("Redisに接続されました。");
});
redis.on("close", () => {
  console.info("Redisから切断されました。");
});

// データ保存

redis.set("key", "value");
let n = 0;
while(n < 100000){
  redis.set(`key-${n}`,n+1);
  //console.log(n);
  n++;
}
// データ取得
redis
  .get("key")
  .then(result => {
    console.log(result);
    console.log("Sccess!!");
  })
  .catch(err => {
    console.error(err);
  });

// 切断
redis.quit();


