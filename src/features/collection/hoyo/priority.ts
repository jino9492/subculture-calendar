import { isRecord, type GameId } from '../../../../shared/calendar';
import { attachHoyoNames } from './names';
import { learnKoreanScheduleNames, type KoreanNames } from '../names';
import { parseHoyoCalendar } from './parsers';

export const mergeHoyoStructured = (game: Exclude<GameId, 'wuwa' | 'endfield'>, korean: unknown, foreign: unknown, koreanUrl: string, foreignUrl: string, names: KoreanNames) => {
  const koRaw = attachHoyoNames(game, korean, names, 'ko-kr');
  const koParsed = parseHoyoCalendar(game, koRaw, koreanUrl);
  const learned = learnKoreanScheduleNames(koParsed.events, names);
  // 기간이 비어 있어도 한국어 API가 제공한 이름은 동일 ID에 연결
  for (const group of ['events', 'banners', 'challenges']) {
    const items = koRaw[group];
    if (!Array.isArray(items)) continue;
    for (const item of items.filter(isRecord)) if (typeof item.localization_key === 'string' && typeof item.name === 'string' && /[가-힣]/.test(item.name)) {
      learned[item.localization_key] ??= { title: item.name, sourceUrl: koreanUrl };
    }
  }
  const enRaw = attachHoyoNames(game, foreign, learned, 'en-us');
  const merged: Record<string, unknown> = { ...koRaw };
  let repaired = 0;
  for (const group of ['events', 'banners', 'challenges']) {
    const koItems = koRaw[group];
    const enItems = enRaw[group];
    if (!Array.isArray(koItems) || !Array.isArray(enItems)) continue;
    const result = [...koItems];
    const validPeriod = (item: Record<string, unknown>) => typeof item.start_time === 'number' && item.start_time > 0
      && typeof item.end_time === 'number' && item.end_time > item.start_time && item.end_time <= 4102444800;
    for (const item of enItems.filter(isRecord)) {
      if (!validPeriod(item)) continue;
      const index = result.findIndex((candidate) => isRecord(candidate) && candidate.localization_key === item.localization_key);
      const previous = result[index];
      if (isRecord(previous) && validPeriod(previous)) continue;
      const next = isRecord(previous) ? { ...previous, start_time: item.start_time, end_time: item.end_time, period_source_url: foreignUrl } : { ...item, period_source_url: foreignUrl };
      if (index < 0) result.push(next); else result[index] = next;
      repaired++;
    }
    merged[group] = result;
  }
  const parsed = parseHoyoCalendar(game, merged, koreanUrl);
  const repairedKeys = new Set(['events', 'banners', 'challenges'].flatMap((group) => {
    const items = merged[group];
    return Array.isArray(items) ? items.filter(isRecord).filter((item) => item.period_source_url === foreignUrl).map((item) => item.localization_key) : [];
  }));
  for (const event of parsed.events) if (repairedKeys.has(event.localizationKey)) {
    event.sourceUrl = foreignUrl;
    event.sourceLanguage = 'en-us';
    if (learned[event.localizationKey ?? '']) event.displayLanguage = 'ko-kr';
  }
  const foreignParsed = parseHoyoCalendar(game, enRaw, foreignUrl, 'en-us');
  parsed.issues.push(...foreignParsed.issues.filter((issue) => foreignParsed.events.some((event) => event.id === issue.eventId
    && repairedKeys.has(event.localizationKey) && !learned[event.localizationKey ?? ''])));
  return { ...parsed, repaired };
};
