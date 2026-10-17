import { describe, expect, test } from 'vitest';
import { describeBrowser } from './userAgent';

// The browser and the system of a bug report, as its issue says them: names and versions alone,
// never the model or the string itself.

describe('the browser of a bug report', () => {
  test('is named with its version and its system, as the user agent says them', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Mobile/15E148 MicroMessenger/8.0.60(0x18003c2d) NetType/WIFI Language/zh_CN',
      ),
    ).toBe('WeChat 8.0.60 on iOS 18.6');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 15; 2211133C Build/AQ3A.240912.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 XWEB/1300297 MMWEBSDK/20240301 ' +
          'MMWEBID/9999 MicroMessenger/8.0.56.2800(0x28003855) WeChat/arm64',
      ),
    ).toBe('WeChat 8.0.56 on Android 15');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Version/18.6 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18.6 on iOS 18.6');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Version/18.1 Safari/605.1.15',
      ),
    ).toBe('Safari 18.1 on macOS 10.15');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 141 on Windows 10 or 11');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0',
      ),
    ).toBe('Edge 141 on Windows 10 or 11');
    expect(describeBrowser('Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0')).toBe(
      'Firefox 144 on Linux',
    );
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'SamsungBrowser/27.0 Chrome/125.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Samsung Internet 27 on Android 14');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 12; HarmonyOS; NOH-AN00; HMSCore 6.13.0.302) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/114.0.5735.196 HuaweiBrowser/14.0.4.300 Mobile Safari/537.36',
      ),
    ).toBe('Chrome 114 on HarmonyOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Chrome 141 on iOS 17.4');
  });

  test('names the system alone, or the browser alone, when the other is unknown, and nothing when both are', () => {
    expect(describeBrowser('Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 QuickBrowser/3')).toBe(
      'Unknown browser on Android 15',
    );
    expect(describeBrowser('Mozilla/5.0 (Unknown) Firefox/144.0')).toBe('Firefox 144');
    expect(describeBrowser('curl/8.5.0')).toBeNull();
    expect(describeBrowser('')).toBeNull();
  });

  test('never gives the model or the rest of the string', () => {
    const described = describeBrowser(
      'Mozilla/5.0 (Linux; Android 15; 2211133C Build/AQ3A.240912.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 MicroMessenger/8.0.56.2800(0x28003855)',
    ) as string;
    expect(described).not.toMatch(/2211133C|Build|AQ3A|0x28003855|AppleWebKit|Mozilla/);
  });
});
