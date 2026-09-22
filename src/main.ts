import './style.css';

import { App } from './app/App';

const gameRoot = document.getElementById('game-root');
const uiRoot = document.getElementById('ui-root');

if (!gameRoot || !uiRoot) {
  throw new Error('Missing #game-root or #ui-root in index.html');
}

new App(uiRoot, gameRoot).start();
