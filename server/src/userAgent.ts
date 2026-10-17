// What the issue of a bug report says of the browser (admin.ts, `feedback draft`): the names and
// versions of the browser and of the system, read from the user agent that came with the report,
// and nothing else of it. Some Android browsers put the phone's model there, and the whole string
// tells a browser apart from most others; the feedback form promises players that neither goes to
// GitHub, so only what the patterns below pick out ever does. A user agent that none of them
// matches gives nothing, and the issue has no line on the browser.

// The browsers, the first that matches: the ones that pretend to be others, WeChat's built-in
// browser, Edge, Firefox and Samsung's, before Chrome, which they all say they are, and Chrome,
// which says it is Safari, before Safari. WeChat's third number tells its releases apart, Safari's
// second its yearly versions, and the others move by their first.
const BROWSERS: readonly [RegExp, string][] = [
  [/\bMicroMessenger\/(\d+(?:\.\d+){0,2})/, 'WeChat'],
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\b(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/\b(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+(?:\.\d+)?).*\bSafari\//, 'Safari'],
];

// The systems, the first that matches: HarmonyOS says Android too, and Android says Linux.
// Browsers on Windows 11 still say Windows NT 10.0, and Safari on any macOS says 10_15_7.
const WINDOWS: Record<string, string> = { '10.0': '10 or 11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
const SYSTEMS: readonly [RegExp, (match: RegExpMatchArray) => string][] = [
  [/\b(?:iPhone|iPad|iPod).*?\bOS (\d+)[._](\d+)/, ([, major, minor]) => `iOS ${major}.${minor}`],
  [/\bHarmonyOS\b/, () => 'HarmonyOS'],
  [/\bAndroid (\d+(?:\.\d+)?)/, ([, version]) => `Android ${version}`],
  [/\bWindows NT (\d+\.\d+)/, ([, version]) => `Windows ${WINDOWS[version as string] ?? version}`],
  [/\bMac OS X (\d+)[._](\d+)/, ([, major, minor]) => `macOS ${major}.${minor}`],
  [/\bCrOS\b/, () => 'ChromeOS'],
  [/\bLinux\b/, () => 'Linux'],
];

// The browser and the system, as "WeChat 8.0.60 on iOS 18.6", "Chrome 141 on Windows 10 or 11",
// "Unknown browser on Android 15" or "Firefox 144" alone, or null when the user agent says neither.
export function describeBrowser(userAgent: string): string | null {
  let browser: string | null = null;
  for (const [pattern, name] of BROWSERS) {
    const match = pattern.exec(userAgent);
    if (match) {
      browser = `${name} ${match[1]}`;
      break;
    }
  }
  let system: string | null = null;
  for (const [pattern, describe] of SYSTEMS) {
    const match = pattern.exec(userAgent);
    if (match) {
      system = describe(match);
      break;
    }
  }
  if (browser === null && system === null) return null;
  return [browser ?? 'Unknown browser', ...(system === null ? [] : [`on ${system}`])].join(' ');
}
