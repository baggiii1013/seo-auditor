import { openDb } from './db';

/** The app's Postgres store, at DATABASE_URL — see lib/db.ts. */
export const store = () => openDb();
