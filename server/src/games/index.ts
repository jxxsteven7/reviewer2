import type { GameModule } from '../core/game';
import { keywordsGame } from './keywords';

// The games that this server plays: the ones it serves (main.ts) and the ones its data is held
// against (`admin.cjs data check`, store/check.ts), in one list, so that a game added here is
// played and checked alike.
export const GAMES: readonly GameModule[] = [keywordsGame];
