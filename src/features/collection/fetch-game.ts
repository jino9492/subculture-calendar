import type { GameId } from '../../../shared/calendar';
import { fetchHonkai } from './honkai';
import { fetchGenshin } from './genshin';
import { fetchStarrail } from './starrail';
import { fetchZenless } from './zenless';
import { fetchWuwa } from './wuwa';
import { fetchEndfield } from './endfield';

const collectors = { honkai: fetchHonkai, genshin: fetchGenshin, starrail: fetchStarrail, zenless: fetchZenless, wuwa: fetchWuwa, endfield: fetchEndfield };

export const fetchGame = (game: GameId) => collectors[game]();
