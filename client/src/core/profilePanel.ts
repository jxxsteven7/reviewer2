import { ref } from 'vue';

// How any page opens an account's panel outside a room (components/ProfilePanel.vue): from an
// avatar on the account page or the home page (components/AvatarButton.vue), from an account among
// the feedback contributions (components/ContributionsList.vue), or from the friend search for the
// account it finds (views/ProfileFriends.vue). The site has one such panel, which
// App.vue holds, so that it lies over whatever opened it and outlives a list row that a refresh
// takes away while it is open; whatever opened it may ask to hear, with `done`, that something
// went through there, as the search does to clear its box.
export interface ShownProfile {
  handle: string;
  username: string;
  done?: () => void;
}

export const shownProfile = ref<ShownProfile | null>(null);

export function openProfile(handle: string, username: string, done?: () => void): void {
  shownProfile.value = { handle, username, ...(done && { done }) };
}

export function closeProfile(): void {
  shownProfile.value = null;
}
