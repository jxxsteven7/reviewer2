// What the issue of a bug report says of the browser (admin.ts, `feedback draft`): the names and
// versions of the browser and of the system, read from the user agent that came with the report,
// and nothing else of it. Some Android browsers put the phone's model there, and the whole string
// tells a browser apart from most others; the feedback form promises players that neither goes to
// GitHub, so only what the patterns below pick out ever does. A user agent that none of them
// matches gives nothing, and the issue has no line on the browser.

// The browsers, the first that matches: the ones that pretend to be others before the ones they
// pretend to be. WeChat's built-in browser, Edge, Firefox and Samsung's say they are Chrome, and so
// do the browsers common on phones in China, Huawei's, QQ's, Quark, UC, Xiaomi's and Baidu's. An
// app's web view on Android says "Version/4.0" and Chrome, and is named as a web view with the
// version of its engine, since it is no browser a player chose. Chrome says it is Safari. WeChat's
// third number tells its releases apart, Safari's second its yearly versions, and the others move
// by their first.
const BROWSERS: readonly [RegExp, string][] = [
  [/\bMicroMessenger\/(\d+(?:\.\d+){0,2})/, 'WeChat'],
  [/\bEdg(?:e|A|iOS)?\/(\d+)/, 'Edge'],
  [/\b(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'],
  [/\bSamsungBrowser\/(\d+)/, 'Samsung Internet'],
  [/\bHuaweiBrowser\/(\d+)/, 'Huawei Browser'],
  [/\bMQQBrowser\/(\d+)/, 'QQ Browser'],
  [/\bQuark\/(\d+)/, 'Quark'],
  [/\bUCBrowser\/(\d+)/, 'UC Browser'],
  [/\bMiuiBrowser\/(\d+)/, 'Mi Browser'],
  [/\bbaiduboxapp\/(\d+)/, 'Baidu'],
  [/\bVersion\/4\.0 .*\bChrome\/(\d+)/, 'Android WebView'],
  [/\b(?:Chrome|CriOS)\/(\d+)/, 'Chrome'],
  [/\bVersion\/(\d+(?:\.\d+)?).*\bSafari\//, 'Safari'],
];

// The systems, the first that matches: HarmonyOS NEXT says OpenHarmony, earlier HarmonyOS says
// Android too, and Android says Linux. Browsers hold the version of the system still where it would
// tell a player apart: Chrome on Android says "Android 10; K" whatever the phone runs, every
// browser on a Mac says 10_15_7, and iOS from 26 on says 18_6, which iOS 18.6 says too. Those are
// written without a version, except that Safari's version on iOS is the system's, so a Safari of 26
// or later names the iOS it runs on. Browsers on Windows 11 still say Windows NT 10.0.
const WINDOWS: Record<string, string> = { '10.0': '10 or 11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
const SAFARI = /\bVersion\/(\d+(?:\.\d+)?)/;
const SYSTEMS: readonly [RegExp, (match: RegExpMatchArray, userAgent: string) => string][] = [
  [
    /\b(?:iPhone|iPad|iPod).*?\bOS (\d+)[._](\d+)/,
    ([, major, minor], userAgent) => {
      if (`${major}_${minor}` !== '18_6') return `iOS ${major}.${minor}`;
      const safari = SAFARI.exec(userAgent)?.[1];
      return safari !== undefined && Number(safari) >= 26 ? `iOS ${safari}` : 'iOS';
    },
  ],
  [/\bOpenHarmony (\d+(?:\.\d+)?)/, ([, version]) => `HarmonyOS ${version}`],
  [/\bHarmonyOS\b/, () => 'HarmonyOS'],
  [/\bAndroid 10; K\)/, () => 'Android'],
  [/\bAndroid (\d+(?:\.\d+)?)/, ([, version]) => `Android ${version}`],
  [/\bWindows NT (\d+\.\d+)/, ([, version]) => `Windows ${WINDOWS[version as string] ?? version}`],
  [/\bMac OS X\b/, () => 'macOS'],
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
      system = describe(match, userAgent);
      break;
    }
  }
  if (browser === null && system === null) return null;
  return [browser ?? 'Unknown browser', ...(system === null ? [] : [`on ${system}`])].join(' ');
}
