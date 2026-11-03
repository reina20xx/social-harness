import { serve } from '@hono/node-server';
import * as path from 'node:path';
import workerExport from './index';
import { createLocalD1 } from './db/local-d1';

const PORT = Number(process.env.PORT || 8804);
const schemaPath = path.join(process.cwd(), 'schema.sql');

const db = createLocalD1(':memory:', schemaPath);

serve(
  {
    fetch: (req) => {
      return workerExport.fetch(req, { DB: db } as any);
    },
    port: PORT,
  },
  (info) => {
    console.log(`🚀 Social Harness running at http://localhost:${info.port}`);
  }
);
