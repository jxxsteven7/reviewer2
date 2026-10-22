// @vitest-environment happy-dom
import type { GameCounts, MatchView, RoomView, StandingView } from '@reviewer2/shared';
import {
  defaultSettings,
  type BallotView,
  type ImpostorReplay,
  type ImpostorRoomData,
  type ImpostorScoreDetail,
  type ImpostorView,
  type ReportView,
  type SeatView,
} from '@reviewer2/shared/impostor';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { createMemoryHistory, createRouter } from 'vue-router';
import { toasts } from '../../core/toast';
import en from '../../locales/en.json';
import AgentGuess from './AgentGuess.vue';
import ImpostorGame from './ImpostorGame.vue';
import ImpostorLobby from './ImpostorLobby.vue';
import JudgeSheet from './JudgeSheet.vue';
import OffField from './OffField.vue';
import ReplayViewer from './ReplayViewer.vue';
import RevealList from './RevealList.vue';
import RoundLog from './RoundLog.vue';
import SeatPanel from './SeatPanel.vue';
import { ballotRows, reportRows } from './rows';
import { needed, seatState, voteRows } from './seats';
import SetterForm from './SetterForm.vue';
import { recordStats } from './stats';

const send = vi.hoisted(() =>
  vi.fn<(event: string, payload?: object) => Promise<{ ok: boolean }>>(async () => ({ ok: true })),
);
vi.mock('../../core/socket', async () => {
  const { computed, reactive } = await import('vue');
  const connection = reactive({ connected: true, everConnected: true, connects: 1, refusal: null });
  return {
    send,
    act: (event: string, payload: object = {}) => send(event, payload),
    onceConnected: (run: () => void) => {
      run();
      return () => {};
    },
    socket: { connected: true, on: vi.fn(), once: vi.fn() },
    connection,
    reconnecting: computed(() => false),
  };
});
vi.mock('../../core/fields', async () => {
  const { shallowRef } = await import('vue');
  const fields = shallowRef([
    { id: 'general', name: { zh: 'G', en: 'General' }, counts: { zh: 30, en: 30 }, pairs: 9 },
  ]);
  return { fields, loadFields: vi.fn() };
});

const i18n = () => createI18n({ legacy: false, locale: 'en', messages: { en } });
const router = () =>
  createRouter({ history: createMemoryHistory(), routes: [{ path: '/:any(.*)*', component: { render: () => null } }] });
// The sheets are teleported to the page's body; rendering them in place keeps them inside the
// wrapper.
const global = () => ({ plugins: [i18n(), router()], stubs: { teleport: true } });

const seat = (number: number, overrides: Partial<SeatView> = {}): SeatView => ({
  number,
  fate: 'alive',
  out: null,
  role: null,
  playerId: null,
  agent: null,
  ...overrides,
});

// A game of six in its second round: #3 was voted out in the first, a student; the viewer is #4,
// a student with the term "preprint".
function view(overrides: Partial<ImpostorView> = {}): ImpostorView {
  return {
    gameId: 'g1',
    round: 2,
    phase: 'describe',
    players: 6,
    you: { number: 4, role: null, word: { word: 'preprint' } },
    setterWords: null,
    known: [{ word: 'preprint' }],
    setter: null,
    seats: [1, 2, 3, 4, 5, 6].map((number) =>
      seat(number, {
        ...(number === 3 ? { fate: 'voted_out', out: 1, role: 'student' } : {}),
        ...(number === 4 ? { playerId: 'ann' } : {}),
      }),
    ),
    speaker: 4,
    clock: { left: 40, total: 60 },
    lines: [
      { round: 1, number: 1, text: 'not reviewed yet', tie: false },
      { round: 1, number: 3, text: 'anyone can read it', tie: false },
      { round: 2, number: 1, text: 'a kind of publishing', tie: false },
      { round: 2, number: 2, text: null, tie: false },
    ],
    ballots: [{ round: 1, ballot: 'vote', votes: { 1: 3, 2: 3, 4: 5, 5: 3, 6: 0, 3: -1 }, out: 3, tied: [] }],
    voted: [],
    myVote: undefined,
    candidates: [],
    tied: [],
    report: null,
    reports: [],
    reported: false,
    comeback: null,
    guesses: [],
    result: null,
    words: null,
    revealed: false,
    guess: null,
    points: null,
    offField: null,
    mayTalk: false,
    ...overrides,
  };
}

