// Valkey/Redis と MySQL の性能比較。結果は Markdown 表として stdout に出す (進捗は stderr)
//   npm run bench                       # 既定: 各 5 回、write 10,000 件、Top 100、offset 10,000 から 500 件
//   npm run bench -- --runs 3 --writes 1000
import { parseArgs } from 'node:util';
import { config } from './config.js';
import { chunks, connectMysql, connectRedis, mysqlTarget, redisTarget } from './clients.js';
import { fmtMs, measure } from './stats.js';

const { values: opt } = parseArgs({
  options: {
    runs: { type: 'string', default: '5' },
    writes: { type: 'string', default: '10000' },
    'write-chunk': { type: 'string', default: '1000' },
    top: { type: 'string', default: '100' },
    'page-offset': { type: 'string', default: '10000' },
    'page-size': { type: 'string', default: '500' },
    user: { type: 'string', default: config.fixedUser },
  },
});
const intOpt = (name, min = 1) => {
  const v = Number(opt[name]);
  if (!Number.isInteger(v) || v < min) throw new Error(`--${name} は ${min} 以上の整数: ${opt[name]}`);
  return v;
};
const RUNS = intOpt('runs');
const WRITES = intOpt('writes');
const WRITE_CHUNK = intOpt('write-chunk');
const TOP = intOpt('top');
const PAGE_SIZE = intOpt('page-size');
let pageOffset = intOpt('page-offset', 0);
const USER = opt.user;

const log = (msg) => console.error(`[bench] ${msg}`);
const KEY = config.rankingKey;
const TABLE = config.rankingTable;
const WTABLE = config.writeTable;
const WKEY = config.writeKeyPrefix;

log(`接続: ${redisTarget()} / ${mysqlTarget()}`);
const redis = await connectRedis();
const db = await connectMysql();

// --- 環境情報 ---
const serverInfo = await redis.info('server');
const valkeyVer = /valkey_version:(\S+)/.exec(serverInfo)?.[1];
const redisVer = /redis_version:(\S+)/.exec(serverInfo)?.[1];
const engine = valkeyVer ? `Valkey ${valkeyVer}` : `Redis ${redisVer ?? '?'}`;
const [[{ mysqlVer }]] = await db.query('SELECT VERSION() AS mysqlVer');

const total = await redis.zcard(KEY);
const [[{ cnt }]] = await db.query(`SELECT COUNT(*) AS cnt FROM \`${TABLE}\``).catch(() => [[{ cnt: 0 }]]);
if (total === 0 || Number(cnt) === 0) {
  log('ランキングデータがありません。先に `npm run seed` を実行してください');
  process.exit(1);
}
if (total !== Number(cnt)) log(`警告: 件数が一致しません (Redis ${total}, MySQL ${cnt})`);
let pageNote = '';
if (pageOffset + PAGE_SIZE > total) {
  const clipped = Math.max(0, total - PAGE_SIZE);
  pageNote = ` (件数不足のため offset を ${pageOffset} → ${clipped} に調整)`;
  pageOffset = clipped;
}

// --- 単純 write 計測の準備 (旧 write_to_*.js 相当: key-1..N / demo テーブル) ---
await db.query(`DROP TABLE IF EXISTS \`${WTABLE}\``);
await db.query(
  `CREATE TABLE \`${WTABLE}\` (
     id INT UNSIGNED NOT NULL AUTO_INCREMENT,
     name VARCHAR(50) NOT NULL,
     value INT NOT NULL,
     PRIMARY KEY (id)
   ) ENGINE=InnoDB`,
);
const writeKeys = Array.from({ length: WRITES }, (_, i) => `${WKEY}${i + 1}`);
async function resetWrites() {
  for (const part of chunks(writeKeys, 1000)) await redis.unlink(...part);
  await db.query(`TRUNCATE TABLE \`${WTABLE}\``);
}

// --- 計測 ---
const results = [];
async function compare(row, redisFn, mysqlFn, before) {
  log(`${row.no} ${row.label} ...`);
  const r = await measure(redisFn, { runs: RUNS, before });
  const m = await measure(mysqlFn, { runs: RUNS, before });
  results.push({ ...row, r, m });
  log(`  Redis 中央値 ${fmtMs(r.median)} ms / MySQL 中央値 ${fmtMs(m.median)} ms`);
}

await compare(
  {
    no: '1a',
    label: `単純 write ${WRITES.toLocaleString()} 件 (1 件ずつ await、パイプライン/バッチなし)`,
    redisOp: `SET ×${WRITES.toLocaleString()}`,
    mysqlOp: `INSERT ×${WRITES.toLocaleString()}`,
  },
  async () => {
    for (let i = 1; i <= WRITES; i++) await redis.set(`${WKEY}${i}`, i);
  },
  async () => {
    for (let i = 1; i <= WRITES; i++) {
      await db.query(`INSERT INTO \`${WTABLE}\` (name, value) VALUES (?, ?)`, [`${WKEY}${i}`, i]);
    }
  },
  resetWrites,
);

