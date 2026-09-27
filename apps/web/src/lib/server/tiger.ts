import 'server-only';
import { Pool } from 'pg';
import { connectionConfig } from '../../../database/connection.mjs';

const globalDb = globalThis as unknown as { reefPool?: Pool };
export function tigerPool() {
  if (!globalDb.reefPool) {
    // allowExitOnIdle: an idle pool never holds a script or test run open; servers stay up on their listener.
    globalDb.reefPool = new Pool({ ...connectionConfig(process.env.TIGER_DATABASE_URL), allowExitOnIdle: true });
    globalDb.reefPool.on('error', () => console.error('TigerData idle connection failed'));
  }
  return globalDb.reefPool;
}
