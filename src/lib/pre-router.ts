export type IntentCategory =
  | 'DATA_CENTER_DEAL'
  | 'MACRO_CRYPTO'
  | 'SYSTEM_OPS'
  | 'GENERAL_CHIT_CHAT';

export type PreRouteIntent = {
  category: IntentCategory;
  score: number;
  matchedKeywords: string[];
  reason: string;
};

const RULES: Array<{ category: IntentCategory; keywords: string[]; weight: number }> = [
  {
    category: 'DATA_CENTER_DEAL',
    weight: 1.2,
    keywords: [
      'adik',
      'colocation',
      'data center',
      '데이터센터',
      '코로케이션',
      '캡레이트',
      'cap rate',
      'rack',
      'hyperscale',
      'colo',
      '서버',
      '사이트',
      'lease',
      '임대',
      '전력',
      '파워',
      '용량',
      'capacity',
      'colo site',
      'dc',
    ],
  },
  {
    category: 'MACRO_CRYPTO',
    weight: 1.2,
    keywords: [
      '금리',
      '비트코인',
      'bitcoin',
      'btc',
      '유동성',
      '헤지',
      '환율',
      'fed',
      'inflation',
      '리스크',
      'macro',
      '달러',
      '경제',
      'gdp',
      '금융',
      '채권',
      '국채',
      '스테이블',
      '디플레이션',
      '인플레이션',
      'liquidity',
      '암호화',
      'crypto',
      '블록체인',
    ],
  },
  {
    category: 'SYSTEM_OPS',
    weight: 1.2,
    keywords: [
      '에이전트',
      'agent',
      '미션 컨트롤',
      'mission control',
      '스웜',
      'swarm',
      '태스크',
      'task',
      '상태',
      'status',
      '배포',
      'deploy',
      '빌드',
      'build',
      '모니터링',
      'monitor',
      '오케스트레이션',
      '오토',
      'pm2',
      '로그',
      'policy',
      'approval',
      '승인',
      '텔레그램',
      'telegram',
      '웹훅',
      'webhook',
      '큐',
      '큐잉',
      'queue',
    ],
  },
];

function normalize(input: string) {
  return String(input || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(input: string): string[] {
  const text = normalize(input);
  return text
    .split(/[\s,.;:'"!?()[\]{}<>\/\\|`~@$%^&*+=-_]+/)
    .filter(Boolean);
}

function scoreByKeywords(text: string, keywords: string[]): { score: number; matched: string[] } {
  const normalized = normalize(text);
  let score = 0;
  const matched: string[] = [];

  for (const keyword of keywords) {
    const k = normalize(keyword);
    if (!k) continue;

    if (normalized.includes(k)) {
      score += 1;
      matched.push(keyword);
      continue;
    }

    const tokens = tokenize(normalized);
    const keyTokens = tokenize(k);
    if (keyTokens.length > 1 && keyTokens.every((token) => tokens.includes(token))) {
      score += 1;
      matched.push(keyword);
    }
  }

  return { score, matched };
}

export function classifyIntent(input: string): PreRouteIntent {
  let best: PreRouteIntent = {
    category: 'GENERAL_CHIT_CHAT',
    score: 0,
    matchedKeywords: [],
    reason: 'No domain-specific keyword matched.',
  };

  const text = normalize(input);

  for (const rule of RULES) {
    const { score, matched } = scoreByKeywords(text, rule.keywords);
    const weighted = score * rule.weight;

    if (weighted > best.score) {
      best = {
        category: rule.category,
        score: weighted,
        matchedKeywords: matched,
        reason: matched.length > 0 ? `matched=${matched.join(', ')}` : `keyword signal for ${rule.category}`,
      };
    }
  }

  if (best.score < 0.5) {
    return {
      category: 'GENERAL_CHIT_CHAT',
      score: 0,
      matchedKeywords: [],
      reason: 'Fallback to general chat due to low confidence.',
    };
  }

  return best;
}

export function formatIntentForPrompt(intent: PreRouteIntent): string {
  return `이 태스크는 ${intent.category}에 해당함 (${intent.reason})`;
}
