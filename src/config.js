import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// カレントディレクトリの .env があれば読み込む (既に設定済みの環境変数は上書きしない)
function loadDotEnv(path = resolve(process.cwd(), '.env')) {
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv();

const env = process.env;
const truthy = (v) => /^(1|true|yes|on)$/i.test(v ?? '');

export const config = {
  redis: {
    host: env.REDIS_HOST ?? '127.0.0.1',
    port: Number(env.REDIS_PORT ?? 6379),
    tls: truthy(env.REDIS_TLS),
  },
  mysql: {
    host: env.MYSQL_HOST ?? '127.0.0.1',
    port: Number(env.MYSQL_PORT ?? 3306),
    user: env.MYSQL_USER ?? 'demo',
    password: env.MYSQL_PASSWORD ?? 'demo',
    database: env.MYSQL_DATABASE ?? 'demo',
    // '' / 0: TLS なし, 'rds': mysql2 内蔵 "Amazon RDS" CA, 'insecure': 検証なし, その他: OS の CA で検証
    ssl: env.MYSQL_SSL ?? '',
  },
  // ランキングデータの置き場所 (旧デモと同じ名前)
  rankingKey: 'ranking',
  rankingTable: 'ranking',
  // 単純 write 計測用 (旧 write_to_*.js と同じ名前)
  writeTable: 'demo',
  writeKeyPrefix: 'key-',
  // 順位検索に使う固定ユーザー (旧デモと同じ)
  fixedUser: 'mamezou',
  fixedScore: 500,
};
