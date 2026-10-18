/// <reference types="vite/client" />
/// <reference types="@intlify/unplugin-vue-i18n/messages" />

// The build's version, from APP_VERSION when the build sets it; see docs/development.md.
declare const __APP_VERSION__: string;
// The commit that names that version, for the footer's link, or null; see src/core/versionCommit.ts.
declare const __APP_COMMIT__: string | null;

// hyphen ships without types or an exports map, so the build imports the file itself; this is
// the part of it that the build uses.
declare module 'hyphen/en-us/index.js' {
  const english: {
    hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
  };
  export default english;
}

// The English terms of the word library that break, each mapped to itself with soft hyphens.
// The build makes this module; see the hyphenation plugin in vite.config.ts.
declare module 'virtual:hyphenation' {
  const words: Record<string, string>;
  export default words;
}
