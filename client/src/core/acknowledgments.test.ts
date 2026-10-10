import { parseAcknowledgments } from '@reviewer2/shared';
import { expect, test } from 'vitest';
import source from '../../../ACKNOWLEDGMENTS.md?raw';

// The check of ACKNOWLEDGMENTS.md, which the home page shows as the build bundles it: CI runs it
// with the other tests, so that a list that breaks the rules (shared/src/acknowledgments.ts)
// can't be merged.
test('ACKNOWLEDGMENTS.md keeps to the rules', () => {
  const problems = parseAcknowledgments(source).problems.map(({ line, message }) => `line ${line}: ${message}`);
  expect(problems).toEqual([]);
});
