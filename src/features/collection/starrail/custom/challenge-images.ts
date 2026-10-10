import type { CalendarEvent } from '../../../../../shared/calendar';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

export const applyStarrailChallengeImages = (events: CalendarEvent[]): CalendarEvent[] => events.map((event) => {
  const isMemoryOfChaos = event.game === 'starrail' && event.kind === 'challenge'
    && (event.localizationKey?.startsWith('hoyo:starrail:challenges:ChallengeTypeChasm:')
      || /^(?:혼돈의 기억|Memory of Chaos)(?:\s*[·:：]|$)/i.test(event.title));
  return isMemoryOfChaos && !event.imageUrls?.length
    ? { ...event, imageUrls: [CUSTOM_SCHEDULE_IMAGES.starrailMemoryOfChaos] } : event;
});
