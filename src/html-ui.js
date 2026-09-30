// HTML launch screen and desktop side panel. Renders the same specs as the
// in-VR panel (guidance.js), with real buttons, keyboard access and an
// aria-live feedback region (PRD §10 accessibility, FR-12).
import { TONES } from './panel.js';
import { fmtTime } from './guidance.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, text) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  if (text !== undefined) n.textContent = text;
  return n;
}

export class HtmlUI {
  constructor() {
    this.onAction = () => {};
    this.onEnterVR = () => {};
    this.xrStatus = null;
    this.lastKey = null;
    $('enter-vr').addEventListener('click', () => this.onEnterVR());
    $('welcome-enter').addEventListener('click', () => this.onEnterVR());
    $('welcome-preview').addEventListener('click', () => this.hideWelcome());
    for (const root of [$('actions'), $('help-actions')]) {
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-id]');
        if (b && !b.disabled) this.onAction(b.dataset.id);
      });
    }
  }

  hideWelcome() {
    $('welcome').hidden = true;
    const first = $('actions').querySelector('button:not([disabled])');
    first?.focus();
  }

  setXRStatus({ status, message }) {
    this.xrStatus = status;
    const ok = status === 'supported';
    for (const id of ['enter-vr', 'welcome-enter']) {
      $(id).disabled = !ok;
      $(id).setAttribute('aria-disabled', String(!ok));
    }
    $('xr-status').textContent = message;
    $('xr-status').dataset.state = status;
    $('welcome-xr').textContent = message;
    $('welcome-xr').dataset.state = status;
  }

  showXRError(message) {
    $('xr-status').textContent = message;
    $('xr-status').dataset.state = 'error';
    $('welcome-xr').textContent = message;
    $('welcome-xr').dataset.state = 'error';
    $('welcome-enter').textContent = 'Retry Enter VR';
    $('enter-vr').textContent = 'Retry Enter VR';
  }

  setMode(mode) {
    document.body.dataset.mode = mode;
    if (mode === 'xr') {
      $('welcome').hidden = true;
      $('xr-status').textContent = 'In VR — continue in the headset. Exiting VR keeps your progress.';
      $('enter-vr').disabled = true;
    } else {
      $('enter-vr').disabled = this.xrStatus !== 'supported';
      $('enter-vr').textContent = 'Enter VR';
      $('xr-status').textContent = this.xrStatus === 'supported'
        ? 'Desktop preview. Select Enter VR to continue in the headset.'
        : $('xr-status').textContent;
    }
  }

  setTimer(ms) {
    $('timer').textContent = fmtTime(ms);
  }

  renderSpec(prefix, spec) {
    $(`${prefix}kicker`).textContent = spec.kicker ?? '';
    $(`${prefix}title`).textContent = spec.title ?? '';
    const body = $(`${prefix}body`);
    body.replaceChildren();
    let list = null;
    for (const item of spec.body ?? []) {
      if (typeof item === 'object' && item.gap) continue;
      const text = typeof item === 'string' ? item : item.text;
      if (typeof item === 'object' && item.bullet) {
        if (!list) {
          list = el('ul');
          body.append(list);
        }
        list.append(el('li', {}, text));
      } else {
        list = null;
        body.append(el('p', { class: typeof item === 'object' && item.size && item.size < 26 ? 'muted' : undefined }, text));
      }
    }
    const actions = $(`${prefix}actions`);
    const focused = document.activeElement?.dataset?.id;
    actions.replaceChildren();
    for (const row of spec.buttons ?? []) {
      if (!row.length) continue;
      const r = el('div', { class: 'row' });
      for (const b of row) {
        const btn = el('button', {
          type: 'button',
          class: `btn ${b.variant ?? ''}`,
          dataset: { id: b.id },
          disabled: b.enabled === false,
          'aria-pressed': b.active === undefined ? undefined : String(!!b.active),
        }, b.label);
        r.append(btn);
      }
      actions.append(r);
    }
    if (focused) actions.querySelector(`button[data-id="${CSS.escape(focused)}"]`)?.focus();
  }

  render({ main, help, results }) {
    const key = JSON.stringify([main, help, results && results.status, results && results.score]);
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.renderSpec('', main);

    const fb = $('feedback');
    if (main.feedback?.text) {
      const tone = TONES[main.feedback.tone] ?? TONES.info;
      fb.hidden = false;
      fb.dataset.tone = main.feedback.tone;
      fb.setAttribute('aria-live', main.feedback.tone === 'critical' ? 'assertive' : 'polite');
      fb.replaceChildren(
        el('strong', { class: 'tone-label' }, tone.label ? `${tone.label}: ` : ''),
        document.createTextNode(main.feedback.text),
      );
    } else {
      fb.hidden = true;
      fb.textContent = '';
    }

    const helpEl = $('help');
    helpEl.hidden = !help;
    if (help) this.renderSpec('help-', help);

    const res = $('results');
    res.hidden = !results;
    if (results) this.renderResults(results);
  }

  renderResults(r) {
    const res = $('results');
    res.replaceChildren();
    res.append(el('h2', {}, 'Checkpoint record'));
    const table = el('table');
    const head = el('tr');
    ['Checkpoint', 'First attempt', 'Points', 'Note'].forEach((h) => head.append(el('th', { scope: 'col' }, h)));
    const thead = el('thead');
    thead.append(head);
    table.append(thead);
    const tb = el('tbody');
    for (const c of r.checkpoints) {
      const tr = el('tr');
      tr.append(
        el('td', {}, c.label),
        el('td', {}, c.status === 'passed' ? 'Pass' : c.corrected ? 'Miss (corrected)' : 'Miss'),
        el('td', {}, `${c.status === 'passed' ? c.points : 0}/${c.points}`),
        el('td', {}, c.status === 'passed' ? '' : c.note ?? ''),
      );
      tb.append(tr);
    }
    table.append(tb);
    res.append(table);
    res.append(el('p', { class: 'muted' },
      `Session ${r.sessionId.slice(0, 8)} · scenario v${r.scenarioVersion} · input used: ${r.inputModes.join(', ') || 'n/a'}. ` +
      'Results live in this browser tab only; refreshing starts a new session.'));
  }
}