function room(game: ImpostorView | null, me = 'ann', data: Partial<ImpostorRoomData> = {}): RoomView {
  const roomData: ImpostorRoomData = {
    settings: defaultSettings('en'),
    seats: ['ann', 'bob', 'cat', 'dan'],
    startProblems: [],
    setterWords: null,
    mayEmote: false,
    game,
    ...data,
  };
  return {
    roomId: 'r1',
    code: 'K7QX',
    rev: 1,
    game: 'impostor',
    language: 'en',
    fields: ['general'],
    randomFields: false,
    public: false,
    rating: null,
    phase: game ? 'playing' : 'lobby',
    round: 1,
    gameId: game?.gameId ?? null,
    chairId: 'ann',
    players: ['ann', 'bob', 'cat', 'dan', 'eve'].map((id) => ({
      id,
      name: id[0]?.toUpperCase() + id.slice(1),
      online: true,
    })),
    agents: false,
    agentsOnline: false,
    screens: 0,
    me,
    match: null,
    streaks: [],
    duos: [],
    agentsPlayed: false,
    points: [],
    data: roomData,
  };
}

beforeEach(() => {
  send.mockClear();
  toasts.splice(0);
});

describe('the seats and the votes', () => {
  const ballot: BallotView = {
    round: 1,
    ballot: 'vote',
    votes: { 1: 5, 2: 3, 4: 5, 5: 3, 6: 3, 3: 0, 7: -1 },
    out: 3,
    tied: [],
  };

  test('rank the numbers voted for by their votes, then the abstentions and the votes out of time', () => {
    expect(voteRows(ballot)).toEqual({
      rows: [
        { number: 3, voters: [2, 5, 6] },
        { number: 5, voters: [1, 4] },
      ],
      abstained: [3],
      timedOut: [7],
    });
    // The record has a row of abstentions whether or not anyone abstained, and one of votes out
    // of time only when someone's ran out.
    const t = (key: string) => key;
    expect(ballotRows(t, ballot).map((row) => [row.key, row.voters])).toEqual([
      ['n3', [2, 5, 6]],
      ['n5', [1, 4]],
      ['abstain', [3]],
      ['timeout', [7]],
    ]);
    const everyone = { ...ballot, votes: { 1: 5, 2: 3, 3: 5, 4: 5, 5: 3, 6: 3, 7: 3 } };
    expect(ballotRows(t, everyone).map((row) => [row.key, row.voters])).toEqual([
      ['n3', [2, 5, 6, 7]],
      ['n5', [1, 3, 4]],
      ['abstain', []],
    ]);
  });

  test('say how each seat stands in each phase', () => {
    const game = view();
    expect(game.seats.map((one) => seatState(game, one))).toEqual([
      'said',
      'said',
      'voted_out',
      'writing',
      'waiting',
      'waiting',
    ]);
    const voting = view({ phase: 'vote', voted: [1, 5] });
    expect(voting.seats.map((one) => seatState(voting, one))).toEqual([
      'voted',
      'voting',
      'voted_out',
      'voting',
      'voted',
      'voting',
    ]);
    const over = view({ phase: 'over', speaker: null, result: { winner: 'student', reason: 'caught' } });
    expect(over.seats.map((one) => seatState(over, one))).toEqual([
      'lasted',
      'lasted',
      'voted_out',
      'lasted',
      'lasted',
      'lasted',
    ]);
  });

  test('show the verdicts on a report, and a row of abstentions only when someone abstained', () => {
    const t = (key: string, named?: Record<string, unknown>) => `${key}${named ? JSON.stringify(named) : ''}`;
    const report: ReportView = {
      round: 1,
      by: 1,
      target: 2,
      line: null,
      reason: 'too plain',
      eligible: 3,
      judged: 3,
      mine: null,
      mayJudge: false,
      verdicts: { 1: 'agree', 3: 'agree', 4: 'disagree' },
      passed: true,
    };
    expect(reportRows(t, report).map((row) => [row.key, row.voters, row.mark ?? null])).toEqual([
      ['agree', [1, 3], 'games.impostor.report.passedMark'],
      ['disagree', [4], null],
    ]);
    const abstained = reportRows(t, { ...report, verdicts: { ...report.verdicts, 5: 'abstain' } });
    expect(abstained.at(-1)?.voters).toEqual([5]);
  });

  test('need more than half of those who may judge a report to agree', () => {
    expect([1, 2, 4, 5, 6].map(needed)).toEqual([1, 2, 3, 3, 4]);
  });
});

