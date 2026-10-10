import type { CalendarEvent } from '../../../../../shared/calendar';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

const CHALLENGE_IMAGES = [
  { type: 'ActTypeTower', title: /^(?:나선 비경|연월 나선|Spiral Abyss)(?:\s*[·:：]|$)/i,
    image: CUSTOM_SCHEDULE_IMAGES.genshinSpiralAbyss },
  { type: 'ActTypeRoleCombat', title: /^(?:현실 속 환상극|Imaginarium Theater)(?:\s*[·:：]|$)/i,
    image: CUSTOM_SCHEDULE_IMAGES.genshinImaginariumTheater },
];

const isStygianOnslaught = (event: CalendarEvent) => event.game === 'genshin'
  && (event.kind === 'event' || event.kind === 'challenge')
  && /^(?:「?지맥 제압전(?:」|\s|$)|Stygian Onslaught(?:\s*[·:：]|$))/i.test(event.title);

export const applyGenshinChallengeImages = (events: CalendarEvent[]): CalendarEvent[] => {
  const stygianImages = events.filter((event) => isStygianOnslaught(event) && event.imageUrls?.length);
  return events.map((event) => {
    if (event.game !== 'genshin' || event.imageUrls?.length) return event;
    if (isStygianOnslaught(event)) {
      const source = stygianImages.find((candidate) => Date.parse(candidate.startAt) === Date.parse(event.startAt)) ?? stygianImages[0];
      return source?.imageUrls ? { ...event, imageUrls: [...source.imageUrls] } : event;
    }
    if (event.kind !== 'challenge') return event;
    const challenge = CHALLENGE_IMAGES.find(({ type, title }) =>
      event.localizationKey?.startsWith(`hoyo:genshin:challenges:${type}:`) || title.test(event.title));
    return challenge ? { ...event, imageUrls: [challenge.image] } : event;
  });
};
