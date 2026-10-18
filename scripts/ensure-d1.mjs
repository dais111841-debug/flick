// D1 データベース flick-db が無ければ作成し、wrangler.jsonc の database_id（本番用）を実 ID に置き換える。
// CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID が環境変数にある前提（GitHub Actions・ローカル共通）。
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const NAME = 'flick-db';
const PLACEHOLDER = '00000000-0000-0000-0000-000000000000';
const wr = (...args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });

const conf = readFileSync('wrangler.jsonc', 'utf8');
// 先頭（トップレベル）の d1_databases だけを対象にする。e2e 環境のプレースホルダはローカル専用なので残す
const first = conf.indexOf(`"database_id": "${PLACEHOLDER}"`);
if (first === -1) {
  console.log('database_id is already set');
  process.exit(0);
}

let list = JSON.parse(wr('d1', 'list', '--json'));
let db = list.find((d) => d.name === NAME);
if (!db) {
  console.log(`creating D1 database ${NAME}`);
  wr('d1', 'create', NAME);
  list = JSON.parse(wr('d1', 'list', '--json'));
  db = list.find((d) => d.name === NAME);
}
if (!db) throw new Error('failed to create D1 database');
const id = db.uuid ?? db.id;
writeFileSync('wrangler.jsonc', conf.slice(0, first) + `"database_id": "${id}"` + conf.slice(first + `"database_id": "${PLACEHOLDER}"`.length));
console.log(`database_id = ${id}`);
