import type { AgentPersona } from './agent';
import type { DuoNotice } from './duos';
import type { Language } from './language';
import type { MatchView } from './match';
import type { Rank } from './ranks';
import type { StreakNotice } from './streaks';

// What every member of a room sees of it. The game's own part, such as seats and the board, is
// in `data`; the server builds it for each viewer separately (docs/architecture.md).

export type RoomPhase = 'lobby' | 'playing' | 'ended';

export interface PlayerView {
  id: string;
  // An account's username, an AI player's persona, or for a guest "Guest" and the number, for
  // whatever reads the view without the interface's words; the client names guests and AI players
  // in the language of the interface (docs/architecture.md#players-and-identity), and a friend by
  // the name the viewer gives them, if any (docs/architecture.md#friends).
  name: string;
  // A guest's number in the room: guests are numbered in the order they first came in, and a guest
  // who leaves and comes back from the same browser has the same number again. Nobody else has one.
  guest?: number;
  online: boolean;
  // The address of the avatar that a player with an account uploaded. Without it, the client
  // draws the default avatar from the name.
  avatar?: string;
  // The academic rank of a player with an account (ranks.ts), and the handle of their public
  // profile (accounts.ts). A guest has neither.
  rank?: Rank;
  handle?: string;
  // An AI player (docs/architecture.md#ai-players) has the persona it plays as, which the client
  // names it by, and no account. It is online while the server's agent answers.
  agent?: AgentPersona;
  // A player who has been offline long enough in their turn for an AI to play it for them, until
  // they come back (docs/architecture.md#ai-players).
  takenOver?: true;
}

// A friend whom the viewer has invited, as the start bar shows them, with the handle of their
// public profile (accounts.ts), by which the client finds the name the viewer gives them.
export interface InvitedView {
  handle: string;
  username: string;
  avatar: string | null;
}

// Who chairs the room when the chair has gone: the first to have joined among those online, or
// else among everyone, in the order of `players`, which is the order they joined in. An AI player
// never chairs a room. Nobody when there is no one. The server hands the chair over with this, and
// the chair's leave sheet names whom it will be, so the two can't drift apart.
export function nextChair(players: readonly Pick<PlayerView, 'id' | 'online' | 'agent'>[]): string | null {
  const people = players.filter((player) => player.agent === undefined);
  return (people.find((player) => player.online) ?? people[0])?.id ?? null;
}

// What the game that has just ended brought a member who played in it: its points, as the records
// keep them (docs/architecture.md#academic-ranks), and where they came from, in the game's own terms
// (for the team word guessing game, `KeywordsScoreDetail`).
export interface GamePoints {
  playerId: string;
  points: number;
  detail?: unknown;
}

// A question of how a game was (RoomView.rating).
export interface RatingView {
  options: string[];
  rating: string | null;
}

export interface RoomView<Game = unknown> {
  // A new random ID for every room, so that a code that is used again later never mixes two rooms up.
  roomId: string;
  code: string;
  // Goes up with every change. A client keeps the snapshot with the highest rev for its roomId.
  rev: number;
  game: string;
  language: Language;
  // The word lists that the games draw from, absent for a game that uses no word library
  // (GameModule.words on the server).
  fields?: string[];
  // Whether every game draws its word lists anew, at random, from those with enough words in the
  // room's language (drawFields in protocol.ts), whatever `fields` holds: the room keeps those for
  // when the chair turns this off again. Nobody is told which lists a game drew. Absent with
  // `fields`.
  randomFields?: boolean;
  // Whether the room is listed on the home page for anyone with an account to join, rather than
  // open only to those who have its code (docs/architecture.md#public-rooms).
  public: boolean;
  // How many words of the chair's own the next games draw from along with the word lists
  // (docs/games/keywords.md#custom-words), for a game with a board of words alone. The words
  // themselves go to the chair alone, who edits them; for everyone else the key is absent.
  customWordCount?: number;
  customWords?: string[];
  // The friends whom the viewer has invited into the room and who haven't come, while the
  // invitations stand, the oldest first (docs/architecture.md#friends): for the member who sent
  // them alone, and absent for everyone else and while there are none.
  invited?: InvitedView[];
  phase: RoomPhase;
  // How many games this room has started. A start gives the number it saw, so that one that
  // comes late or twice can't start a game that nobody asked for.
  round: number;
  // The game that is being played or has just ended, and null in the waiting room. The chair's
  // messages about a game name it, so that a late one can't land in the next game.
  gameId: string | null;
  chairId: string | null;
  players: PlayerView[];
  // Whether the chair may invite AI players now, and players who go offline in their turn are
  // played for (docs/architecture.md#ai-players): the server has an agent, the room is private and
  // plays no match, and the operator has let the chair's account have AI players.
  agents: boolean;
  // How many screens are watching. They have no name and no seat, so this number is all that
  // anyone sees of them; the chair can send them all away.
  screens: number;
  // The viewer's own player ID, or null for a screen, which watches without playing.
  me: string | null;
  // The match that the room is playing, or null for a room that isn't a match. Everyone sees the
  // same scores.
  match: MatchView | null;
  // The streaks that the game which has just ended brought the players with accounts to, from
  // STREAK_MIN games on (streaks.ts): every winning streak, for the whole room to cheer, and the
  // viewer's own losing streak, which nobody else is told of. Empty in any other phase.
  streaks: StreakNotice[];
  // The titles that the game which has just ended brought the viewer's friends who played in it
  // (duos.ts), told to the viewer alone. Empty for anyone else, a screen and in any other phase.
  duos: DuoNotice[];
  // Whether an AI has played in the game being played or the one that has just ended, as an AI
  // player or for someone who was offline: such a game brings nobody points
  // (docs/architecture.md#ai-players). False in the waiting room.
  agentsPlayed: boolean;
  // The points of the game that has just ended, for each member in the room who played in it, which
  // the game shows as it ends. Empty in any other phase, and after a game that brings no points: one
  // that the chair withdrew, or that an AI played in.
  points: GamePoints[];
  // How the game that has just ended was, as the viewer may still say (docs/architecture.md#ratings):
  // the options, and what the viewer chose so far, or null for nothing yet. Null for anyone who
  // didn't play in it, once they have dismissed the question, in any other phase, and after a game
  // that may not be rated, such as one that didn't finish.
  rating: RatingView | null;
  // The game's own part of the view, built for this viewer alone.
  data: Game;
}
