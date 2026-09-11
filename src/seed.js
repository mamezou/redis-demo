// 両方のストアに同じランキングデータを投入する (冪等: 既存データは作り直す)
//   npm run seed -- --users 100000
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { chunks, connectMysql, connectRedis, mysqlTarget, redisTarget } from './clients.js';
import { generateUsers } from './data.js';
import { fmtMs } from './stats.js';

const { values: opt } = parseArgs({
  options: {
    users: { type: 'string', default: '100000' },
    chunk: { type: 'string', default: '1000' },
    seed: { type: 'string', default: '42' },
  },
});
const count = Number(opt.users);
const chunkSize = Number(opt.chunk);
const seed = Number(opt.seed);
if (!Number.isInteger(count) || count < 1) throw new Error(`--users は 1 以上の整数: ${opt.users}`);
if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new Error(`--chunk は 1 以上の整数: ${opt.chunk}`);

const log = (msg) => console.error(`[seed] ${msg}`);

log(`ランキングデータ ${count.toLocaleString()} 件を生成 (seed=${seed})`);
let t0 = performance.now();
const users = generateUsers(count, seed);
log(`生成完了 ${fmtMs(performance.now() - t0)} ms`);

log(`接続: ${redisTarget()} / ${mysqlTarget()}`);
const [redis, db] = await Promise.all([connectRedis(), connectMysql()]);

// --- Redis / Valkey: sorted set `ranking` を作り直す ---
t0 = performance.now();
await redis.del(config.rankingKey);
for (const part of chunks(users, chunkSize)) {
  await redis.zadd(config.rankingKey, ...part.flatMap((u) => [u.score, u.user]));
}
const zcard = await redis.zcard(config.rankingKey);
log(`Redis: ZADD ${zcard.toLocaleString()} 件 (${chunkSize} 件/コマンド) ${fmtMs(performance.now() - t0)} ms`);

// --- MySQL: テーブル `ranking` を作り直す ---
t0 = performance.now();
const table = config.rankingTable;
await db.query(`DROP TABLE IF EXISTS \`${table}\``);
await db.query(
  `CREATE TABLE \`${table}\` (
     id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
     user  VARCHAR(64) NOT NULL COLLATE utf8mb4_bin,
     score INT NOT NULL,
     PRIMARY KEY (id),
     UNIQUE KEY uk_user (user),
     KEY idx_score_user (score, user)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
);
for (const part of chunks(users, chunkSize)) {
  await db.query(`INSERT INTO \`${table}\` (user, score) VALUES ?`, [part.map((u) => [u.user, u.score])]);
}
const [[{ total }]] = await db.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
log(`MySQL: INSERT ${Number(total).toLocaleString()} 件 (${chunkSize} 行/文) ${fmtMs(performance.now() - t0)} ms`);

if (zcard !== count || Number(total) !== count) {
  log(`件数不一致: 期待 ${count}, Redis ${zcard}, MySQL ${total}`);
  process.exitCode = 1;
} else {
  log(`完了: Redis ZCARD=${zcard.toLocaleString()}, MySQL COUNT(*)=${Number(total).toLocaleString()}`);
}

await redis.quit();
await db.end();
