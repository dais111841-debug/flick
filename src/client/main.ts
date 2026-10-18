import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';
import { store } from './lib/store.svelte';

mount(App, { target: document.getElementById('app')! });
void store.init();

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
