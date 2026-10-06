/// <reference types="vite/client" />
/// <reference types="@intlify/unplugin-vue-i18n/messages" />

// The build's version, from APP_VERSION when the build sets it; see docs/development.md.
declare const __APP_VERSION__: string;

// hyphen ships without types; this is the part of it that the cards use.
declare module 'hyphen/en-us' {
  const english: {
    hyphenateSync(text: string, options?: { hyphenChar?: string; minWordLength?: number }): string;
  };
  export default english;
}
