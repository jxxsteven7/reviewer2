import type { KeywordsView, Seat, Team } from '@reviewer2/shared/keywords';

// What the turn strip of a game tells one viewer about the moment (TurnStrip.vue), as the banner
// at the top of the game once did. Each line is a key under banner.lines in the locale files.
export type BannerLine =
  | 'over'
  | 'paused'
  | 'yourClue'
  | 'studentsGuessing'
  | 'piThinking'
  | 'yourGuess'
  | 'otherClue'
  | 'otherGuess'
  | 'watchClue'
  | 'watchGuess';

export interface Banner {
  line: BannerLine;
  // The group that a spectator's line is about.
  group: Team | null;
  // Whether the viewer has to act now: a PI in their group's clue phase, or a student in its
  // guess phase.
  urgent: boolean;
}

export function bannerFor(seat: Seat, game: KeywordsView): Banner {
  const say = (line: BannerLine, { group = null, urgent = false }: Partial<Banner> = {}): Banner => ({
    line,
    group,
    urgent,
  });
  if (game.result || game.phase === 'over') return say('over');
  if (game.paused) return say('paused');
  const clue = game.phase === 'clue';
  if (seat.role === 'spectator') return say(clue ? 'watchClue' : 'watchGuess', { group: game.team });
  if (seat.team !== game.team) return say(clue ? 'otherClue' : 'otherGuess');
  if (seat.role === 'captain') return clue ? say('yourClue', { urgent: true }) : say('studentsGuessing');
  return clue ? say('piThinking') : say('yourGuess', { urgent: true });
}
