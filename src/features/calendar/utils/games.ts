import type { EventKind, GameId } from '../types';
export const GAMES: Record<GameId, { name: string; icon: string; className: string }> = {
  genshin: { name: '원신', icon: '/icons/genshin_thumb.png', className: 'game-genshin' },
  starrail: { name: '붕괴: 스타레일', icon: '/icons/hsr_thumb.png', className: 'game-starrail' },
  zenless: { name: '젠레스 존 제로', icon: '/icons/zzz_thumb.png', className: 'game-zenless' },
  wuwa: { name: '명조', icon: '/icons/wutheringwave_thumb.png', className: 'game-wuwa' },
  endfield: { name: '명일방주: 엔드필드', icon: '/icons/endfield_thumb.png', className: 'game-endfield' },
};
export const KIND_LABELS: Record<EventKind, string> = { event: '이벤트', banner: '픽업', challenge: '엔드 콘텐츠', weekly: '주간 콘텐츠', version: '버전' };
