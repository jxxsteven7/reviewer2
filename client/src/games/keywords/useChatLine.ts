import { checkChat } from '@reviewer2/shared';
import { ref, type Ref } from 'vue';
import { act } from '../../core/socket';

// The line a student writes to their group, and its sending (GroupChat.vue). The game's page
// holds them, in one place, and hands them to whichever chat it shows: the panel beside the board
// on a wide screen, or the button and the sheet on a phone. Either may go as the page changes
// width, as when a tablet turns, and the sheet throws its thread away as it closes; the line, and
// a message on its way, must outlive all of that, so they belong to the page, which stays.
export function useChatLine(game: Ref<{ gameId: string } | null>) {
  const draft = ref('');
  const sending = ref(false);

  // Sends the line, one at a time. The input is cleared before the answer comes, so that the next
  // message, which a player on a slow connection may already be typing, isn't wiped out with the
  // sent one. A message the server refuses comes back into the input, in front of whatever was
  // typed since, whether or not the thread is still shown by then.
  async function say(): Promise<void> {
    if (checkChat(draft.value).problem || sending.value || !game.value) return;
    const sent = draft.value;
    draft.value = '';
    sending.value = true;
    const reply = await act('keywords:say', { gameId: game.value.gameId, text: sent });
    sending.value = false;
    if (!reply.ok) draft.value = draft.value ? `${sent} ${draft.value}` : sent;
  }

  return { draft, sending, say };
}
