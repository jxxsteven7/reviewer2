import { HAN_VARIANTS } from './han-variants';

// Traditional Chinese characters and their simplified forms, built from the table on first use.
let simplified: Map<string, string> | undefined;

// Turns traditional Chinese characters into simplified ones, one character at a time. This is
// for comparing words, not for showing them: where one traditional character stands for several
// simplified ones, it always picks the same one, which is not always the right one.
export function toSimplified(text: string): string {
  if (!simplified) {
    simplified = new Map();
    for (let i = 0; i < HAN_VARIANTS.length; i += 2) {
      simplified.set(HAN_VARIANTS.charAt(i), HAN_VARIANTS.charAt(i + 1));
    }
  }
  const forms = simplified;
  return text.replace(/[\u4e00-\u9fff]/g, (char) => forms.get(char) ?? char);
}