describe('ImpostorGame', () => {
  test('lets the viewer write their line in their turn, refusing one that gives the term away', async () => {
    const wrapper = mount(ImpostorGame, { props: { room: room(view()) }, global: global() });
    expect(wrapper.text()).toContain('Your turn to describe!');
    expect(wrapper.text()).toContain('preprint');
    const input = wrapper.get<HTMLInputElement>('.line-box input');
    const button = wrapper.get('.line-box button[type="submit"]');
    expect(button.attributes('disabled')).toBeDefined();
    await input.setValue('you put a preprint online');
    expect(wrapper.text()).toContain('It gives your term away');
    expect(button.attributes('disabled')).toBeDefined();
    await input.setValue('posted before the review');
    expect(button.attributes('disabled')).toBeUndefined();
    await wrapper.get('.line-box').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('impostor:describe', {
      gameId: 'g1',
      round: 2,
      text: 'posted before the review',
    });
  });

  test('shows a card for each seat with its line this round, and a player out how they went', () => {
    const wrapper = mount(ImpostorGame, { props: { room: room(view({ speaker: 5 })) }, global: global() });
    const cards = wrapper.findAll('.board .seat-card');
    expect(cards).toHaveLength(6);
    expect(cards[0]?.text()).toContain('a kind of publishing');
    expect(cards[1]?.text()).toContain('Ran out of time');
    expect(cards[2]?.classes()).toContain('grey');
    expect(cards[2]?.text()).toContain('Voted out in round 1');
    // The role of a seat that is out is everyone's to know; the others' are nobody's yet.
    expect(cards[2]?.text()).toContain('Student');
    expect(cards[0]?.text()).not.toContain('Student');
    expect(cards[3]?.text()).toContain('You');
    expect(wrapper.find('.line-box').exists()).toBe(false);
    expect(wrapper.text()).toContain('#5 is describing');
  });

  test('shows every role and the AI players on the cards to a viewer with the god view', () => {
    const god = view({
      you: null,
      speaker: 5,
      words: { student: 'preprint', reviewer2: 'conference paper' },
      seats: view().seats.map((one) => ({
        ...one,
        role: one.number === 5 ? 'reviewer2' : 'student',
        playerId: `p${one.number}`,
        agent: one.number === 6,
      })),
    });
    const wrapper = mount(ImpostorGame, { props: { room: room(god) }, global: global() });
    const cards = wrapper.findAll('.board .seat-card');
    expect(cards[4]?.text()).toContain('Reviewer 2');
    expect(cards[0]?.text()).toContain('Student');
    expect(cards[5]?.text()).toContain('AI');
    expect(cards[4]?.text()).not.toContain('AI');
  });

  test('makes the seats the choices of a vote, with one to abstain, and casts the choice', async () => {
    const game = view({ phase: 'vote', speaker: null, candidates: [1, 2, 4, 5, 6], voted: [1] });
    const wrapper = mount(ImpostorGame, { props: { room: room(game) }, global: global() });
    const choices = wrapper.findAll('.board input[type="radio"]');
    // Every seat but the viewer's own and the one out, and the abstention.
    expect(choices).toHaveLength(5);
    expect(wrapper.text()).toContain('1 of 5 voted');
    const vote = () => wrapper.findAll('.actions button').find((button) => button.text().startsWith('Vote for'));
    expect(wrapper.text()).toContain('Choose someone first');
    await choices[2]!.setValue(true);
    expect(vote()?.text()).toBe('Vote for #5');
    await vote()!.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith('impostor:vote', { gameId: 'g1', round: 2, number: 5 });
    // A report that passes during the vote starts it again without the player: the choice goes.
    const settled: ReportView = {
      round: 2,
      by: 1,
      target: 5,
      line: null,
      reason: 'said the term',
      eligible: 4,
      judged: 4,
      mine: null,
      mayJudge: false,
      verdicts: { 1: 'agree', 2: 'agree', 4: 'agree', 6: 'disagree' },
      passed: true,
    };
    const restarted = view({
      ...game,
      candidates: [1, 2, 4, 6],
      voted: [],
      reports: [settled],
      seats: game.seats.map((one) => (one.number === 5 ? { ...one, fate: 'violation', out: 2, role: 'student' } : one)),
    });
    await wrapper.setProps({ room: room(restarted) });
    expect(wrapper.text()).toContain('Choose someone first');
    await wrapper.findAll('.board input[type="radio"]')[1]!.setValue(true);
    expect(vote()?.text()).toBe('Vote for #2');
    // A report that fails changes nothing of the vote, and one that passes against someone else
    // starts it again without them: the choice of #2 stands both times.
    const failed: ReportView = {
      ...settled,
      target: 6,
      verdicts: { 1: 'disagree', 2: 'disagree', 4: 'agree' },
      passed: false,
    };
    await wrapper.setProps({ room: room(view({ ...restarted, reports: [settled, failed] })) });
    expect(vote()?.text()).toBe('Vote for #2');
    const another = view({
      ...restarted,
      candidates: [1, 2, 4],
      reports: [settled, failed, { ...settled, target: 6 }],
      seats: restarted.seats.map((one) => (one.number === 6 ? { ...one, fate: 'violation', out: 2, role: 'pi' } : one)),
    });
    await wrapper.setProps({ room: room(another) });
    expect(vote()?.text()).toBe('Vote for #2');
    await wrapper.get('.abstain-card input').setValue(true);
    const abstain = wrapper.findAll('.actions button').find((button) => button.text() === 'Abstain');
    await abstain!.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenLastCalledWith('impostor:vote', { gameId: 'g1', round: 2, number: null });
  });

  test('says how the viewer voted, and shows the sidelines only to those who may read them', async () => {
    const game = view({ phase: 'vote', speaker: null, candidates: [1, 2, 4, 5, 6], myVote: 5 });
    const wrapper = mount(ImpostorGame, { props: { room: room(game) }, global: global() });
    expect(wrapper.text()).toContain('You voted for #5');
    expect(wrapper.find('.board input[type="radio"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('Sidelines');
    const out = view({
      you: { number: 3, role: 'student', word: { word: 'preprint' } },
      offField: [{ id: 1, number: 3, playerId: 'ann', text: 'it was not me', after: false }],
      mayTalk: true,
    });
    const sidelined = mount(ImpostorGame, { props: { room: room(out) }, global: global() });
    expect(sidelined.text()).toContain('You are #3 \u00b7 out \u00b7 Student');
    expect(sidelined.text()).toContain('Sidelines');
  });

  test('announces each vote as it is revealed', async () => {
    const wrapper = mount(ImpostorGame, { props: { room: room(view()) }, global: global() });
    const next = view({
      round: 3,
      ballots: [
        ...view().ballots,
        { round: 2, ballot: 'vote', votes: { 1: 5, 2: 5, 4: 5, 5: 1, 6: 5 }, out: 5, tied: [] },
      ],
      seats: view().seats.map((one) =>
        one.number === 5 ? { ...one, fate: 'voted_out', out: 2, role: 'student' } : one,
      ),
    });
    await wrapper.setProps({ room: room(next) });
    expect(toasts.map((shown) => [shown.key, shown.params])).toEqual([
      ['games.impostor.toasts.out', { number: 5, role: 'Student' }],
    ]);
  });
});

describe('OffField', () => {
  test('names the writer of a line wherever the view says who they are, with how they stand', () => {
    // A game that isn't anonymous names the players while it is on; an anonymous one gives only
    // their numbers until the reveal.
    const game = view({
      you: { number: 3, role: 'student', word: { word: 'preprint' } },
      offField: [
        { id: 1, number: 1, playerId: 'bob', text: 'it was not me', after: false },
        { id: 2, number: 2, playerId: null, text: 'nor me', after: false },
        { id: 3, number: null, playerId: 'eve', text: 'good game', after: false },
      ],
      mayTalk: true,
    });
    const wrapper = mount(OffField, {
      props: { room: room(game), game, setterId: 'eve', sending: false, open: () => {}, draft: '' },
      global: global(),
    });
    const names = wrapper.findAll('.message .name').map((name) => name.text());
    expect(names).toEqual(['#1 Bob', '#2', 'Eve \u00b7 setter']);
  });

  test('holds a line against the words the view says the viewer knows, with their forms', async () => {
    // A viewer who knows both words, as the setter or with the god view: a translation of one is
    // refused as the server would refuse it, and a line that names neither may go.
    const game = view({
      you: null,
      known: [
        { word: '\u5b9e\u9a8c', translations: ['Experiment'] },
        { word: '\u4eff\u771f', forms: ['simulate'] },
      ],
      mayTalk: true,
    });
    const wrapper = mount(OffField, {
      props: { room: room(game, 'zed'), game, setterId: null, sending: false, open: () => {}, draft: '' },
      global: global(),
    });
    const send = () => wrapper.get('button[type="submit"]');
    for (const line of ['is it Experiment?', 'they simulate it']) {
      await wrapper.setProps({ draft: line });
      expect(send().attributes('disabled'), line).toBeDefined();
      expect(wrapper.text()).toContain("You can't write a term you know.");
    }
    await wrapper.setProps({ draft: 'is it the lab?' });
    expect(send().attributes('disabled')).toBeUndefined();
  });
});

describe('RoundLog', () => {
  test('folds each round, with its lines and its votes, the newest voted round open', () => {
    const wrapper = mount(RoundLog, { props: { game: view() }, global: global() });
    const folds = wrapper.findAll('.fold-card');
    expect(folds.map((fold) => fold.get('.toggle').text())).toEqual([
      'Round 1#3 out \u00b7 Student',
      'Round 2Describing',
    ]);
    expect(folds[0]?.get('.toggle').attributes('aria-expanded')).toBe('true');
    const rows = folds[0]!.findAll('.vote-rows li').map((row) => row.text().replace(/\s+/g, ' ').trim());
    expect(rows[0]).toContain('3 votes');
    expect(rows[0]).toContain('Out');
    expect(rows.some((row) => row.startsWith('Abstained'))).toBe(true);
    expect(rows.some((row) => row.startsWith('No vote \u00b7 out of time'))).toBe(true);
  });
});

describe('SeatPanel', () => {
  test("lists a number's lines and reports it with one of them and a reason", async () => {
    const wrapper = mount(SeatPanel, {
      props: { game: view({ speaker: 5 }), number: 1, isChair: false },
      global: global(),
    });
    expect(wrapper.text()).toContain('not reviewed yet');
    expect(wrapper.text()).toContain('a kind of publishing');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Report')!
      .trigger('click');
    await wrapper.findAll<HTMLInputElement>('input[type="radio"]')[1]!.setValue(true);
    const reason = wrapper.get<HTMLInputElement>('input[type="text"], textarea');
    await reason.setValue('says preprint outright');
    expect(wrapper.text()).toContain('It gives your term away');
    await reason.setValue('names the term outright');
    expect(wrapper.get('form.report button[type="submit"]').text()).toBe('Report #1');
    await wrapper.get('form.report').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('impostor:report', {
      gameId: 'g1',
      round: 2,
      number: 1,
      line: 2,
      reason: 'names the term outright',
    });
  });

  test('offers the chair the way to remove whoever sits at a number, after a warning', async () => {
    const wrapper = mount(SeatPanel, { props: { game: view(), number: 2, isChair: true }, global: global() });
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Remove from the room')!
      .trigger('click');
    expect(wrapper.text()).toContain('Remove #2 from the room?');
    const remove = wrapper.findAll('button').filter((button) => button.text() === 'Remove from the room');
    await remove.at(-1)!.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:remove', { seat: { gameId: 'g1', number: 2 } });
    // Once the game is over, a withdrawn one included, there is no game to remove a player from.
    const over = mount(SeatPanel, {
      props: { game: view({ phase: 'over', result: null }), number: 2, isChair: true },
      global: global(),
    });
    expect(over.findAll('button').some((button) => button.text() === 'Remove from the room')).toBe(false);
  });
});

describe('JudgeSheet', () => {
  const report: ReportView = {
    round: 2,
    by: 1,
    target: 5,
    line: 0,
    reason: 'named the term',
    eligible: 4,
    judged: 1,
    mine: null,
    mayJudge: true,
    verdicts: null,
    passed: null,
  };

  test('asks whoever may judge an open report, and sends the verdict', async () => {
    const wrapper = mount(JudgeSheet, { props: { game: view({ report }) }, global: global() });
    expect(wrapper.text()).toContain('#1 reported #5');
    expect(wrapper.text()).toContain('named the term');
    expect(wrapper.text()).toContain('1 of 4 judged');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Agree')!
      .trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('impostor:judge', { gameId: 'g1', verdict: 'agree' });
  });
});

describe('AgentGuess', () => {
  test('lets a player choose as many numbers as there were AI players, and owns up to the reward', async () => {
    const game = view({
      phase: 'over',
      result: { winner: 'student', reason: 'caught' },
      guess: { agents: 1, guess: undefined },
      seats: view().seats.map((one) => ({ ...one, role: one.number === 5 ? 'reviewer2' : 'student' })),
    });
    const wrapper = mount(AgentGuess, { props: { game, open: () => {} }, global: global() });
    expect(wrapper.text()).toContain('Guess right for a reward!');
    const boxes = wrapper.findAll<HTMLInputElement>('input[type="checkbox"]');
    expect(boxes).toHaveLength(5);
    await boxes[0]!.setValue(true);
    await boxes[4]!.setValue(true);
    const submit = wrapper.findAll('button').find((button) => button.text().startsWith("It's"));
    expect(submit?.text()).toBe("It's #6");
    await submit!.trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:guessAgents', { gameId: 'g1', guess: [6] });
    const known = {
      ...game,
      seats: game.seats.map((one) => ({ ...one, agent: one.number === 6 })),
      guess: { agents: 1, guess: [6] },
    };
    await wrapper.setProps({ game: known });
    expect(toasts.map((shown) => shown.key)).toEqual(['games.impostor.guess.right']);
  });
});

describe('RevealList', () => {
  test('names everyone once the game is over, marks the AI and shows their points', () => {
    const game = view({
      phase: 'over',
      revealed: true,
      words: { student: 'preprint', reviewer2: 'conference paper' },
      points: [
        { number: 4, points: 4 },
        { number: 5, points: -1 },
      ],
      seats: view().seats.map((one) => ({
        ...one,
        role: one.number === 5 ? 'reviewer2' : 'student',
        playerId: `p${one.number}`,
        agent: one.number === 6,
      })),
    });
    const wrapper = mount(RevealList, {
      props: { game, nameOf: (one: SeatView) => `Player ${one.number}` },
      global: global(),
    });
    const rows = wrapper.findAll('li').map((row) => row.text());
    expect(rows[3]).toContain('You');
    expect(rows[4]).toContain('Player 5');
    expect(rows[4]).toContain('Reviewer 2');
    expect(rows[5]).toContain('AI');
    expect(wrapper.findAll('li.own')).toHaveLength(1);
    expect(wrapper.find('.points.bad').text()).toBe('\u22121');
  });
});

describe('ImpostorLobby', () => {
  test('lists the players with the seats left, seats whoever comes to play and starts the game', async () => {
    const wrapper = mount(ImpostorLobby, { props: { room: room(null, 'ann') }, global: global() });
    expect(wrapper.text()).toContain('4 / 12 \u00b7 4 can start');
    expect(wrapper.text()).toContain('8 seats left');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Start')!
      .trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:start', { round: 1 });
    const eve = mount(ImpostorLobby, { props: { room: room(null, 'eve') }, global: global() });
    await eve
      .findAll('button')
      .find((button) => button.text() === 'Play')!
      .trigger('click');
    expect(send).toHaveBeenCalledWith('impostor:seat', { play: true });
  });

  test('invites Reviewer 1 to a seat left, and while it is offline holds the invitation back', async () => {
    const invitation = (online: boolean) => {
      const wrapper = mount(ImpostorLobby, {
        props: { room: { ...room(null, 'ann'), agents: true, agentsOnline: online } },
        global: global(),
      });
      return { wrapper, chip: wrapper.findAll('button').find((button) => button.text() === 'Invite Reviewer 1')! };
    };
    const online = invitation(true);
    expect(online.chip.classes()).toContain('press-host');
    await online.chip.trigger('click');
    expect(send).toHaveBeenCalledWith('room:addAgent', { persona: 'reviewer1', seat: null });

    send.mockClear();
    const offline = invitation(false);
    expect(offline.chip.classes()).toContain('held');
    expect(offline.chip.attributes('aria-disabled')).toBe('true');
    await offline.chip.trigger('click');
    expect(send).not.toHaveBeenCalledWith('room:addAgent', expect.anything());
    expect(toasts.map((shown) => shown.key)).toEqual(['errors.agents_offline']);
  });
});

// A match of three games, its second being played or just over, and its standings: Ann and Bob
// have played the first game, and Cat, who has left the room, too; Dan is offline.
const standing = (name: string, overrides: Partial<StandingView> = {}): StandingView => ({
  playerId: name.toLowerCase(),
  name,
  total: 0,
  delta: null,
  games: 1,
  rank: 1,
  left: false,
  ...overrides,
});
const scoreDetail = (overrides: Partial<ImpostorScoreDetail> = {}): ImpostorScoreDetail => ({
  out: null,
  rounds: 3,
  votes: 2,
  hits: 0,
  wrong: 0,
  abstained: 0,
  missedVotes: 0,
  missedLines: 0,
  reported: 0,
  reports: 0,
  failedReports: 0,
  comeback: null,
  role: 'student',
  won: false,
  fate: 'alive',
  ...overrides,
});
function inMatch(base: RoomView, overrides: Partial<MatchView> = {}): RoomView {
  return {
    ...base,
    players: base.players.map((player) => (player.id === 'dan' ? { ...player, online: false } : player)),
    match: {
      id: 'm1',
      rules: { games: 3 },
      played: 1,
      status: 'on',
      game: 2,
      standings: [
        standing('Ann', { total: 5, rank: 1 }),
        standing('Bob', { total: 3, rank: 2 }),
        standing('Dan', { total: -1, rank: 3 }),
        standing('Cat', { total: 4, rank: null, left: true, playerId: null }),
      ],
      ...overrides,
    },
  };
}

describe('the second game in a match', () => {
  test("opens the match's table from the bar, without the points of the game, and says nobody's presence in an anonymous game", async () => {
    const playing = inMatch(room(view(), 'bob'));
    const wrapper = mount(ImpostorGame, { props: { room: playing }, global: global() });
    const button = wrapper.findAll('.buttons button').find((one) => one.text() === 'Match');
    await button!.trigger('click');
    const table = wrapper.get('.match-table');
    expect(table.text()).toContain('Game 2 of 3');
    expect(table.findAll('thead th')).toHaveLength(3);
    // Cat, who has left, and Dan, who is offline, look like everyone else, and Cat is ranked by her
    // total.
    const rows = table.findAll('tbody tr').map((row) => row.findAll('td').map((cell) => cell.text()));
    expect(rows).toEqual([
      ['1', 'Ann', '5'],
      ['2', 'Cat', '4'],
      ['3', 'Bobyou', '3'],
      ['4', 'Dan', '\u22121'],
    ]);
    expect(table.find('.veiled').exists()).toBe(false);
    expect(table.text()).toContain('Scores in a match, as in any game');
    // Where the numbers aren't anonymous, the table says who is offline or gone.
    const open = inMatch(room(view(), 'bob', { settings: { ...defaultSettings('en'), anonymous: false } }));
    const named = mount(ImpostorGame, { props: { room: open }, global: global() });
    await named
      .findAll('.buttons button')
      .find((one) => one.text() === 'Match')!
      .trigger('click');
    expect(
      named
        .get('.match-table')
        .findAll('tbody tr .rank')
        .map((cell) => cell.text()),
    ).toEqual(['1', '2', '3', '\u2013']);
    expect(named.get('.match-table').text()).toContain('left');
    expect(named.get('.match-table').find('.veiled').exists()).toBe(true);
  });

  test('lets the chair end the match beside the game, saying nothing of titles', async () => {
    const player = mount(ImpostorGame, { props: { room: inMatch(room(view(), 'bob')) }, global: global() });
    expect(player.text()).not.toContain('End the match');
    const chair = mount(ImpostorGame, { props: { room: inMatch(room(view())) }, global: global() });
    const end = chair.findAll('.foot button').find((one) => one.text() === 'End the match');
    await end!.trigger('click');
    expect(chair.text()).toContain('The match ends now, with the scores as they stand.');
    expect(chair.text()).not.toContain('title');
    await chair
      .findAll('button')
      .find((one) => one.classes().includes('danger') && one.text() === 'End the match')!
      .trigger('click');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('room:matchEnd', { matchId: 'm1' });
  });

  test("says under the result where each player's points came from, with their role", () => {
    const over = view({ phase: 'over', speaker: null, clock: null, result: { winner: 'student', reason: 'caught' } });
    const scored = inMatch(
      { ...room(over, 'bob'), phase: 'ended' },
      {
        standings: [
          standing('Ann', {
            total: 10,
            delta: 5,
            rank: 1,
            detail: scoreDetail({ won: true, hits: 2 }),
          }),
          standing('Bob', {
            total: 0,
            delta: -3,
            rank: 2,
            detail: scoreDetail({ role: 'reviewer2', fate: 'voted_out', out: 1, missedLines: 1 }),
          }),
        ],
        played: 2,
        game: 2,
      },
    );
    const wrapper = mount(ImpostorGame, { props: { room: scored }, global: global() });
    const table = wrapper.get('.match-table');
    expect(table.findAll('thead th').at(3)?.text()).toBe('This');
    expect(table.findAll('.detail.below').map((detail) => detail.text())).toEqual([
      'Student \u00b7 won \u00b7 lasted \u00b7 2 hits',
      'Reviewer 2 \u00b7 out in round 1 \u00b7 line out of time \u00d71',
    ]);
    expect(table.find('.note').exists()).toBe(false);
    // The chair goes on to the next game from the letter; the others wait for them.
    expect(wrapper.text()).toContain('Waiting for the chair');
  });

  test("says why a game that has just ended doesn't count, which the match plays again", () => {
    const cases = [
      [null, 'Game 2 was withdrawn'],
      [{ winner: null, reason: 'reviewer2_left' }, 'since Reviewer 2 left it'],
      [{ winner: 'student', reason: 'caught' }, 'since the chair removed a player'],
    ] as const;
    for (const [result, note] of cases) {
      const over = view({ phase: 'over', speaker: null, clock: null, result });
      const wrapper = mount(ImpostorGame, {
        props: { room: inMatch({ ...room(over, 'bob'), phase: 'ended' }) },
        global: global(),
      });
      expect(wrapper.get('.match-table .note').text()).toContain(note);
    }
  });

  test('ends with the final ranking, which awards no titles in the beta', () => {
    const over = view({ phase: 'over', speaker: null, clock: null, result: { winner: 'student', reason: 'caught' } });
    const stopped = inMatch({ ...room(over, 'bob'), phase: 'ended' }, { status: 'stopped' });
    const wrapper = mount(ImpostorGame, { props: { room: stopped }, global: global() });
    expect(wrapper.find('.match-table').exists()).toBe(false);
    expect(wrapper.get('.match-results').text()).toContain('The match was ended early');
    expect(wrapper.get('.match-results').text()).not.toContain('title');
  });
});

describe('ImpostorLobby in a match', () => {
  test('puts the table first, and leaves Reviewer 1 out of the footnote on numbers', () => {
    const wrapper = mount(ImpostorLobby, { props: { room: inMatch(room(null, 'bob')) }, global: global() });
    const sections = wrapper.findAll('section').map((section) => section.classes());
    expect(sections[1]).toContain('match-table');
    expect(wrapper.text()).toContain('every avatar turns into a number, and who had which number shows at the end');
    expect(wrapper.text()).not.toContain("Reviewer 1's too");
  });

  test('keeps the settings as they are once a game has counted, and shows the chair the rules', async () => {
    const chair = mount(ImpostorLobby, { props: { room: inMatch(room(null)) }, global: global() });
    await flushPromises();
    expect(chair.find('.settings-form').exists()).toBe(false);
    expect(chair.get('.desk').text()).toContain('stay as they are until the match is over');
    expect(chair.find('.rules').exists()).toBe(true);
    const first = mount(ImpostorLobby, {
      props: { room: inMatch(room(null), { played: 0, game: 1 }) },
      global: global(),
    });
    await flushPromises();
    expect(first.find('.settings-form').exists()).toBe(true);
    expect(first.find('.rules').exists()).toBe(false);
  });

  // The server refuses to start a game of a match that is over (match_over): the chair is offered
  // another match or an ordinary room instead.
  test('offers no start once the match is over, also when it was ended early', async () => {
    for (const status of ['over', 'stopped'] as const) {
      const chair = mount(ImpostorLobby, { props: { room: inMatch(room(null), { status }) }, global: global() });
      await flushPromises();
      expect(chair.findAll('button').some((button) => button.text() === 'Start')).toBe(false);
      expect(chair.find('.desk').exists()).toBe(false);
      expect(chair.get('.match-results').text()).toContain('Another match');
      const player = mount(ImpostorLobby, {
        props: { room: inMatch(room(null, 'bob'), { status }) },
        global: global(),
      });
      expect(player.find('.waiting').exists()).toBe(false);
    }
  });
});

describe('the records of the second game', () => {
  test('count the matches finished, and those finished first', () => {
    const counts: GameCounts = {
      ordinary: { games: 4, wins: 2 },
      inMatches: { games: 6, wins: 3 },
      roles: {},
      matches: { played: 2, won: 1 },
    };
    const t = i18n().global.t as Parameters<typeof recordStats>[0];
    const blocks = recordStats(t, counts, 'en').map(({ label, value }) => [label, value]);
    expect(blocks.slice(0, 2)).toEqual([
      ['Games', '10'],
      ['Win rate', '50%'],
    ]);
    expect(blocks.slice(-2)).toEqual([
      ['Matches', '2'],
      ['Won', '1'],
    ]);
  });
});

describe('SetterForm', () => {
  test('checks the two terms as the server does and sends them with the field and the credit', async () => {
    const wrapper = mount(SetterForm, { props: { words: null, language: 'en' }, global: global() });
    const [a, b] = wrapper.findAll<HTMLInputElement>('input[type="text"]');
    await a!.setValue('preprint');
    await b!.setValue('preprints');
    expect(wrapper.text()).toContain('The two terms must differ');
    expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeDefined();
    await b!.setValue('conference paper');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(send).toHaveBeenCalledWith('impostor:words', {
      a: 'preprint',
      b: 'conference paper',
      field: 'general',
      named: true,
    });
  });
});

describe('ReplayViewer', () => {
  test('goes through the game round by round, and ends with who was who', async () => {
    const players = [1, 2, 3, 4].map((number) => ({
      ...seat(number),
      role: number === 2 ? ('reviewer2' as const) : ('student' as const),
      playerId: `p${number}`,
      agent: false,
      ...(number === 2 ? { fate: 'voted_out' as const, out: 1 } : {}),
    }));
    const replay: ImpostorReplay = {
      gameId: 'g9',
      settings: defaultSettings('en'),
      words: { student: 'preprint', reviewer2: 'conference paper' },
      source: { kind: 'library', field: 'general' },
      players,
      lines: [
        { round: 1, number: 1, text: 'not reviewed yet', tie: false },
        { round: 1, number: 2, text: 'presented in a hall', tie: false },
      ],
      ballots: [{ round: 1, ballot: 'vote', votes: { 1: 2, 3: 2, 4: 2, 2: 1 }, out: 2, tied: [] }],
      reports: [],
      guesses: [],
      result: { winner: 'student', reason: 'caught' },
      points: [{ number: 1, points: 5 }],
      people: { p1: { name: 'Ann' }, p2: { name: 'Bob' }, p3: { name: 'Cat' }, p4: { name: 'Dan' } },
      me: 'p1',
      setter: null,
    };
    const wrapper = mount(ReplayViewer, { props: { replay }, global: global() });
    expect(wrapper.text()).toContain('Round 1');
    expect(wrapper.text()).toContain('#2 out \u00b7 Reviewer 2');
    expect(wrapper.text()).toContain('presented in a hall');
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Next')!
      .trigger('click');
    expect(wrapper.text()).toContain('Reviewer 2 caught');
    expect(wrapper.text()).toContain('Bob');
  });
});
