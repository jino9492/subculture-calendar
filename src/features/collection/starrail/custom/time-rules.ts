import type { CalendarEvent } from '../../../../../shared/calendar';

const giftName = (title: string) => /^(?:별의선물|giftofodyssey)$/i.test(title.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, ''));

export const isStarrailGift = (event: CalendarEvent) => event.game === 'starrail' && event.kind === 'event'
  && [event.title, ...(event.collectionSources ?? []).map((source) => source.title)].some(giftName);
