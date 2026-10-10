import type { CalendarEvent } from '../../../../../shared/calendar';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

export const applyEndfieldChallengeImages = (events: CalendarEvent[]): CalendarEvent[] => events.map((event) => {
  const isEchoesOfWar = event.game === 'endfield' && event.kind === 'challenge'
    && (/^(?:전쟁의 메아리|Echoes of War)(?:\s*[·:：]|$)/i.test(event.title)
      || /\(Echoes of War\)/i.test(event.title)
      || event.localizationKey?.startsWith('sra:endfield:event:') && /\(Echoes%20of%20War\)/i.test(event.localizationKey));
  return isEchoesOfWar && !event.imageUrls?.length
    ? { ...event, imageUrls: [CUSTOM_SCHEDULE_IMAGES.endfieldEchoesOfWar] } : event;
});
