import { libraryRoot } from '@/engine/src/library.mjs';

import { openDb } from './db';

/** The app's SQLite store, beside the engine's library — see lib/db.ts. */
export const store = () => openDb(libraryRoot());
