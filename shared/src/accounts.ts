import type { AcknowledgmentCount } from './acknowledgments';
import type { DuoView } from './duos';
import type { Rank } from './ranks';
import { cleanName } from './names';
import type { BestStreaks } from './streaks';
import { cleanLine, showsSomething, SILENT, textLength } from './text';

// Accounts (docs/architecture.md): a username and a password, an optional email address for
// resetting the password, an avatar, the record of the games played, and a public profile
// (docs/architecture.md#public-profiles). Both sides run these rules: the client while a player
// types, and the server before it keeps anything. Everything about accounts goes over HTTP under
// /api, because only an HTTP response can set the cookie that carries a login.

// A username follows the rules of a nickname (names.ts), with at least two characters, as a
// reader counts them.
export const MIN_USERNAME_LENGTH = 2;

// A password has 8 to 128 characters, counted in code points once it has been normalized, and
// nothing else is asked of it. Longer input is not looked at.
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 128;
export const MAX_PASSWORD_INPUT = 1024;

// The longest email address that mail servers take.
export const MAX_EMAIL_LENGTH = 254;

// Avatars: a square image that the browser crops and encodes, at this size, as WebP or JPEG. The
// client aims for AVATAR_TARGET_BYTES; the server takes up to MAX_AVATAR_BYTES.
export const AVATAR_SIZE = 256;
export const AVATAR_TARGET_BYTES = 30 * 1024;
export const MAX_AVATAR_BYTES = 64 * 1024;
export const AVATAR_TYPES = ['image/webp', 'image/jpeg'] as const;
export type AvatarType = (typeof AVATAR_TYPES)[number];
// Where avatars are served from. An avatar's address is its file name under this path.
export const AVATAR_PATH = '/avatars/';

// Public profiles (docs/architecture.md#public-profiles). An account's handle is the key that its
// profile is opened by: 12 hexadecimal digits drawn at random when the account is created, which
// never change, so that a link to a profile outlives a new username, and which nobody can guess or
// count through, so that the account's number stays a thing to show and never a way to look
// accounts up. The profile's page is PROFILE_PATH followed by the handle.
export const HANDLE = /^[0-9a-f]{12}$/;
export const PROFILE_PATH = '/p/';
// The one line that an account may write about itself, in the characters a reader sees once it has
// been cleaned, and the longest text that is looked at at all.
export const MAX_BIO_LENGTH = 80;
export const MAX_BIO_INPUT = 400;
// The first account is the author's: the one who set the site up registered before anyone could.
export const AUTHOR_ACCOUNT = 1;
// How many of the accounts that like a profile its owner is shown, the latest first.
export const LIKERS_SHOWN = 100;

// The addresses of the account API, which the server answers and the client calls.
export const ACCOUNT_API = {
  account: '/api/account',
  records: '/api/account/records',
  replay: '/api/account/replay',
  register: '/api/register',
  login: '/api/login',
  logout: '/api/logout',
  username: '/api/account/username',
  avatar: '/api/account/avatar',
  avatarRemove: '/api/account/avatar/remove',
  password: '/api/account/password',
  email: '/api/account/email',
  emailRemove: '/api/account/email/remove',
  emailConfirm: '/api/email/confirm',
  forgot: '/api/password/forgot',
  reset: '/api/password/reset',
  remove: '/api/account/delete',
  // The public profile: what the owner writes on it, who liked it, and the profile itself, by its
  // handle after this prefix, which anyone may read.
  profile: '/api/account/profile',
  likers: '/api/account/likers',
  profiles: '/api/profile/',
  // The page of an AI player, by its persona after this prefix (docs/architecture.md#ai-players).
  agents: '/api/agent/',
  like: '/api/profile/like',
  unlike: '/api/profile/unlike',
} as const;

// What the account API may answer instead of doing what was asked, besides bad_request,
// rate_limited and internal, which every answer can be. The client shows each one with the text
// under errors.<code> in the locale files.
export const ACCOUNT_ERRORS = [
  'bad_origin',
  'not_logged_in',
  'username_invalid',
  'username_short',
  'username_mixed',
  'username_reserved',
  'username_taken',
  'password_short',
  'password_long',
  'password_wrong',
  'login_failed',
  'login_limited',
  'register_limited',
  'email_invalid',
  'email_limited',
  'mail_unavailable',
  'link_invalid',
  'avatar_invalid',
  'avatar_too_large',
  'avatar_limited',
  'avatar_banned',
  'avatars_full',
  'storage_full',
  'busy',
  'no_replay',
  'no_such_profile',
  'self_like',
  'like_limited',
  'profile_banned',
  'bio_too_long',
  'web_link_invalid',
  'web_link_too_long',
] as const;
export type AccountError = (typeof ACCOUNT_ERRORS)[number];

