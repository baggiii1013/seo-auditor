// `node:sqlite` is in the runtime (Node 22.5+) but not in @types/node@20, which
// is what this project has installed. The same treatment as types/engine.d.ts:
// declare the handful of members we actually call rather than pull a new major
// of @types/node through the whole app to get them.
//
// Verified against the runtime rather than written from memory — `run` really
// does return `{ changes, lastInsertRowid }`, and `get` misses with `undefined`
// (`null` under Bun, whose `bun:sqlite` lib/db.ts swaps in for this class).

declare module 'node:sqlite' {
  export type SQLValue = null | number | bigint | string | Uint8Array;

  export class StatementSync {
    get(...params: SQLValue[]): Record<string, SQLValue> | undefined | null;
    all(...params: SQLValue[]): Record<string, SQLValue>[];
    run(...params: SQLValue[]): { changes: number; lastInsertRowid: number | bigint };
  }

  export class DatabaseSync {
    constructor(path: string, options?: { open?: boolean; readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
