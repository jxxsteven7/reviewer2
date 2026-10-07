import { createApp } from 'vue';
import App from './App.vue';
import { currentLanguage, i18n, setLanguage } from './core/i18n';
import { router } from './router';
import './styles/fonts';
import './styles/tokens.css';
import './styles/base.css';

setLanguage(currentLanguage(), { remember: false }); // sets <html lang>
createApp(App).use(i18n).use(router).mount('#app');

// A tab that stayed open across a deploy may ask for a file that the new build no longer has.
// Reloading picks up the new build.
window.addEventListener('vite:preloadError', () => window.location.reload());
