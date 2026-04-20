import { neon } from '@neondatabase/serverless';
import dotenv from 'dotenv';

// Load .env from project root for local dev; Vercel injects env vars automatically
dotenv.config();             // tries cwd (project root when run from root)
dotenv.config({ path: '../.env' }); // fallback if cwd is server/

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required. Set it in .env or Vercel dashboard.');
}

// Neon serverless driver – returns an async sql`` tagged-template function
const sql = neon(DATABASE_URL);

export default sql;
