import sql from './db';

async function main() {
  await sql`INSERT INTO users (username, password, role) VALUES ('staff', 'staff123', 'STAFF') ON CONFLICT (username) DO NOTHING`;
  console.log('✅ Staff user added');
}

main().catch(e => { console.error(e); process.exit(1); });
