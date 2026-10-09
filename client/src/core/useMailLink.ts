import { useRoute, useRouter } from 'vue-router';

// The secret of a link from a mail, which comes after the "#" so that no server, proxy or log ever
// sees it as part of an address (docs/architecture.md). The page takes it and at once leaves it out
// of the address bar, where it would otherwise stay in the browser's history, and in a screenshot.
// It is kept for the page alone: a page that is reloaded needs the link again.
export function useMailLink(): string {
  const route = useRoute();
  const router = useRouter();
  const token = route.hash.slice(1);
  if (token) void router.replace({ path: route.path, query: route.query });
  return token;
}
