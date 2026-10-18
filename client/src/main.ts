import { createApp } from 'vue';
import App from './App.vue';
import { currentLanguage, i18n, setLanguage } from './core/i18n';
import { router } from './router';
import './styles/fonts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/intro.css';

setLanguage(currentLanguage(), { remember: false }); // sets <html lang>
createApp(App).use(i18n).use(router).mount('#app');
