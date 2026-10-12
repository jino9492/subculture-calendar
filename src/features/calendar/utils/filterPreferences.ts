import { EVENT_KINDS, GAME_IDS } from '../../../../shared/calendar';
import type { EventKind, GameId } from '../types';

export const restoreFilterPreferences = (value: unknown) => {
  const games: unknown = value && typeof value === 'object' && 'games' in value ? value.games : undefined;
  const kinds: unknown = value && typeof value === 'object' && 'kinds' in value ? value.kinds : undefined;
  return {
    games: Array.isArray(games) ? [...new Set(games.filter((item: unknown): item is GameId => GAME_IDS.some((game) => game === item)))] : [...GAME_IDS],
    kinds: Array.isArray(kinds) ? [...new Set(kinds.filter((item: unknown): item is EventKind => EVENT_KINDS.some((kind) => kind === item)))] : [...EVENT_KINDS],
  };
};

export const migrateFilterPreferences = (saved: unknown, version: number) => {
  const filters = restoreFilterPreferences(saved);
  let games = filters.games;
  if (version < 2 && games.length === 4 && !games.includes('honkai') && !games.includes('endfield')) games = [...games, 'endfield'];
  if (version < 4 && GAME_IDS.filter((game) => game !== 'honkai').every((game) => games.includes(game))) {
    games = ['honkai', ...games.filter((game) => game !== 'honkai')];
  }
  return { games, kinds: version < 3 && filters.kinds.includes('challenge') && !filters.kinds.includes('weekly')
    ? [...filters.kinds, 'weekly' as const] : filters.kinds };
};
