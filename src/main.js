// Entry point: capability checks, then boot the app.
import { App } from './app.js';
import { HtmlUI } from './html-ui.js';
import { detectXR } from './xr-session.js';

const boot = globalThis.__boot;

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function start() {
  if (!webglAvailable()) {
    boot.fail('This browser cannot display 3D graphics (WebGL is unavailable or disabled). '
      + 'Try Meta Quest Browser on the headset, or a current Chrome/Edge on desktop with hardware acceleration enabled.', false);
    return;
  }
  const ui = new HtmlUI();
  const app = new App({ container: document.getElementById('stage'), ui });
  ui.onAction = (id) => app.dispatch(id, 'desktop');
  ui.onEnterVR = () => app.enterVR();
  setInterval(() => ui.setTimer(app.engine.elapsedMs()), 500);
  const refreshXR = () => detectXR().then((s) => {
    ui.setXRStatus(s);
    if (app.xr) ui.setMode('xr');
  });
  refreshXR();
  navigator.xr?.addEventListener?.('devicechange', refreshXR);
  globalThis.__app = app; // debugging and automated smoke tests
  boot.ready();
}

try {
  start();
} catch (err) {
  console.error(err);
  boot.fail(`The training could not start (${err?.message ?? err}).`, true);
}
