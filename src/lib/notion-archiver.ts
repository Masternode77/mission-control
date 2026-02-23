import { Client } from '@notionhq/client';

export type ReportDomain = '거시경제' | '데이터센터' | '투자전략';

function normalizeNotionId(raw: string): string {
  return String(raw || '')
    .replace(/^collection:\/\//, '')
    .replace(/^https?:\/\/www\.notion\.so\//, '')
    .split('?')[0]
    .replace(/-/g, '');
}

function toParagraphBlocks(markdownContent: string) {
  const chunks: string[] = [];
  const src = String(markdownContent || '').trim();
  const max = 1800;

  for (let i = 0; i < src.length; i += max) {
    chunks.push(src.slice(i, i + max));
  }

  return (chunks.length ? chunks : ['(empty)']).slice(0, 80).map((text) => ({
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [
        {
          type: 'text' as const,
          text: { content: text },
        },
      ],
    },
  }));
}

function normalizeDomain(domain?: string): ReportDomain {
  const d = String(domain || '').trim();
  if (d === '데이터센터') return '데이터센터';
  if (d === '투자전략') return '투자전략';
  return '거시경제';
}

export async function archiveToNotion(title: string, markdownContent: string, domain?: string): Promise<string> {
  const apiKey = process.env.NOTION_API_KEY;
  const databaseIdRaw = process.env.NOTION_DATABASE_ID;

  if (!apiKey || !databaseIdRaw) {
    throw new Error('NOTION_API_KEY / NOTION_DATABASE_ID is not configured');
  }

  const notion = new Client({ auth: apiKey });
  const databaseId = normalizeNotionId(databaseIdRaw);

  const db = await notion.databases.retrieve({ database_id: databaseId });
  const dataSourceId = (db as any)?.data_sources?.[0]?.id;
  if (!dataSourceId) {
    throw new Error('No data source found for target database');
  }

  const ds = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
  const properties = (ds as any).properties || {};
  const titlePropertyName = Object.keys(properties).find((k) => properties[k]?.type === 'title');
  if (!titlePropertyName) {
    throw new Error('No title property found in target data source');
  }

  const notionProps: Record<string, any> = {
    [titlePropertyName]: {
      title: [
        {
          type: 'text',
          text: {
            content: String(title || 'Untitled Report').slice(0, 200),
          },
        },
      ],
    },
  };

  if (properties['도메인']?.type === 'select') {
    notionProps['도메인'] = {
      select: {
        name: normalizeDomain(domain),
      },
    };
  }

  const page = await notion.pages.create({
    parent: { data_source_id: dataSourceId },
    properties: notionProps,
    children: toParagraphBlocks(markdownContent),
  });

  return (page as any).url as string;
}
