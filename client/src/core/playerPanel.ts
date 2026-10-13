import { inject, provide, type InjectionKey } from 'vue';

// How a room's page opens a player's panel (components/PlayerPanel.vue) from an avatar anywhere on
// it: in the groups, the waiting room, the chat, a match's table or a notice. The page provides the
// opener; a page without one, such as a big screen's, which nobody taps, shows avatars that open
// nothing (components/AvatarButton.vue).
const OPEN_PLAYER: InjectionKey<(playerId: string) => void> = Symbol('open a player');

export const provideOpenPlayer = (open: (playerId: string) => void): void => provide(OPEN_PLAYER, open);

export const useOpenPlayer = (): ((playerId: string) => void) | null => inject(OPEN_PLAYER, null);
