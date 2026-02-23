import fs from 'fs';
import path from 'path';
import { Client } from '@notionhq/client';

function loadEnv(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const raw = fs.readFileSync(filePath, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function normalizeNotionId(raw: string): string {
  return String(raw || '')
    .replace(/^collection:\/\//, '')
    .replace(/^https?:\/\/www\.notion\.so\//, '')
    .split('?')[0]
    .replace(/-/g, '');
}

async function main() {
  loadEnv(path.resolve(process.cwd(), '.env.local'));

  const apiKey = process.env.NOTION_API_KEY;
  const databaseIdRaw = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !databaseIdRaw) {
    throw new Error('NOTION_API_KEY / NOTION_DATABASE_ID is not configured in .env.local');
  }

  const databaseId = normalizeNotionId(databaseIdRaw);
  const notion = new Client({ auth: apiKey });

  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (db as any)?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error('No data source found under target database');
  }

  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = (ds as any).properties || {};
  const titlePropertyName = Object.keys(properties).find((k) => properties[k]?.type === 'title');
  if (!titlePropertyName) {
    throw new Error('No title property found in target data source');
  }

  const page = await notion.pages.create({
    parent: { data_source_id: dataSourceId },
    properties: {
      [titlePropertyName]: {
        title: [
          {
            type: 'text',
            text: { content: '🚀 Mission Control Connection Test' },
          },
        ],
      },
    },
    children: [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: '시스템 통신 테스트가 완료되었습니다.' },
            },
          ],
        },
      },
    ],
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        databaseId,
        dataSourceId,
        titlePropertyName,
        pageId: page.id,
        url: (page as any).url,
      },
      null,
      2
    )
  );
}

main().catch((err: any) => {
  console.error(
    JSON.stringify(
      {
        ok: false,
        name: err?.name,
        code: err?.code,
        status: err?.status,
        message: err?.message,
        body: err?.body,
      },
      null,
      2
    )
  );
  process.exit(1);
});
