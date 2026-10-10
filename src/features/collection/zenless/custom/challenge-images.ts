import type { CalendarEvent } from '../../../../../shared/calendar';
import { CUSTOM_SCHEDULE_IMAGES } from '../../../../../shared/schedule-images';

const CHALLENGE_IMAGES = [
  { type: 'annihilation_simulacrum', title: /^(?:모의 세계 섬멸전|Annihilation Simulacrum)(?:\s*[·:：]|$)/i,
    image: CUSTOM_SCHEDULE_IMAGES.zenlessAnnihilationSimulacrum },
  { type: 'shiyu_defense', title: /^(?:시유 방어전|Shiyu Defense)(?:\s*[·:：]|$)/i,
    image: CUSTOM_SCHEDULE_IMAGES.zenlessShiyuDefense },
  { type: 'deadly_assault', title: /^(?:위험한 강습전|Deadly Assault)(?:\s*[·:：]|$)/i,
    image: CUSTOM_SCHEDULE_IMAGES.zenlessDeadlyAssault },
];

export const applyZenlessChallengeImages = (events: CalendarEvent[]): CalendarEvent[] => events.map((event) => {
  if (event.game !== 'zenless' || event.kind !== 'challenge' || event.imageUrls?.length) return event;
  const challenge = CHALLENGE_IMAGES.find(({ type, title }) =>
    event.localizationKey?.startsWith(`hoyo:zenless:challenges:${type}:`) || title.test(event.title));
  return challenge ? { ...event, imageUrls: [challenge.image] } : event;
});