await compare(
  {
    no: '1b',
    label: `単純 write ${WRITES.toLocaleString()} 件 (Redis: 1 パイプライン、MySQL: ${WRITE_CHUNK.toLocaleString()} 行/文の複数行 INSERT)`,
    redisOp: `pipeline(SET ×${WRITES.toLocaleString()})`,
    mysqlOp: `INSERT ... VALUES (...),(...) ×${Math.ceil(WRITES / WRITE_CHUNK)}`,
  },
  async () => {
    const p = redis.pipeline();
    for (let i = 1; i <= WRITES; i++) p.set(`${WKEY}${i}`, i);
    const replies = await p.exec();
    const failed = replies.find(([err]) => err);
    if (failed) throw failed[0];
  },
  async () => {
    const rowsAll = Array.from({ length: WRITES }, (_, i) => [`${WKEY}${i + 1}`, i + 1]);
    for (const part of chunks(rowsAll, WRITE_CHUNK)) {
      await db.query(`INSERT INTO \`${WTABLE}\` (name, value) VALUES ?`, [part]);
    }
  },
  resetWrites,
);

let topRedis;
let topMysql;
await compare(
  {
    no: '2',
    label: `Top-${TOP} 取得`,
    redisOp: `ZREVRANGE 0 ${TOP - 1} WITHSCORES`,
    mysqlOp: `ORDER BY score DESC LIMIT ${TOP}`,
  },
  async () => {
    topRedis = await redis.zrevrange(KEY, 0, TOP - 1, 'WITHSCORES');
  },
  async () => {
    [topMysql] = await db.query(
      `SELECT user, score FROM \`${TABLE}\` ORDER BY score DESC, user DESC LIMIT ?`,
      [TOP],
    );
  },
);

let userRedis;
let userMysql;
await compare(
  {
    no: '3',
    label: `特定ユーザー (${USER}) のスコアと順位`,
    redisOp: 'ZSCORE + ZREVRANK (1 パイプライン)',
    mysqlOp: 'SELECT score WHERE user=? + SELECT COUNT(*) WHERE score>?',
  },
  async () => {
    const [[, score], [, rank]] = await redis.pipeline().zscore(KEY, USER).zrevrank(KEY, USER).exec();
    userRedis = { score: Number(score), rank: rank === null ? null : Number(rank) + 1 };
  },
  async () => {
    const [[row]] = await db.query(`SELECT score FROM \`${TABLE}\` WHERE user = ?`, [USER]);
    const [[{ user_rank }]] = await db.query(
      `SELECT COUNT(*) + 1 AS user_rank FROM \`${TABLE}\` WHERE score > ?`,
      [row?.score ?? 0],
    );
    userMysql = { score: row?.score ?? null, rank: row ? Number(user_rank) : null };
  },
);

await compare(
  {
    no: '4',
    label: `ページング (offset ${pageOffset.toLocaleString()} から ${PAGE_SIZE} 件)${pageNote}`,
    redisOp: `ZREVRANGE ${pageOffset} ${pageOffset + PAGE_SIZE - 1} WITHSCORES`,
    mysqlOp: `ORDER BY score DESC LIMIT ${pageOffset}, ${PAGE_SIZE}`,
  },
  async () => {
    await redis.zrevrange(KEY, pageOffset, pageOffset + PAGE_SIZE - 1, 'WITHSCORES');
  },
  async () => {
    await db.query(`SELECT user, score FROM \`${TABLE}\` ORDER BY score DESC, user DESC LIMIT ?, ?`, [
      pageOffset,
      PAGE_SIZE,
    ]);
  },
);

// --- 後片付け (write 計測データのみ。ランキングデータは残す) ---
await resetWrites();
await db.query(`DROP TABLE IF EXISTS \`${WTABLE}\``);
await redis.quit();
await db.end();

// --- 整合性チェック ---
const top1Match = topRedis?.[0] === topMysql?.[0]?.user;
const userMatch = userRedis?.score === userMysql?.score && userRedis?.rank === userMysql?.rank;

// --- Markdown 出力 ---
const ratio = (r) => (r.r.median > 0 ? `${(r.m.median / r.r.median).toFixed(1)}x` : '-');
const out = [];
out.push('## 計測結果');
out.push('');
out.push(`- 計測日時: ${new Date().toISOString()}`);
out.push(`- クライアント: Node ${process.version} (${process.platform}/${process.arch})`);
out.push(`- Redis 互換: ${engine} @ ${redisTarget()}`);
out.push(`- MySQL: ${mysqlVer} @ ${mysqlTarget()}`);
out.push(`- ランキング件数: ${total.toLocaleString()} (Redis sorted set \`${KEY}\` / MySQL テーブル \`${TABLE}\`)`);
out.push(`- 各項目 ${RUNS} 回実行。単位 ms。p95 は nearest-rank 法 (${RUNS} 回なら最大値)`);
out.push(`- 整合性: Top-1 ${top1Match ? '一致' : '不一致'} (${topRedis?.[0]} / ${topMysql?.[0]?.user}), ` +
  `${USER} の順位・スコア ${userMatch ? '一致' : '不一致'} (Redis ${userRedis?.rank} 位 ${userRedis?.score} / MySQL ${userMysql?.rank} 位 ${userMysql?.score})`);
out.push('');
out.push('| # | 項目 | Redis 側の操作 | MySQL 側の操作 | Redis 中央値 | Redis p95 | MySQL 中央値 | MySQL p95 | MySQL/Redis |');
out.push('|---|---|---|---|---:|---:|---:|---:|---:|');
for (const r of results) {
  out.push(
    `| ${r.no} | ${r.label} | \`${r.redisOp}\` | \`${r.mysqlOp}\` | ${fmtMs(r.r.median)} | ${fmtMs(r.r.p95)} | ${fmtMs(r.m.median)} | ${fmtMs(r.m.p95)} | ${ratio(r)} |`,
  );
}
console.log(out.join('\n'));
