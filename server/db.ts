import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';
import path from 'path';

// Load .env for local dev; on Vercel env vars are injected automatically
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Set it in .env');
}

// Neon serverless driver – returns an async sql`` tagged-template function
const sql = neon(DATABASE_URL);

export default sql;
