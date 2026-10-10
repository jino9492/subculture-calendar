export const isGenshinHardChallenge = (type: unknown, title: string) => type === 'ActTypeHardChallenge' && /연월 나선|현실 속 환상극/.test(title);
