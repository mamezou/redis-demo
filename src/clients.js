import Redis from 'ioredis';
import mysql from 'mysql2/promise';
import { config } from './config.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// コンテナや RDS の起動直後は接続に失敗するので一定時間リトライする
async function retry(label, fn, { attempts = 30, delayMs = 2000 } = {}) {
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === 1) console.error(`[${label}] 接続待ち: ${err.code ?? err.message}`);
      await sleep(delayMs);
    }
  }
  throw lastErr;
}

export function redisTarget() {
  const { host, port, tls } = config.redis;
  return `${tls ? 'rediss' : 'redis'}://${host}:${port}`;
}

export function mysqlTarget() {
  const { host, port, database, ssl } = config.mysql;
  return `mysql://${host}:${port}/${database}${ssl ? ` (ssl=${ssl})` : ''}`;
}

export async function connectRedis() {
  const { host, port, tls } = config.redis;
  return retry('redis', async () => {
    const redis = new Redis({
      host,
      port,
      ...(tls ? { tls: {} } : {}),
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
    redis.on('error', () => {});
    try {
      await redis.connect();
      return redis;
    } catch (err) {
      redis.disconnect();
      throw err;
    }
  });
}

function sslOption(value) {
  if (!value || /^(0|false|no|off)$/i.test(value)) return undefined;
  if (/^rds$/i.test(value)) return 'Amazon RDS';
  if (/^insecure$/i.test(value)) return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

export async function connectMysql() {
  const { host, port, user, password, database, ssl } = config.mysql;
  return retry('mysql', () =>
    mysql.createConnection({
      host,
      port,
      user,
      password,
      database,
      ssl: sslOption(ssl),
      connectTimeout: 5000,
    }),
  );
}

export function chunks(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}
