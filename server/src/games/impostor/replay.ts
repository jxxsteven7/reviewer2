import type { BallotView, ImpostorReplay, LineView, ReportView, ReportVerdict } from '@reviewer2/shared/impostor';
import { peopleOf, type KeptCount, type KeptReplay, type Recount } from '../../core/game';
import type { GameLogEntry } from '../../core/gameLog';
import { factsFrom, LOGGED, outcomeOf, pointsShown, resultsFrom, scoresFrom, type ImpostorSetup } from './results';

// The replays of the hidden word game (docs/architecture.md#replays) and its records counted again
// (GameModule.recount), from how a kept game began (ImpostorSetup) and its log. The log keeps every
// line as its writer's message, and what the game made of the moves as entries of its own
// (LOGGED): every vote revealed, every line whose time ran out, every player who went out, every
// report settled, every guess of the students' word and the end. The records are counted from
// those (results.ts), as they were at the end of the game.

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

// The entries of a kept log up to its end.
const played = (entries: readonly GameLogEntry[]): GameLogEntry[] => {
  const end = entries.findIndex(({ type }) => type === 'end');
  return end === -1 ? [...entries] : entries.slice(0, end);
};

// What a kept game that finished counts under the rules of today: everyone's part in it, their
// points, how it came out and whether the chair removed a player of the game, which brings nobody
// points, as the module counts them at the end of a game. A game that a Reviewer 2 left, which
// nobody won, counts for nobody's record and brings nobody points. Null for a game that didn't
// finish.
export function recountOf({ setup, log, keyOf }: KeptCount): Recount | null {
  const facts = factsFrom(setup as ImpostorSetup, played(log.entries));
  if (!facts) return null;
  return {
    results: resultsFrom(facts) ?? [],
    scores: scoresFrom(facts, keyOf) ?? [],
    outcome: outcomeOf(facts.result),
    scoresNothing: facts.removed,
  };
}

// A kept game that finished as an account watches it again, with who everyone was: one that a
// side won, and one that a Reviewer 2 left, which has no winner. The points are those the end of
// the game showed, none for a game that brought nobody any (pointsShown in results.ts).
export function shownReplay({ setup, log, accounts, viewer }: KeptReplay): ImpostorReplay | null {
  const kept = setup as ImpostorSetup;
  const entries = played(log.entries);
  const facts = factsFrom(kept, entries);
  if (!facts?.result) return null;
  const number = new Map(kept.players.map((player) => [player.id, player.number]));
  const of = (id: string) => number.get(id) ?? 0;
  const lines: LineView[] = [];
  const ballots: BallotView[] = [];
  const reports: ReportView[] = [];
  const wrote = new Set<string>();
  const line = (by: string, round: number, text: string | null, tie?: boolean) => {
    const key = `${round}:${by}`;
    lines.push({ round, number: of(by), text, tie: tie ?? wrote.has(key) });
    wrote.add(key);
  };
  for (const { by, type, data } of entries) {
    if (!isObject(data)) continue;
    if (type === 'impostor:describe' && by !== null && typeof data.text === 'string') {
      line(by, Number(data.round), data.text);
    } else if (type === LOGGED.missed && typeof data.player === 'string') {
      line(data.player, Number(data.round), null, data.tie === true);
    } else if (type === LOGGED.votes && isObject(data.votes)) {
      ballots.push({
        round: Number(data.round),
        ballot: data.ballot === 'revote' ? 'revote' : 'vote',
        votes: Object.fromEntries(
          Object.entries(data.votes as Record<string, string | null>).map(([voter, target]) => [
            of(voter),
            target === null ? 0 : target === 'timeout' ? -1 : of(target),
          ]),
        ),
        out: typeof data.out === 'string' ? of(data.out) : null,
        tied: Array.isArray(data.tied) ? (data.tied as string[]).map(of) : [],
      });
    } else if (type === LOGGED.judged && typeof data.by === 'string' && typeof data.target === 'string') {
      const verdicts = isObject(data.verdicts) ? (data.verdicts as Record<string, ReportVerdict>) : {};
      reports.push({
        round: Number(data.round),
        by: of(data.by),
        target: of(data.target),
        line: typeof data.line === 'number' ? data.line : null,
        reason: typeof data.reason === 'string' ? data.reason : '',
        eligible: Object.keys(verdicts).length,
        judged: Object.keys(verdicts).length,
        mine: null,
        mayJudge: false,
        verdicts: Object.fromEntries(Object.entries(verdicts).map(([id, verdict]) => [of(id), verdict])),
        passed: data.passed === true,
      });
    }
  }
  const agents = kept.players.some((player) => log.agents?.[player.id] !== undefined);
  const scores = (pointsShown(facts, agents) && scoresFrom(facts, (id) => id)) || [];
  const ids = kept.players.map((player) => player.id);
  const setter = kept.source.kind === 'setter' ? kept.source.setter : null;
  const people = peopleOf(log, accounts, setter === null ? ids : [...ids, setter]);
  return {
    gameId: log.gameId,
    settings: kept.settings,
    words: kept.words,
    source: { kind: kept.source.kind, field: kept.source.field },
    players: kept.players.map((player) => ({
      number: player.number,
      fate: facts.outs[player.id]?.fate ?? 'alive',
      out: facts.outs[player.id]?.round ?? null,
      role: player.role,
      playerId: player.id,
      agent: log.agents?.[player.id] !== undefined,
    })),
    lines,
    ballots,
    reports,
    guesses: facts.guesses.map((guess) => ({ number: of(guess.by), word: guess.word, correct: guess.correct })),
    result: facts.result,
    points: scores.map((score) => ({ number: of(score.key), points: score.points })),
    people,
    me: ids.find((id) => viewer.has(id)) ?? null,
    setter,
  };
}
