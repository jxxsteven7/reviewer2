import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// The rule of docs/design.md for avatars: one that a tap opens something with wears the hard shadow
// of what can be pressed, and one that opens nothing wears none, so that the shadow alone says
// which can be tapped. The styles are scoped, which the tests' page doesn't apply, so this reads
// them where they are written: the declarations of a rule, by its selector, in a component's styles.
function rule(file: string, selector: string): string {
  const source = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
  const styles = source.slice(source.indexOf('<style'));
  const at = styles.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`no rule for ${selector} in ${file}`);
  return styles.slice(at, styles.indexOf('}', at));
}

const SHADOW = 'box-shadow: var(--shadow-1)';

describe('the shadow of an avatar', () => {
  test('is on every avatar that a tap opens something with', () => {
    expect(rule('core/components/AvatarButton.vue', '.avatar-button > :deep(.avatar)')).toContain(SHADOW);
    // The stack of invited friends opens the sheet to invite them, a contributor their page, the
    // masthead's avatar the account, and Reviewer 1's the practice room.
    expect(rule('core/components/InvitedFriends.vue', '.face :deep(.avatar)')).toContain(SHADOW);
    expect(rule('core/components/ContributionsList.vue', '.person :deep(.avatar)')).toContain(SHADOW);
    expect(rule('core/components/AccountEntry.vue', '.avatar-link :deep(.avatar)')).toContain(SHADOW);
    expect(rule('core/views/PracticeRoom.vue', '.entry :deep(.avatar)')).toContain(SHADOW);
  });

  test('goes with the press, and from an avatar whose button can not be pressed', () => {
    // The press of every sticker takes the shadow (base.css), from an avatar that moves in its
    // button as from a button.
    const base = readFileSync(join(import.meta.dirname, '..', 'styles', 'base.css'), 'utf8');
    const pressed = base.slice(base.indexOf('.press:not(:disabled):active,'));
    expect(pressed.slice(0, pressed.indexOf('}'))).toContain('.press-host:not(:disabled):active .press-part');
    expect(pressed.slice(0, pressed.indexOf('}'))).toContain('box-shadow: none');
    for (const file of [
      'core/components/AvatarButton.vue',
      'core/components/InvitedFriends.vue',
      'core/components/AccountEntry.vue',
      'core/components/ContributionsList.vue',
    ]) {
      const source = readFileSync(join(import.meta.dirname, '..', file), 'utf8');
      expect(source, file).toMatch(/class="[^"]*\bpress-host\b/);
      expect(source, file).toMatch(/class="press-part"/);
    }
    // Reviewer 1's avatar is in a sticker that moves as a whole, and loses its shadow with it.
    expect(rule('core/views/PracticeRoom.vue', '.entry:active:not(:disabled) :deep(.avatar)')).toContain(
      'box-shadow: none',
    );
    expect(rule('core/views/PracticeRoom.vue', '.entry:disabled :deep(.avatar)')).toContain('box-shadow: none');
  });

  test("is on none of the avatars on a card's corner, a tap on which chooses the card", () => {
    expect(rule('games/keywords/KeywordsCard.vue', '.choosers :deep(.avatar)')).not.toContain('box-shadow');
  });
});
