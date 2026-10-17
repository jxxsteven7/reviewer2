import type { KeywordsRoomData, RoomView, Team } from '@reviewer2/shared';
import { computed, onBeforeUnmount, ref, shallowRef, type Ref } from 'vue';
import type { Float, Shown } from '../../core/components/ScoreFloat.vue';
import { endFloats, endsBetween, openingRose, revealedBetween, revealFloats } from './floats';
import { useLiveViews } from './useLiveViews';

// How long a number rises on a card or an avatar, and in the middle of the screen at the end, a
// little longer than its animation (ScoreFloat.vue).
export const FLOAT_MS = 1500;
export const END_FLOAT_MS = 2600;
// How long after the card that ended the game what the end added rises on the avatars.
const AFTER_REVEAL_MS = 900;

// The numbers that rise as the game goes (floats.ts): on the card that has just been revealed, the
// viewer's own, the bonus it brings included; on the avatars of the players whose points it changed,
// each their own, which the game shows where the groups stand beside the board; and at the end of
// the game, what it added to the viewer's points, in the middle of the screen, and to each player's,
// on their avatar.
//
// Only what happens in front of the viewer rises (useLiveViews.ts): a snapshot that comes with a
// new connection, as after a reload or a locked screen, or while the page is out of sight, catches
// the page up without a word, and so does one with several cards revealed at once. A game that an
// AI has played in brings nobody points, and nothing rises.
export function useScoreFloats(room: Ref<RoomView>) {
  const card = ref<(Shown & { card: number }) | null>(null);
  const players = shallowRef(new Map<string, Shown>());
  const end = ref<Shown | null>(null);
  const timers = new Set<ReturnType<typeof setTimeout>>();
  let key = 0;
  // The groups whose opening record rose with its card in front of the viewer, in the game it rose
  // in: the end's number allows for it where the heavenly hand outdoes it (endFloats()).
  let risen: { gameId: string; teams: Set<Team> } | null = null;

  function later(ms: number, run: () => void) {
    const timer = setTimeout(() => {
      timers.delete(timer);
      run();
    }, ms);
    timers.add(timer);
  }

  // The players' numbers go one by one, each when its own time is up, so that a number that a later
  // card brought a player stays for its whole time.
  function showPlayers(floats: ReadonlyMap<string, Float>, ms: number) {
    if (floats.size === 0) return;
    const shown = new Map(players.value);
    const keys = new Map<string, number>();
    for (const [id, float] of floats) {
      key += 1;
      keys.set(id, key);
      shown.set(id, { ...float, key });
    }
    players.value = shown;
    later(ms, () => {
      const left = new Map(players.value);
      for (const [id, at] of keys) if (left.get(id)?.key === at) left.delete(id);
      players.value = left;
    });
  }

  useLiveViews(
    computed(() => (room.value.data as KeywordsRoomData).game),
    (last, view) => {
      if (room.value.agentsPlayed) return;
      const data = room.value.data as KeywordsRoomData;
      const reveal = revealedBetween(last, view);
      if (reveal) {
        if (openingRose(last, view, reveal.by)) {
          if (risen?.gameId !== view.gameId) risen = { gameId: view.gameId, teams: new Set() };
          risen.teams.add(reveal.by);
        }
        const { mine, players: others } = revealFloats(data, room.value.me, reveal, last, view);
        if (mine) {
          key += 1;
          const shown = { ...mine, key, card: reveal.card };
          card.value = shown;
          later(FLOAT_MS, () => {
            if (card.value?.key === shown.key) card.value = null;
          });
        }
        showPlayers(others, FLOAT_MS);
      }
      if (endsBetween(last, view)) {
        const outdone = risen?.gameId === view.gameId ? risen.teams : new Set<Team>();
        const { mine, players: others } = endFloats(data, room.value.me, room.value.points, outdone);
        if (mine) {
          key += 1;
          const shown = { ...mine, key };
          end.value = shown;
          later(END_FLOAT_MS, () => {
            if (end.value?.key === shown.key) end.value = null;
          });
        }
        // The card that ended the game rises on the avatars first, and what the end added follows.
        if (reveal) later(AFTER_REVEAL_MS, () => showPlayers(others, END_FLOAT_MS));
        else showPlayers(others, END_FLOAT_MS);
      }
    },
  );

  onBeforeUnmount(() => {
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  });

  return { card, players, end };
}
