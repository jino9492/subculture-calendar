import type { GameId } from '../../../shared/calendar';
import { fetchGenshin } from './genshin';
import { fetchStarrail } from './starrail';
import { fetchZenless } from './zenless';
import { fetchWuwa } from './wuwa';
import { fetchEndfield } from './endfield';

const collectors = { genshin: fetchGenshin, starrail: fetchStarrail, zenless: fetchZenless, wuwa: fetchWuwa, endfield: fetchEndfield };

export const fetchGame = (game: GameId) => collectors[game]();
