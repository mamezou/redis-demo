import { faker } from '@faker-js/faker';
import { config } from './config.js';

export const MAX_SCORE = 999_999_999;

// 旧 store_ranking_data.js と同じ構造: 先頭に固定ユーザー mamezou (score 500)、
// 残りは faker の氏名 + 連番 (一意) にランダムスコア。seed 固定で毎回同じデータになる
export function generateUsers(count, seed = 42) {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`users は 1 以上の整数で指定してください: ${count}`);
  }
  faker.seed(seed);
  const users = new Array(count);
  users[0] = { user: config.fixedUser, score: config.fixedScore };
  for (let i = 1; i < count; i++) {
    users[i] = {
      user: `${faker.person.firstName()} ${faker.person.lastName()} ${i}`,
      score: faker.number.int({ min: 0, max: MAX_SCORE }),
    };
  }
  return users;
}
