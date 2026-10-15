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
    expect(rule('core/components/InvitedFriends.vue', '.invited-friends:active .face :deep(.avatar)')).toContain(
      'box-shadow: none',
    );
    expect(rule('core/components/AccountEntry.vue', '.avatar-link:active :deep(.avatar)')).toContain(
      'box-shadow: none',
    );
    expect(rule('core/components/ContributionsList.vue', '.person:active :deep(.avatar)')).toContain(
      'box-shadow: none',
    );
    expect(rule('core/views/PracticeRoom.vue', '.entry:disabled :deep(.avatar)')).toContain('box-shadow: none');
  });

  test("is on none of the avatars on a card's corner, a tap on which chooses the card", () => {
    expect(rule('games/keywords/KeywordsCard.vue', '.choosers :deep(.avatar)')).not.toContain('box-shadow');
  });
});
