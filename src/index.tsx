/**
 * BoncukJS v2.0 - Entry Point
 * 
 * Privacy-first, offline-capable real-time transcription.
 */

/* @refresh reload */
import { render } from 'solid-js/web';
import '@fontsource-variable/manrope';
import '@fontsource-variable/jetbrains-mono';
import '@fontsource-variable/material-symbols-outlined/full.css';
import App from './App';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

render(() => <App />, root);
