import './styles.css';
import { App } from './ui/app';

new App(document.getElementById('app')!);

// Offline support in production builds (the dev server stays uncached).
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Offline mode is a bonus; ignore failures (e.g. file:// or private mode). */
    });
  });
}
