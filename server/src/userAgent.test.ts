import { describe, expect, test } from 'vitest';
import { describeBrowser } from './userAgent';

// The browser and the system of a bug report, as its issue says them: names and versions alone,
// never the model or the string itself.

describe('the browser of a bug report', () => {
  test('is named with its version and its system, as the user agent says them', () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Mobile/15E148 MicroMessenger/8.0.60(0x18003c2d) NetType/WIFI Language/zh_CN',
      ),
    ).toBe('WeChat 8.0.60 on iOS 18.5');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 15; 2211133C Build/AQ3A.240912.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Version/4.0 Chrome/130.0.6723.107 Mobile Safari/537.36 XWEB/1300297 MMWEBSDK/20240301 ' +
          'MMWEBID/9999 MicroMessenger/8.0.56.2800(0x28003855) WeChat/arm64',
      ),
    ).toBe('WeChat 8.0.56 on Android 15');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Version/18.5 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 18.5 on iOS 18.5');
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
    ).toBe('Huawei Browser 14 on HarmonyOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Chrome 141 on iOS 17.4');
  });

  test("names the browsers common on phones in China, and an app's web view, before the Chrome they say they are", () => {
    expect(
      describeBrowser(
        'Mozilla/5.0 (Phone; OpenHarmony 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 ' +
          'Safari/537.36 ArkWeb/4.1.6.1 Mobile HuaweiBrowser/5.0.4.300',
      ),
    ).toBe('Huawei Browser 5 on HarmonyOS 5.0');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; U; Android 13; zh-cn; V2203A Build/TP1A.220624.014) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Version/4.0 Chrome/109.0.5414.86 MQQBrowser/14.9 Mobile Safari/537.36',
      ),
    ).toBe('QQ Browser 14 on Android 13');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; U; Android 14; zh-CN; 23116PN5BC Build/UKQ1.230804.001) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 Quark/7.4.0.660 Mobile Safari/537.36',
      ),
    ).toBe('Quark 7 on Android 14');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; U; Android 14; zh-CN; PHB110 Build/UKQ1.230924.001) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Version/4.0 Chrome/100.0.4896.58 UCBrowser/17.5.6.1278 Mobile Safari/537.36',
      ),
    ).toBe('UC Browser 17 on Android 14');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; U; Android 14; zh-cn; 23013RK75C Build/UKQ1.230804.001) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Version/4.0 Chrome/118.0.5993.80 Mobile Safari/537.36 XiaoMi/MiuiBrowser/18.4.40711',
      ),
    ).toBe('Mi Browser 18 on Android 14');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 14; SM-S911B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Version/4.0 Chrome/124.0.6367.54 Mobile Safari/537.36 baiduboxapp/13.42.0.10',
      ),
    ).toBe('Baidu 13 on Android 14');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 15; Pixel 9 Build/AP4A.250105.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Version/4.0 Chrome/132.0.6834.163 Mobile Safari/537.36',
      ),
    ).toBe('Android WebView 132 on Android 15');
  });

  test('leaves out a version of the system that the browser holds still, and so says nothing wrong', () => {
    // Chrome on Android says Android 10 and the model K whatever the phone runs.
    expect(
      describeBrowser(
        'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      ),
    ).toBe('Chrome 141 on Android');
    // Every browser on a Mac says 10_15_7, and so does an iPad in its desktop mode.
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Version/18.1 Safari/605.1.15',
      ),
    ).toBe('Safari 18.1 on macOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/141.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 141 on macOS');
    // iOS from 26 on says 18_6: Safari's own version names the system, and nothing else does.
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Version/26.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Safari 26.0 on iOS 26.0');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Mobile/15E148 MicroMessenger/8.0.60(0x18003c2d) NetType/WIFI Language/zh_CN',
      ),
    ).toBe('WeChat 8.0.60 on iOS');
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'CriOS/141.0.0.0 Mobile/15E148 Safari/604.1',
      ),
    ).toBe('Chrome 141 on iOS');
    // iOS 18.5 and before say what they run.
    expect(
      describeBrowser(
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
          'Mobile/15E148 MicroMessenger/8.0.60(0x18003c2d) NetType/WIFI Language/zh_CN',
      ),
    ).toBe('WeChat 8.0.60 on iOS 18.5');
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
