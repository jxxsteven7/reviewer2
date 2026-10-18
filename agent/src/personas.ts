import type { AgentPersona } from '@reviewer2/shared';

// The AI players that the agent plays as (docs/architecture.md#the-agent). The game server knows
// them by name only (AGENT_PERSONAS), and the interface names them in its locale files; how each
// one plays is here.
//
// A persona is plain settings that the prompts and the choices read, so that another way of
// playing is another entry here, and so that a player's twin can later be a persona that the
// server describes in its request, with what it has learned of the player.

export interface Persona {
  id: AgentPersona;
  // How freely the model may choose its words, from 0 to 2.
  temperature: number;
  // As a PI: how many of the group's cards a clue should aim at, from `min` to `max`, best
  // `preferred`. Fewer cards make a clue that the students can follow; more win faster. Measured
  // on fixed boards, aiming at up to 4 cards, 3 if it could, raised the number but not the cards
  // found, and ran into the other group's cards more often.
  targets: { min: number; preferred: number; max: number };
  // As a PI: whether the agent has each clue it would give guessed first, by the model playing a
  // student who sees no colors, and gives the clue whose guesses go best (keywords.ts). It costs a
  // question to the model for every clue that the rules take. Measured on fixed boards, it found
  // more cards and ran into fewer of the other group's when the model that gave the clue guessed
  // it, but hardly so when another model did, and took two to three times as long, so Reviewer 1
  // does without it.
  rehearse: boolean;
  // As a student: how sure it must be of a card, after the first, to reveal it, in the words the
  // model is told; a student that is less sure stops. And how the one sentence of the reason
  // sounds, which the group reads when the agent advises a human student.
  caution: string;
  tone: string;
}

export const PERSONAS: Readonly<Record<AgentPersona, Persona>> = {
  // Reviewer 1, the steady one: clues for two cards, a student who reveals only what it is sure
  // of, and never the guess that a clue allows beyond its number.
  reviewer1: {
    id: 'reviewer1',
    temperature: 0.6,
    targets: { min: 1, preferred: 2, max: 3 },
    rehearse: false,
    caution: 'fairly sure',
    tone: 'calm and brief, like a polite senior colleague',
  },
};
