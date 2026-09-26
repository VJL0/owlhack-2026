import 'server-only';
import { Pool } from 'pg';
import { connectionConfig } from '../../../database/connection.mjs';

const globalDb = globalThis as unknown as { reefPool?: Pool };
export function tigerPool() {
  if (!globalDb.reefPool) {
    globalDb.reefPool = new Pool(connectionConfig(process.env.TIGER_DATABASE_URL));
    globalDb.reefPool.on('error', () => console.error('TigerData idle connection failed'));
  }
  return globalDb.reefPool;
}