// Whether an email address is bound: none, one that waits for its confirmation link to be
// opened, or one that is bound. The address itself is never kept, so it is never shown.
export const EMAIL_STATES = ['none', 'pending', 'bound'] as const;
export type EmailState = (typeof EMAIL_STATES)[number];

// The titles that matches award (the match PR awards them; accounts keep and show them).
export const TITLES = ['best_paper', 'black_hole'] as const;
export type Title = (typeof TITLES)[number];

export interface TitleCount {
  title: Title;
  count: number;
}

// What an account's owner writes on its public profile, and what of the rest they choose to
// show there: the record, as counts, and the acknowledgments.
export interface ProfileSettings {
  link: string | null;
  bio: string | null;
  showRecord: boolean;
  showThanks: boolean;
}

// What the owner of an account sees of it. `id` is the account's number, from 1 up in the order
// of registration, and `handle` the key of its public profile. `avatar` is the address of the
// uploaded avatar, or null for the default one, which the client draws from the username. `points`
// are those of every game finished, from which the client tells the rank (ranks.ts). `streaks` are
// the longest runs of wins and of losses on the record, which the page shows as titles
// (streaks.ts). `acknowledgments` is how often the account is thanked for each kind of help
// (acknowledgments.ts). `profile` is what the owner put on the public profile, with `banned` for
// an account that the operator has barred from writing a link or a bio there. `likes` is how many
// accounts like the profile, and `requests` how many friend requests wait for the owner's answer
// (friends.ts).
export interface AccountSummary {
  id: number;
  handle: string;
  username: string;
  avatar: string | null;
  createdAt: string;
  email: EmailState;
  points: number;
  titles: TitleCount[];
  streaks: BestStreaks;
  acknowledgments: AcknowledgmentCount[];
  profile: ProfileSettings & { banned: boolean };
  likes: number;
  requests: number;
}

// A public profile, as anyone sees it (docs/architecture.md#public-profiles): the account's
// number, username, avatar, rank, the day it registered (`createdAt`, as YYYY-MM-DD in UTC, and
// never the time), its titles and its streaks, which the page shows as titles too (streaks.ts);
// the link and the bio its owner wrote, if any; its record and its acknowledgments, if its owner
// shows them, else null; and how many accounts like it. `liked` says whether the viewer likes it,
// and `mine` whether the viewer is its owner; both are false for a guest. `duo` is what the viewer
// has played with the owner, for a viewer who is the owner's friend and shares a game with them,
// else null (duos.ts): nobody else learns of it.
export interface ProfileView {
  id: number;
  handle: string;
  username: string;
  avatar: string | null;
  rank: Rank;
  createdAt: string;
  titles: TitleCount[];
  streaks: BestStreaks;
  link: string | null;
  bio: string | null;
  record: { games: number; wins: number; matches: number } | null;
  acknowledgments: AcknowledgmentCount[] | null;
  likes: number;
  liked: boolean;
  mine: boolean;
  duo: DuoView | null;
}

// An account that likes a profile, as the profile's owner sees it, with whether the two are
// friends, so that the owner may ask those who aren't.
export interface LikerView {
  handle: string;
  username: string;
  avatar: string | null;
  friend: boolean;
}

// The answer to GET /api/account: the account that the browser is logged in to, if any, and
// whether email is available on this server, for binding an address and resetting a password.
export interface AccountState {
  account: AccountSummary | null;
  mail: boolean;
}

// One game on an account's record, as the game module described the player's part in it. For
// the team word guessing game, `side` is the group and `role` is captain or guesser. `replay`
// says whether the server kept the game to watch again (docs/architecture.md#replays), which the
// page asks for with the game's ID.
export interface GameRecord {
  game: string;
  gameId: string;
  endedAt: string;
  replay: boolean;
  side: string;
  role: string;
  winner: string;
  won: boolean;
  verdict: string;
}

// A match on an account's record: when it ended, how many games it had, the place the player
// finished in among how many ranked players, their total, and the title they were awarded, if any.
export interface MatchRecord {
  game: string;
  endedAt: string;
  games: number;
  rank: number;
  players: number;
  score: number;
  title: Title | null;
}

export interface RecordsView {
  games: number;
  wins: number;
  // The latest first.
  recent: GameRecord[];
  // The matches that the account finished, and the latest of them, the latest first.
  matches: { played: number; recent: MatchRecord[] };
}

// How many games the record page lists.
export const RECENT_RECORDS = 20;

export type UsernameProblem = 'username_invalid' | 'username_short' | 'username_mixed' | 'username_reserved';

