// Composition root: load the player's profile, boot the client, surface fatal errors.

import { GameClient } from './client/GameClient.js';
import { loadProfile } from './ui/Settings.js';

const bar = document.getElementById('load-bar');
const text = document.getElementById('load-text');

function report(progress, message) {
  bar.style.width = `${Math.round(progress * 100)}%`;
  text.textContent = message;
}

function fail(err) {
  console.error(err);
  document.getElementById('loading').hidden = true;
  const box = document.getElementById('error');
  box.hidden = false;
  const msg = String(err && err.message ? err.message : err);
  document.getElementById('error-text').textContent = /WebGL2/.test(msg)
    ? 'This browser or device has WebGL2 turned off. Hairline needs WebGL2: try a current desktop Chrome, Edge, Firefox or Safari with hardware acceleration enabled.'
    : `Something failed during start-up: ${msg}`;
}

async function start() {
  const profile = loadProfile();
  const client = new GameClient(profile, report);
  await client.boot();
  document.getElementById('loading').hidden = true;
}

start().catch(fail);
