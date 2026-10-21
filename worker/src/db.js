import pg from 'pg';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 3,
});

pool.on('error', (err) => {
  console.error(`[db] idle client error: ${err.message}`);
});

export const query = (text, params) => pool.query(text, params);
