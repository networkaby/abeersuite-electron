import { Client } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Disable TLS unauthorized check for cloud instances with self-signed cert chains
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Load environment files
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

function getActiveDbPair(): { db1: { label: string; url: string }; db2: { label: string; url: string } } {
  // 1. Check CLI arguments first
  const cliArgs = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
  if (cliArgs.length >= 2) {
    return {
      db1: { label: 'CLI_DB_1', url: cliArgs[0] },
      db2: { label: 'CLI_DB_2', url: cliArgs[1] },
    };
  }

  // 2. Scan sequentially for COMPARE_DB_1, COMPARE_DB_2, COMPARE_DB_3, ...
  const available: { label: string; url: string }[] = [];
  for (let i = 1; i <= 50; i++) {
    const key = `COMPARE_DB_${i}`;
    const val = process.env[key]?.trim();
    if (val && val.length > 0) {
      available.push({ label: key, url: val });
    }
  }

  if (available.length >= 2) {
    // Pick the first available and the next available
    return {
      db1: available[0],
      db2: available[1],
    };
  }

  if (available.length === 1) {
    console.error(`❌ Only one comparison database found (${available[0].label}).`);
    console.error('Please define at least two databases (e.g. COMPARE_DB_1 and COMPARE_DB_2) in .env or .env.local.');
    process.exit(1);
  }

  // 3. Fallback to DIRECT_URL / LOCAL_DATABASE_URL
  const directUrl = process.env.DIRECT_URL || process.env.DATABASE_URL;
  const localUrl = process.env.LOCAL_DATABASE_URL;

  if (directUrl && localUrl) {
    return {
      db1: { label: 'DIRECT_URL (Cloud)', url: directUrl },
      db2: { label: 'LOCAL_DATABASE_URL', url: localUrl },
    };
  }

  console.error('❌ Error: At least two database URLs are required to compare.');
  console.error('Please define COMPARE_DB_1 and COMPARE_DB_2 in your .env / .env.local file,');
  console.error('or pass them as command line arguments: pnpm db:compare <url1> <url2>');
  process.exit(1);
}

function maskUrl(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const user = u.username ? u.username.slice(0, 8) + '...' : '';
    return `${u.protocol}//${user}@${u.host}${u.pathname}`;
  } catch {
    return rawUrl.slice(0, 30) + '...';
  }
}

async function getStats(db: { label: string; url: string }) {
  const client = new Client({
    connectionString: db.url,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const tablesRes = await client.query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const indexesRes = await client.query(`
    SELECT count(*)::int as c FROM pg_indexes WHERE schemaname = 'public';
  `);

  const columnsRes = await client.query(`
    SELECT table_name, count(column_name)::int as col_count
    FROM information_schema.columns
    WHERE table_schema = 'public'
    GROUP BY table_name;
  `);

  const colMap: Record<string, number> = {};
  for (const r of columnsRes.rows) {
    colMap[r.table_name] = r.col_count;
  }

  const tables = tablesRes.rows.map((r: any) => r.table_name);
  const counts: Record<string, number> = {};

  for (const t of tables) {
    try {
      const res = await client.query(`SELECT count(*)::int as c FROM public."${t}"`);
      counts[t] = res.rows[0].c;
    } catch {
      counts[t] = -1;
    }
  }

  await client.end();
  return { counts, colMap, indexes: indexesRes.rows[0].c, tablesCount: tables.length };
}

async function run() {
  const { db1, db2 } = getActiveDbPair();

  console.log('\n================================================================');
  console.log('                   DATABASE COMPARISON UTILITY                  ');
  console.log('================================================================');
  console.log(`DB 1: [${db1.label}] -> ${maskUrl(db1.url)}`);
  console.log(`DB 2: [${db2.label}] -> ${maskUrl(db2.url)}`);
  console.log('----------------------------------------------------------------');
  console.log('Connecting & fetching tables, row counts, and indexes in parallel...');

  const startTime = Date.now();
  const [res1, res2] = await Promise.all([getStats(db1), getStats(db2)]);
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`Done in ${duration}s!`);
  console.log('----------------------------------------------------------------');
  console.log(`${db1.label.padEnd(20)}: ${res1.tablesCount} tables, ${res1.indexes} indexes`);
  console.log(`${db2.label.padEnd(20)}: ${res2.tablesCount} tables, ${res2.indexes} indexes`);
  console.log('----------------------------------------------------------------');

  const allTables = Array.from(
    new Set([...Object.keys(res1.counts), ...Object.keys(res2.counts)])
  ).sort();

  const diffs: string[] = [];
  let matches = 0;

  for (const t of allTables) {
    const c1 = res1.counts[t];
    const c2 = res2.counts[t];
    const col1 = res1.colMap[t];
    const col2 = res2.colMap[t];

    if (c1 === undefined) {
      diffs.push(`[-] Missing in ${db1.label}: Table "${t}" (present in ${db2.label} with ${c2} rows, ${col2} cols)`);
    } else if (c2 === undefined) {
      diffs.push(`[-] Missing in ${db2.label}: Table "${t}" (present in ${db1.label} with ${c1} rows, ${col1} cols)`);
    } else if (c1 !== c2 || col1 !== col2) {
      const rowNote = c1 !== c2 ? `Rows: ${c1} vs ${c2}` : `Rows: ${c1}`;
      const colNote = col1 !== col2 ? `Cols: ${col1} vs ${col2}` : ``;
      const note = [rowNote, colNote].filter(Boolean).join(' | ');
      diffs.push(`[!] Mismatch on "${t}": ${note}`);
    } else {
      matches++;
    }
  }

  if (diffs.length === 0) {
    console.log(`\n🎉 SUCCESS: Both databases are 100% IDENTICAL!`);
    console.log(`All ${matches} tables, columns, and row counts matched perfectly.`);
  } else {
    console.log(`\n⚠️  FOUND ${diffs.length} DIFFERENCE(S) (and ${matches} matched tables):`);
    diffs.forEach((d) => console.log('  ' + d));
  }
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('❌ Verification failed:', err.message || err);
  process.exit(1);
});
