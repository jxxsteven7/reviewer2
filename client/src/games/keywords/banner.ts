import { AGENT_PERSONAS, type AgentPersona, type PlayerView } from '@reviewer2/shared';
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
  | 'watchGuess'
  | 'agentThinking';

export interface Banner {
  line: BannerLine;
  // The group that a spectator's line is about.
  group: Team | null;
  // Whether the viewer has to act now: a PI in their group's clue phase, or a student in its
  // guess phase.
  urgent: boolean;
}

// The AI that makes the move now, if one does (docs/architecture.md#ai-players): the PI of the group
// whose turn it is in its clue phase, or every one of its students in its guess phase, is an AI
// player that is online or a person whom an AI plays for while they are offline, Reviewer 1 as the
// server has it. Its move may take a while, since it thinks first, and everyone is told so. While
// the AI players are offline, nothing is being thought of, and the clock runs the move out.
export function agentMoving(
  game: KeywordsView,
  seats: Readonly<Record<string, Seat>>,
  players: readonly PlayerView[],
): AgentPersona | null {
  if (game.result || game.phase === 'over' || game.paused) return null;
  const role = game.phase === 'clue' ? 'captain' : 'guesser';
  const movers = players.filter(({ id }) => seats[id]?.team === game.team && seats[id]?.role === role);
  const moving = (player: PlayerView) => (player.agent !== undefined && player.online) || player.takenOver === true;
  if (movers.length === 0 || !movers.every(moving)) return null;
  return movers.find((player) => player.agent !== undefined)?.agent ?? AGENT_PERSONAS[0];
}

// What the strip tells a viewer in a seat; `agent` is the AI that makes the move now, if one does.
export function bannerFor(seat: Seat, game: KeywordsView, agent: AgentPersona | null = null): Banner {
  const say = (line: BannerLine, { group = null, urgent = false }: Partial<Banner> = {}): Banner => ({
    line,
    group,
    urgent,
  });
  if (game.result || game.phase === 'over') return say('over');
  if (game.paused) return say('paused');
  if (agent !== null) return say('agentThinking');
  const clue = game.phase === 'clue';
  if (seat.role === 'spectator') return say(clue ? 'watchClue' : 'watchGuess', { group: game.team });
  if (seat.team !== game.team) return say(clue ? 'otherClue' : 'otherGuess');
  if (seat.role === 'captain') return clue ? say('yourClue', { urgent: true }) : say('studentsGuessing');
  return clue ? say('piThinking') : say('yourGuess', { urgent: true });
}
