require('dotenv').config();
const bcrypt = require('bcrypt');
const { pool } = require('../server/db');

async function main() {
  const [email, password] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: npm run create-user -- you@example.com yourpassword');
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    `INSERT INTO users (email, password_hash) VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
    [email, hash]
  );
  console.log(`User ${email} created/updated.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
