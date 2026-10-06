import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './core/views/HomeView.vue';
import NotFound from './core/views/NotFound.vue';

// Views are imported statically, so the whole app is one bundle: a tab left open across a
// deploy can't then ask for a lazily loaded chunk that the new build no longer has.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
});
