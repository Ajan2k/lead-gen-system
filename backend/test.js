const { Client } = require('pg');
require('dotenv').config();

const client = new Client({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || '127.0.0.1',
    database: process.env.DB_NAME || 'leadgen_db',
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
});

console.log("⏳ Attempting to connect to:", client.host, "on port", client.port);

client.connect()
    .then(() => {
        console.log("✅ SUCCESS! Database connection is working.");
        return client.end();
    })
    .catch(err => {
        console.error("❌ FAILURE:", err.message);
    });