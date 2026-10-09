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
