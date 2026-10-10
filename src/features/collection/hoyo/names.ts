import { isRecord, type GameId } from '../../../../shared/calendar';
import { createHash } from 'node:crypto';
import type { KoreanNames } from '../names';

export const attachHoyoNames = (game: GameId, raw: unknown, names: KoreanNames, language: 'ko-kr' | 'en-us') => {
  if (!isRecord(raw)) throw new Error('Invalid calendar data');
  const result: Record<string, unknown> = { ...raw };
  for (const group of ['events', 'banners', 'challenges']) {
    const items = raw[group];
    if (!Array.isArray(items)) throw new Error('Invalid calendar group');
    result[group] = items.map((item, index) => {
      if (!isRecord(item)) return item;
      const fields = ['characters', 'weapons', 'light_cones', 'agents', 'w_engines'];
      const entityIds = fields.flatMap((field) => {
        const entities = item[field];
        return Array.isArray(entities) ? entities.filter(isRecord)
          .filter((entity) => entity.rarity === 5 || entity.rarity === '5' || entity.rarity === 'S')
          .map((entity) => typeof entity.id === 'number' || typeof entity.id === 'string' ? `${field}:${entity.id}` : '') : [];
      }).filter(Boolean).sort();
      const identity = group === 'banners' ? entityIds.join('|') || `${item.id ?? item.banner_type ?? index}:${String(item.name ?? '')}`
        : `${String(item.type_name ?? 'activity')}:${String(item.id ?? createHash('sha256').update(String(item.name ?? '')).digest('hex').slice(0, 24))}`;
      const localizationKey = `hoyo:${game}:${group}:${identity}`;
      if (language === 'ko-kr') return { ...item, localization_key: localizationKey };
      const name = names[localizationKey];
      return { ...item, ...Object.fromEntries(fields.map((field) => [field, []])),
        name: name?.title ?? `${group === 'banners' ? '픽업' : group === 'challenges' ? '엔드콘텐츠' : '이벤트'} · 한국어 이름 확인`,
        description: '', localization_key: localizationKey, localized: Boolean(name), original_name: item.name };
    });
  }
  return result;
};
