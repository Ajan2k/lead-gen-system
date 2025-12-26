// backend/config/db.js
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Test the connection on startup
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Database Connection Failed:', err.message);
  }
  client.query('SELECT NOW()', (err2, result) => {
    release();
    if (err2) {
      return console.error('❌ Error executing test query', err2.stack);
    }
    console.log('✅ Connected to PostgreSQL Database at', result.rows[0].now);
  });
});

module.exports = pool;