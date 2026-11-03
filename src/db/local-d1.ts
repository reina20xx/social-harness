import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';

export function createLocalD1(dbPath: string = ':memory:', schemaPath?: string) {
  const db = new DatabaseSync(dbPath);

  if (schemaPath && fs.existsSync(schemaPath)) {
    const sql = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(sql);
  }

  return {
    prepare(query: string) {
      let boundArgs: any[] = [];
      const stmtObj = {
        bind(...args: any[]) {
          boundArgs = args.map((a) => (a === undefined ? null : a));
          return stmtObj;
        },
        async all<T = any>() {
          const stmt = db.prepare(query);
          const results = stmt.all(...boundArgs);
          return { results: results as T[], success: true };
        },
        async first<T = any>() {
          const stmt = db.prepare(query);
          const row = stmt.get(...boundArgs);
          return (row as T) || null;
        },
        async run() {
          const stmt = db.prepare(query);
          const info = stmt.run(...boundArgs);
          return {
            success: true,
            meta: {
              ...info,
              last_row_id: Number(info.lastInsertRowid)
            }
          };
        }
      };
      return stmtObj;
    },
    exec(query: string) {
      db.exec(query);
      return Promise.resolve();
    }
  } as unknown as D1Database;
}