export type UsernameCheck = { username: string; problem: null } | { username: null; problem: UsernameProblem };

// The form of a name that two names are compared in: normalized with NFKC, which folds
// full-width forms, without the silent characters that a reader can't see, and with case folded.
// JavaScript has no full case folding, so the text goes to upper case and back: that folds the
// sharp s with "ss", and the final sigma with the other sigma. A name that only differs from a
// username in these ways is the same name, for registering, for logging in, and for a guest's
// nickname.
export function usernameKey(name: string): string {
  return name.normalize('NFKC').replace(SILENT, '').toUpperCase().toLowerCase().normalize('NFKC');
}

// The scripts whose letters look alike. A name that mixes them, such as "admin" with a Cyrillic
// "a", could pass for another; a name in one of them alone is fine.
const LOOKALIKE_SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Greek}/u, /\p{Script=Cyrillic}/u];

function mixesScripts(name: string): boolean {
  const seen = new Set<number>();
  for (const char of name) {
    LOOKALIKE_SCRIPTS.forEach((script, index) => {
      if (script.test(char)) seen.add(index);
    });
  }
  return seen.size > 1;
}

// Names that nobody may register, compared without spaces, dots, dashes and underscores, so that
// "Reviewer 2" and "reviewer_2" are taken too. The Chinese ones are for the administrator, the
// system, official and customer service.
const RESERVED = new Set(
  [
    'admin',
    'administrator',
    'root',
    'system',
    'moderator',
    'staff',
    'support',
    'official',
    'reviewer2',
    'playreviewer2',
    // The AI player's names in both languages (agent.ts), which nobody else may go by.
    'reviewer1',
    '\u{4e00}\u{53f7}\u{5ba1}\u{7a3f}\u{4eba}',
    '\u{7ba1}\u{7406}\u{5458}',
    '\u{7cfb}\u{7edf}',
    '\u{5b98}\u{65b9}',
    '\u{5ba2}\u{670d}',
  ].map((name) => reservedKey(name)),
);

function reservedKey(name: string): string {
  return usernameKey(name).replace(/[\s._\-\u{b7}]/gu, '');
}

// Whether a name is one of the reserved names. A guest may not take one as a nickname either:
// they are reserved so that nobody can pass for the people who run the game.
export const isReservedName = (name: string): boolean => RESERVED.has(reservedKey(name));

// A username as it will be kept and shown, or why it can't be one.
export function checkUsername(raw: string): UsernameCheck {
  const name = typeof raw === 'string' ? cleanName(raw) : null;
  if (name === null) return { username: null, problem: 'username_invalid' };
  if (textLength(name) < MIN_USERNAME_LENGTH) return { username: null, problem: 'username_short' };
  if (mixesScripts(name)) return { username: null, problem: 'username_mixed' };
  if (isReservedName(name)) return { username: null, problem: 'username_reserved' };
  return { username: name, problem: null };
}

// A password as it is hashed: normalized with NFKC, so that the same password typed with a
// full-width keyboard on one phone and a half-width one on another is the same password.
export const normalizePassword = (password: string): string => password.normalize('NFKC');

export function checkPassword(raw: unknown): 'password_short' | 'password_long' | null {
  if (typeof raw !== 'string') return 'password_short';
  if (raw.length > MAX_PASSWORD_INPUT) return 'password_long';
  const length = [...normalizePassword(raw)].length;
  if (length < MIN_PASSWORD_LENGTH) return 'password_short';
  return length > MAX_PASSWORD_LENGTH ? 'password_long' : null;
}

export interface BioCheck {
  // The bio as it is kept and shown, on one line, or null for none.
  bio: string | null;
  problem: 'bio_too_long' | null;
}

// The line that an account writes about itself, cleaned as a contact is (feedback.ts): one line,
// with hidden characters dropped and whitespace folded. One that shows nothing is none.
export function checkBio(text: string | undefined): BioCheck {
  if (typeof text !== 'string') return { bio: null, problem: null };
  if (text.length > MAX_BIO_INPUT) return { bio: null, problem: 'bio_too_long' };
  const cleaned = cleanLine(text);
  if (!showsSomething(cleaned)) return { bio: null, problem: null };
  if (textLength(cleaned) > MAX_BIO_LENGTH) return { bio: cleaned, problem: 'bio_too_long' };
  return { bio: cleaned, problem: null };
}

// Whether a text could be an email address at all: something, an @, and a domain with a dot,
// without spaces. The server normalizes it further; this is for the form.
export function looksLikeEmail(raw: string): boolean {
  const email = raw.trim();
  return email.length <= MAX_EMAIL_LENGTH && /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email);
}
