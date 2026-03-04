const TERM_MAP: Array<[RegExp, string]> = [
  [/power capacity/gi, '수전 용량'],
  [/liquid cooling/gi, '액체 냉각'],
  [/air cooling/gi, '공랭 냉각'],
  [/rack density/gi, '랙 밀도'],
  [/colocation/gi, '코로케이션(상면 임대)'],
  [/capex/gi, 'CAPEX'],
  [/opex/gi, 'OPEX'],
  [/substation/gi, '변전소'],
  [/grid interconnect/gi, '계통 연계'],
  [/inference/gi, '추론'],
  [/training/gi, '학습'],
  [/gpu cluster/gi, 'GPU 클러스터'],
  [/network topology/gi, '네트워크 토폴로지'],
  [/throughput/gi, '처리량'],
  [/latency/gi, '지연시간'],
  [/availability zone/gi, '가용영역(AZ)'],
];

function polishSentence(line: string): string {
  let out = line.trim();
  for (const [rx, ko] of TERM_MAP) out = out.replace(rx, ko);
  out = out.replace(/\bMW\b/g, 'MW').replace(/\bGW\b/g, 'GW');
  return out;
}

function isHeading(line: string): boolean {
  return /^#{1,3}\s+/.test(line);
}

function translateLine(line: string): string {
  if (!line.trim()) return '';
  if (isHeading(line)) {
    const h = line.replace(/^#{1,3}\s+/, '');
    return `## [KR] ${polishSentence(h)}`;
  }
  if (/^[-*]\s+/.test(line)) {
    const body = line.replace(/^[-*]\s+/, '');
    return `- ${polishSentence(body)}`;
  }
  return polishSentence(line);
}

export function translateForKoreanCLevel(input: string): string {
  const header = [
    '# 경영진용 1-Pager (KOR)',
    '',
    '> 번역 원칙: 직역을 배제하고, 데이터센터 투자/엔지니어링 의사결정 문맥(CAPEX·수전 용량·냉각·상면 임대) 중심으로 의역',
    '',
  ].join('\n');

  const lines = input.split('\n').map(translateLine);
  return `${header}${lines.join('\n')}`.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
