const CHALLENGE_NAMES: Record<string, string> = { ChallengeTypeBoss: '종말의 환영', ChallengeTypeChasm: '혼돈의 기억',
  ChallengeTypeStory: '허구 이야기', ChallengeTypePeak: '이상 중재' };

export const STAR_RAIL_CHALLENGE_PREFIXES: Record<string, string> = { ChallengeTypeBoss: 'Apocalyptic Shadow', ChallengeTypeChasm: 'Memory of Chaos',
  ChallengeTypeStory: 'Pure Fiction', ChallengeTypePeak: 'Anomaly Arbitration' };

export const formatStarrailChallengeTitle = (title: string, type: unknown) => {
  const contentName = typeof type === 'string' ? CHALLENGE_NAMES[type] : undefined;
  return title && contentName && !title.startsWith(contentName) ? `${contentName} · ${title}` : title;
};
