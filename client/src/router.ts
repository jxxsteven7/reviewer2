import { PROFILE_PATH } from '@reviewer2/shared';
import { createRouter, createWebHistory } from 'vue-router';
import AccountPage from './core/views/AccountPage.vue';
import ConfirmEmail from './core/views/ConfirmEmail.vue';
import ForgotPassword from './core/views/ForgotPassword.vue';
import HomeView from './core/views/HomeView.vue';
import NotFound from './core/views/NotFound.vue';
import ProfilePage from './core/views/ProfilePage.vue';
import ResetPassword from './core/views/ResetPassword.vue';
import RoomPage from './core/views/RoomPage.vue';
import ScreenPage from './core/views/ScreenPage.vue';

// Views are imported statically, so the whole app is one bundle: a tab left open across a
// deploy can't then ask for a lazily loaded chunk that the new build no longer has.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: HomeView },
    { path: '/account', name: 'account', component: AccountPage },
    { path: '/account/forgot', name: 'forgot', component: ForgotPassword },
    // The pages that the links in mails lead to (shared/src/mail.ts).
    { path: '/account/reset', name: 'reset', component: ResetPassword },
    { path: '/account/confirm', name: 'confirm', component: ConfirmEmail },
    // A player's public page (docs/architecture.md#public-profiles).
    { path: `${PROFILE_PATH}:handle`, name: 'profile', component: ProfilePage, props: true },
    { path: '/room/:code', name: 'room', component: RoomPage, props: true },
    { path: '/room/:code/screen', name: 'screen', component: ScreenPage, props: true },
    { path: '/:pathMatch(.*)*', name: 'not-found', component: NotFound },
  ],
});
