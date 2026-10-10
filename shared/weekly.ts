const DAY = 86400000;
export const WEEK_DURATION = 7 * DAY;
const KST_OFFSET = 9 * 3600000;
const RESET_HOUR = 5 * 3600000;

export const weeklyStartAt = (now: number): number => {
  // 리셋 시각을 뺀 한국 날짜로 월요일 05시 이전도 직전 주에 포함
  const shifted = new Date(now + KST_OFFSET - RESET_HOUR);
  const midnight = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  return midnight - ((shifted.getUTCDay() + 6) % 7) * DAY - KST_OFFSET + RESET_HOUR;
};
