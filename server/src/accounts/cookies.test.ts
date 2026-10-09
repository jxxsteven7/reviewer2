import { describe, expect, test } from 'vitest';
import { clearedCookie, fromThisSite, loginCookie, readLoginCookie } from './cookies';

const SECRET = 'a'.repeat(43);

describe('the login cookie', () => {
  test('is HttpOnly, SameSite=Lax and lasts a year, and Secure with the __Host- prefix over HTTPS', () => {
    expect(loginCookie(SECRET, true)).toBe(
      `__Host-r2s=${SECRET}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax; Secure`,
    );
    expect(loginCookie(SECRET, false)).toBe(`r2s=${SECRET}; Max-Age=31536000; Path=/; HttpOnly; SameSite=Lax`);
    expect(clearedCookie(true)).toBe('__Host-r2s=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure');
  });

  test('is read from among the other cookies, by the name it has', () => {
    const headers = { cookie: `theme=dark; __Host-r2s=${SECRET} ; r2s=plain` };
    expect(readLoginCookie(headers, true)).toBe(SECRET);
    expect(readLoginCookie(headers, false)).toBe('plain');
    expect(readLoginCookie({ cookie: 'xr2s=1; r2s2=2' }, false)).toBeNull();
    expect(readLoginCookie({}, true)).toBeNull();
    expect(readLoginCookie({ cookie: `r2s=${SECRET}; r2s=other` }, false)).toBe(SECRET);
  });
});

describe('a request', () => {
  test('comes from this site when its Origin names this host', () => {
    expect(fromThisSite({ host: 'playreviewer2.com', origin: 'https://playreviewer2.com' })).toBe(true);
    expect(fromThisSite({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000' })).toBe(true);
    expect(fromThisSite({ host: 'PlayReviewer2.com', origin: 'https://playreviewer2.com' })).toBe(true);
  });

  test('comes from elsewhere when its Origin names another host, or none that can be read', () => {
    for (const origin of ['https://evil.example', 'https://playreviewer2.com.evil.example', 'null', 'nonsense']) {
      expect(fromThisSite({ host: 'playreviewer2.com', origin }), origin).toBe(false);
    }
    expect(fromThisSite({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3001' })).toBe(false);
    expect(fromThisSite({ origin: 'https://playreviewer2.com' })).toBe(false);
  });

  test('without an Origin goes by Sec-Fetch-Site, if it has one', () => {
    expect(fromThisSite({ host: 'playreviewer2.com' })).toBe(true);
    expect(fromThisSite({ host: 'playreviewer2.com', 'sec-fetch-site': 'same-origin' })).toBe(true);
    for (const site of ['same-site', 'cross-site', 'none']) {
      expect(fromThisSite({ host: 'playreviewer2.com', 'sec-fetch-site': site }), site).toBe(false);
    }
  });
});
