/* =========================================================
   Stichansagen – Auswertung
   Reines HTML/JS, alle Daten im localStorage.
   ========================================================= */
'use strict';

const APP_VERSION = '8';   // muss zu sw.js und den ?v= in index.html passen
const STORE_KEY = 'stichansagen.v1';
const THEME_KEY = 'stichansagen.theme';

/* ---------- kleine Helfer ---------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(n.dataset, v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    n.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return n;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2400);
}

const fmtDate = ts => new Date(ts).toLocaleDateString('de-DE',
  { day: '2-digit', month: '2-digit', year: 'numeric' });
const signed = n => (n > 0 ? '+' + n : String(n));

/* ---------- Wertungs-Presets ---------- */
const PRESETS = {
  wizard: {
    label: 'Wizard',
    desc: 'Richtig: 20 Punkte + 10 je Stich. Falsch: −10 je Stich Differenz.',
    scoring: { bonus: 20, perTrick: 10, perDiff: -10, wrongBase: 0,
               tricksWhenWrong: false, lowestWins: false,
               zeroFromCards: 0, zeroBonus: 0 }
  },
  klassisch: {
    label: 'Klassisch',
    desc: 'Richtig: 10 Punkte + 1 je Stich. Falsch: −1 je Stich Differenz. ' +
          'Ab 7 Karten auf der Hand zählt eine getroffene Ansage von 0 Stichen 20 statt 10 Punkte.',
    scoring: { bonus: 10, perTrick: 1, perDiff: -1, wrongBase: 0,
               tricksWhenWrong: false, lowestWins: false,
               zeroFromCards: 7, zeroBonus: 20 }
  },
  stiche: {
    label: 'Stiche + Bonus',
    desc: 'Stiche zählen immer. Bei richtiger Ansage zusätzlich 10 Punkte Bonus.',
    scoring: { bonus: 10, perTrick: 1, perDiff: 0, wrongBase: 0,
               tricksWhenWrong: true, lowestWins: false,
               zeroFromCards: 0, zeroBonus: 0 }
  },
  differenz: {
    label: 'Nur Differenz',
    desc: 'Je Stich Differenz 1 Minuspunkt. Wer am Ende die wenigsten Punkte hat, gewinnt.',
    scoring: { bonus: 0, perTrick: 0, perDiff: 1, wrongBase: 0,
               tricksWhenWrong: false, lowestWins: true,
               zeroFromCards: 0, zeroBonus: 0 }
  },
  custom: {
    label: 'Eigene',
    desc: 'Formel unten frei einstellen.',
    scoring: { bonus: 20, perTrick: 10, perDiff: -10, wrongBase: 0,
               tricksWhenWrong: false, lowestWins: false,
               zeroFromCards: 0, zeroBonus: 0 }
  }
};

const MODES = {
  updown: { label: 'Auf und ab',   hint: '1 … max … 1' },
  up:     { label: 'Aufsteigend',  hint: '1 … max' },
  down:   { label: 'Absteigend',   hint: 'max … 1' },
  downup: { label: 'Ab und auf',   hint: 'max … 1 … max' },
  fixed:  { label: 'Feste Runden', hint: 'immer gleich viele Karten' }
};

/* ---------- Persistenz ---------- */
function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { version: 1, games: [] };
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.games)) return { version: 1, games: [] };
    // Vorversion kannte die Schwelle als Rundennummer (zeroFromRound); gemeint
    // war immer die Kartenzahl der Runde. Wert einmalig übernehmen.
    for (const g of data.games) {
      const sc = g && g.scoring;
      if (sc && sc.zeroFromCards === undefined && sc.zeroFromRound !== undefined) {
        sc.zeroFromCards = sc.zeroFromRound;
        delete sc.zeroFromRound;
      }
    }
    return data;
  } catch (e) {
    console.warn('Speicher konnte nicht gelesen werden', e);
    return { version: 1, games: [] };
  }
}

function saveStore() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    toast('Speichern fehlgeschlagen – Speicher voll?');
  }
}

let store = loadStore();

/* ---------- Rundenaufbau ---------- */
function range(from, to) {
  const out = [];
  const step = from <= to ? 1 : -1;
  for (let i = from; step > 0 ? i <= to : i >= to; i += step) out.push(i);
  return out;
}

/** Anzahl der Einer-Runden, die hinten angehängt werden. Bei "Feste Runden"
    gibt die Rundenzahl der Nutzer vor – dort greift die Hausregel nicht. */
function extraSingleRounds(cfg) {
  if (!cfg.extraSingles || cfg.mode === 'fixed') return 0;
  return Math.max(0, cfg.players | 0);
}

function buildCardCounts(cfg) {
  const max = Math.max(1, cfg.maxCards | 0);
  let counts;
  switch (cfg.mode) {
    case 'up':     counts = range(1, max); break;
    case 'down':   counts = range(max, 1); break;
    case 'downup': counts = max === 1 ? [1] : [...range(max, 1), ...range(2, max)]; break;
    case 'fixed':  counts = Array(Math.max(1, cfg.rounds | 0)).fill(Math.max(1, cfg.fixedCards | 0)); break;
    case 'updown':
    default:       counts = max === 1 ? [1] : [...range(1, max), ...range(max - 1, 1)];
  }
  // Hausregel: nach dem regulären Verlauf noch je Spieler eine Runde mit einer Karte.
  const extra = extraSingleRounds(cfg);
  if (extra > 0) counts = [...counts, ...Array(extra).fill(1)];
  return counts;
}

/* ---------- Punkte ---------- */
function roundScore(bid, tricks, sc, cards) {
  if (bid === null || tricks === null) return 0;
  if (bid === tricks) {
    // Sonderregel: sobald jeder so viele Karten auf der Hand hat, zählt eine
    // getroffene Null-Ansage einen festen Wert statt der normalen Formel.
    // Maßgeblich ist die Kartenzahl der Runde, nicht die Rundennummer.
    if (bid === 0 && sc.zeroFromCards > 0 && cards >= sc.zeroFromCards) return sc.zeroBonus;
    return sc.bonus + sc.perTrick * tricks;
  }
  const diff = Math.abs(bid - tricks);
  return sc.wrongBase + sc.perDiff * diff + (sc.tricksWhenWrong ? sc.perTrick * tricks : 0);
}

/** Laufende Summen je Spieler nach jeder abgeschlossenen Runde. */
function computeTotals(game) {
  const totals = {};
  game.players.forEach(p => { totals[p.id] = 0; });
  const perRound = [];
  game.rounds.forEach(r => {
    const row = {};
    if (r.done) {
      for (const p of game.players) {
        const pts = roundScore(r.bids[p.id] ?? null, r.tricks[p.id] ?? null, game.scoring, r.cards);
        row[p.id] = pts;
        totals[p.id] += pts;
      }
    }
    perRound.push(row);
  });
  return { totals, perRound };
}

function ranking(game) {
  const { totals } = computeTotals(game);
  const arr = game.players.map(p => ({ ...p, score: totals[p.id] }));
  arr.sort((a, b) => game.scoring.lowestWins ? a.score - b.score : b.score - a.score);
  let place = 0, prev = null;
  arr.forEach((row, i) => {
    if (prev === null || row.score !== prev) place = i + 1;
    prev = row.score;
    row.place = place;
  });
  return arr;
}

function statsFor(game) {
  return game.players.map(p => {
    let hits = 0, played = 0;
    for (const r of game.rounds) {
      if (!r.done) continue;
      played++;
      if (r.bids[p.id] === r.tricks[p.id]) hits++;
    }
    return { player: p, hits, played, quote: played ? Math.round(hits / played * 100) : 0 };
  });
}

/* ---------- App-Status ---------- */
const ui = {
  view: 'home',       // home | setup | game | table
  gameId: null,
  phase: 'bid',       // bid | trick
  draft: null,        // Setup-Entwurf
  sheetRound: null
};

const games = () => store.games;
const getGame = id => store.games.find(g => g.id === id) || null;
const currentGame = () => getGame(ui.gameId);

function touch(game) {
  game.updatedAt = Date.now();
  saveStore();
}

/* =========================================================
   Navigation
   ========================================================= */
function show(view) {
  ui.view = view;
  for (const name of ['home', 'setup', 'game', 'table']) {
    $('#screen-' + name).hidden = name !== view;
  }
  $('#btnBack').hidden = (view === 'home');
  $('#tabbar').hidden = !(view === 'game' || view === 'table');
  $$('.tabbtn').forEach(b => b.classList.toggle('on', b.dataset.view === view));
  window.scrollTo(0, 0);
  render();
}

function render() {
  switch (ui.view) {
    case 'home':  renderHome();  break;
    case 'setup': renderSetup(); break;
    case 'game':  renderGame();  break;
    case 'table': renderTable(); break;
  }
}

/* =========================================================
   Startbildschirm
   ========================================================= */
function renderHome() {
  $('#appTitle').textContent = 'Stichansagen';
  $('#appVersion').textContent = APP_VERSION;

  const sorted = [...games()].sort((a, b) => b.updatedAt - a.updatedAt);
  const running  = sorted.filter(g => !g.finished);
  const finished = sorted.filter(g => g.finished);

  fillGameList($('#listRunning'),  running,  'Noch kein laufendes Spiel.');
  fillGameList($('#listFinished'), finished, 'Noch keine beendeten Spiele.');
}

function fillGameList(node, list, emptyText) {
  node.replaceChildren();
  if (!list.length) {
    node.append(el('div', { class: 'empty', text: emptyText }));
    return;
  }
  for (const g of list) {
    const done = g.rounds.filter(r => r.done).length;
    const rank = ranking(g);
    const lead = rank[0];
    node.append(el('button', {
      class: 'gcard',
      onclick: () => { ui.gameId = g.id; ui.phase = phaseForGame(g); show(g.finished ? 'table' : 'game'); }
    },
      el('div', { class: 'gcard-main' },
        el('div', { class: 'gcard-title', text: g.name || g.players.map(p => p.name).join(', ') }),
        el('div', { class: 'gcard-sub',
          text: `${g.players.length} Spieler · Runde ${Math.min(done + 1, g.rounds.length)}/${g.rounds.length}` +
                (lead && done ? ` · vorn: ${lead.name} (${lead.score})` : '') })
      ),
      el('div', { class: 'gcard-right', text: fmtDate(g.updatedAt) })
    ));
  }
}

/* =========================================================
   Setup
   ========================================================= */
function newDraft() {
  return {
    name: '',
    players: [{ id: uid(), name: '' }, { id: uid(), name: '' }, { id: uid(), name: '' }],
    mode: 'updown',
    extraSingles: true,
    deck: 60,
    maxCards: 20,
    rounds: 10,
    fixedCards: 5,
    preset: 'wizard',
    scoring: { ...PRESETS.wizard.scoring },
    strictDealer: false
  };
}

function autoMax(draft) {
  if (!draft.deck) return draft.maxCards;
  return Math.max(1, Math.floor(draft.deck / Math.max(1, draft.players.length)));
}

function renderSetup() {
  const d = ui.draft;
  $('#appTitle').textContent = 'Neues Spiel';

  $('#setupName').value = d.name;
  $('#playerCount').textContent = `(${d.players.length})`;

  // Spielerzeilen
  const wrap = $('#setupPlayers');
  wrap.replaceChildren();
  d.players.forEach((p, i) => {
    wrap.append(el('div', { class: 'prow' },
      el('span', { class: 'idx', text: String(i + 1) }),
      el('input', {
        type: 'text', value: p.name, placeholder: `Spieler ${i + 1}`,
        autocomplete: 'off', maxlength: '20',
        oninput: e => { p.name = e.target.value; }
      }),
      d.players.length > 2
        ? el('button', { class: 'del', 'aria-label': 'Spieler entfernen', text: '×',
            onclick: () => { d.players.splice(i, 1); syncMax(); renderSetup(); } })
        : null
    ));
  });

  // Modus-Chips
  const modeBox = $('#setupMode');
  modeBox.replaceChildren();
  for (const [key, m] of Object.entries(MODES)) {
    modeBox.append(el('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(d.mode === key), text: m.label,
      onclick: () => { d.mode = key; renderSetup(); }
    }));
  }

  $('#cfgExtraSingles').checked = d.extraSingles;
  $('#setupDeck').value = String(d.deck);
  $('#setupMaxCards').value = String(d.maxCards);
  $('#setupRounds').value = String(d.rounds);
  $('#setupFixedCards').value = String(d.fixedCards);

  const isFixed = d.mode === 'fixed';
  $('#cfgExtraSingles').closest('.check').hidden = isFixed;
  $('#fixedWrap').hidden = !isFixed;
  $('#setupMaxCards').closest('.field').hidden = isFixed;
  $('#setupDeck').closest('.field').hidden = isFixed;

  $('#setupPreview').textContent = previewText();

  // Wertungs-Chips
  const pBox = $('#setupPreset');
  pBox.replaceChildren();
  for (const [key, p] of Object.entries(PRESETS)) {
    pBox.append(el('button', {
      class: 'chip', role: 'radio', 'aria-checked': String(d.preset === key), text: p.label,
      onclick: () => {
        d.preset = key;
        if (key !== 'custom') d.scoring = { ...PRESETS[key].scoring };
        renderSetup();
      }
    }));
  }
  $('#presetDesc').textContent = PRESETS[d.preset].desc;
  $('#customWrap').open = d.preset === 'custom';

  $('#cfgBonus').value = d.scoring.bonus;
  $('#cfgPerTrick').value = d.scoring.perTrick;
  $('#cfgPerDiff').value = d.scoring.perDiff;
  $('#cfgWrongBase').value = d.scoring.wrongBase;
  $('#cfgZeroFromCards').value = d.scoring.zeroFromCards ?? 0;
  $('#cfgZeroBonus').value = d.scoring.zeroBonus ?? 0;
  $('#cfgTricksWhenWrong').checked = d.scoring.tricksWhenWrong;
  $('#cfgLowestWins').checked = d.scoring.lowestWins;
  $('#formulaPreview').textContent = formulaText(d.scoring);

  $('#cfgStrictDealer').checked = d.strictDealer;
}

function formulaText(sc) {
  const a = `Richtig: ${sc.bonus} ${sc.perTrick >= 0 ? '+' : '−'} ${Math.abs(sc.perTrick)} × Stiche`;
  const b = `Falsch: ${sc.wrongBase} ${sc.perDiff >= 0 ? '+' : '−'} ${Math.abs(sc.perDiff)} × |Ansage − Stiche|` +
            (sc.tricksWhenWrong ? ` ${sc.perTrick >= 0 ? '+' : '−'} ${Math.abs(sc.perTrick)} × Stiche` : '');
  const c = sc.zeroFromCards > 0
    ? `  ·  ab ${sc.zeroFromCards} Karten: getroffene Ansage 0 = ${sc.zeroBonus} Punkte` : '';
  return a + '  ·  ' + b + c + (sc.lowestWins ? '  ·  wenigste Punkte gewinnen' : '');
}

function cfgFromDraft(d) {
  return { mode: d.mode, maxCards: d.maxCards, rounds: d.rounds, fixedCards: d.fixedCards,
           extraSingles: d.extraSingles, players: d.players.length };
}

function syncMax() {
  const d = ui.draft;
  if (d.deck) d.maxCards = autoMax(d);
}

function startGame() {
  const d = ui.draft;
  const players = d.players
    .map((p, i) => ({ id: p.id, name: (p.name || '').trim() || `Spieler ${i + 1}` }));

  if (players.length < 2) { toast('Mindestens 2 Spieler'); return; }
  const names = new Set(players.map(p => p.name.toLowerCase()));
  if (names.size !== players.length) { toast('Namen müssen eindeutig sein'); return; }

  const counts = buildCardCounts(cfgFromDraft(d));
  if (!counts.length) { toast('Keine Runden konfiguriert'); return; }

  const game = {
    id: uid(),
    name: (d.name || '').trim() || players.map(p => p.name).join(', '),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    players,
    scoring: { ...d.scoring },
    strictDealer: d.strictDealer,
    config: { ...cfgFromDraft(d), deck: d.deck, preset: d.preset },
    rounds: counts.map((cards, i) => ({
      cards,
      dealer: i % players.length,
      bids: {},
      tricks: {},
      done: false
    })),
    finished: false
  };

  store.games.push(game);
  saveStore();
  ui.gameId = game.id;
  ui.phase = 'bid';
  show('game');
}

/* =========================================================
   Rundeneingabe
   ========================================================= */
function activeRoundIndex(game) {
  const i = game.rounds.findIndex(r => !r.done);
  return i === -1 ? game.rounds.length - 1 : i;
}

function phaseForGame(game) {
  const r = game.rounds[activeRoundIndex(game)];
  if (!r) return 'bid';
  return bidsComplete(game, r) ? 'trick' : 'bid';
}

/** Ansagereihenfolge: links vom Geber beginnend, Geber zuletzt. */
function bidOrder(game, round) {
  const n = game.players.length;
  const out = [];
  for (let k = 1; k <= n; k++) out.push(game.players[(round.dealer + k) % n]);
  return out;
}

const bidsComplete   = (g, r) => g.players.every(p => Number.isInteger(r.bids[p.id]));
const tricksComplete = (g, r) => g.players.every(p => Number.isInteger(r.tricks[p.id]));
const sumOf = (g, map) => g.players.reduce((s, p) => s + (map[p.id] ?? 0), 0);

function renderGame() {
  const game = currentGame();
  if (!game) { show('home'); return; }

  $('#appTitle').textContent = game.name;

  const ri = activeRoundIndex(game);
  const round = game.rounds[ri];
  const allDone = game.rounds.every(r => r.done);

  if (allDone) { renderFinish(game); return; }

  $('#roundLabel').textContent = `Runde ${ri + 1} / ${game.rounds.length}`;
  $('#roundCards').textContent = round.cards === 1 ? '1 Karte' : `${round.cards} Karten`;
  $('#roundDealer').textContent =
    `Geber: ${game.players[round.dealer].name} · Ansage beginnt: ${bidOrder(game, round)[0].name}`;

  if (ui.phase === 'trick' && !bidsComplete(game, round)) ui.phase = 'bid';
  $('#tabBid').classList.toggle('on', ui.phase === 'bid');
  $('#tabTrick').classList.toggle('on', ui.phase === 'trick');
  $('#tabTrick').disabled = false;

  const list = $('#entryList');
  list.replaceChildren();

  const order = ui.phase === 'bid' ? bidOrder(game, round) : game.players;
  const map = ui.phase === 'bid' ? round.bids : round.tricks;

  order.forEach((p, idx) => {
    const isDealer = game.players[round.dealer].id === p.id;
    const blocked = new Set();

    if (ui.phase === 'bid' && game.strictDealer && isDealer) {
      // Geber darf die Summe nicht genau auf die Kartenzahl bringen
      const others = game.players
        .filter(x => x.id !== p.id)
        .reduce((s, x) => s + (round.bids[x.id] ?? 0), 0);
      const othersKnown = game.players
        .filter(x => x.id !== p.id)
        .every(x => Number.isInteger(round.bids[x.id]));
      if (othersKnown) {
        const forbidden = round.cards - others;
        if (forbidden >= 0 && forbidden <= round.cards) blocked.add(forbidden);
      }
    }

    const entry = el('div', { class: 'entry' + (isDealer ? ' dealer' : '') },
      el('div', { class: 'entry-head' },
        el('span', { class: 'entry-name', text: p.name }),
        el('span', { class: 'entry-meta',
          text: ui.phase === 'bid'
            ? (isDealer ? 'Geber · sagt zuletzt an' : `${idx + 1}. Ansage`)
            : `Ansage: ${round.bids[p.id] ?? '–'}` })
      ),
      el('div', { class: 'numgrid' },
        range(0, round.cards).map(v => el('button', {
          class: 'num' + (map[p.id] === v ? ' on' : ''),
          disabled: blocked.has(v) && map[p.id] !== v,
          text: String(v),
          onclick: () => {
            if (map[p.id] === v) delete map[p.id]; else map[p.id] = v;
            touch(game);
            renderGame();
          }
        }))
      )
    );
    list.append(entry);
  });

  updateSumBox(game, round);
}

function updateSumBox(game, round) {
  const box = $('#sumBox');
  const btn = $('#btnRoundNext');
  box.className = 'sumbox';
  box.replaceChildren();

  if (ui.phase === 'bid') {
    const sum = sumOf(game, round.bids);
    const complete = bidsComplete(game, round);
    const diff = sum - round.cards;
    let note;
    if (!complete) note = 'noch nicht alle Ansagen';
    else if (diff === 0) note = 'geht genau auf';
    else if (diff > 0) note = `${diff} zu viel angesagt`;
    else note = `${-diff} zu wenig angesagt`;

    box.append(el('b', { text: `Ansagen: ${sum} / ${round.cards}` }), note);
    if (complete && diff === 0) box.classList.add('warn');
    btn.textContent = 'Zu den Stichen';
    btn.disabled = !complete;
  } else {
    const sum = sumOf(game, round.tricks);
    const complete = tricksComplete(game, round);
    const ok = complete && sum === round.cards;
    box.append(el('b', { text: `Stiche: ${sum} / ${round.cards}` }),
      ok ? 'passt' : (complete ? 'Summe muss der Kartenzahl entsprechen' : 'noch nicht alle Stiche'));
    if (ok) box.classList.add('good');
    else if (complete) box.classList.add('bad');
    btn.textContent = 'Runde abschließen';
    btn.disabled = !ok;
  }
}

function nextStep() {
  const game = currentGame();
  const ri = activeRoundIndex(game);
  const round = game.rounds[ri];

  if (ui.phase === 'bid') {
    ui.phase = 'trick';
    renderGame();
    return;
  }

  round.done = true;
  // Restliche Runden mit fehlenden Ansagen unberührt lassen
  const allDone = game.rounds.every(r => r.done);
  game.finished = allDone;
  touch(game);

  if (allDone) {
    renderFinish(game);
  } else {
    ui.phase = 'bid';
    renderGame();
    const scores = ranking(game);
    toast(`Runde ${ri + 1} gespeichert · vorn: ${scores[0].name} (${scores[0].score})`);
  }
}

/* ---------- Abschlussansicht ---------- */
function renderFinish(game) {
  $('#roundLabel').textContent = 'Endstand';
  $('#roundCards').textContent = `${game.rounds.length} Runden`;
  $('#roundDealer').textContent = game.scoring.lowestWins
    ? 'Wenigste Punkte gewinnen' : 'Meiste Punkte gewinnen';
  $('#tabBid').classList.remove('on');
  $('#tabTrick').classList.remove('on');

  const rank = ranking(game);
  const list = $('#entryList');
  list.replaceChildren();

  const medal = ['🥇', '🥈', '🥉'];
  rank.forEach((r, i) => {
    list.append(el('div', { class: 'entry' },
      el('div', { class: 'entry-head' },
        el('span', { class: 'entry-name',
          text: `${r.place <= 3 ? medal[r.place - 1] : r.place + '.'} ${r.name}` }),
        el('span', { class: 'entry-meta', text: `${r.score} Punkte` })
      )
    ));
  });

  const stats = statsFor(game);
  list.append(el('div', { class: 'entry' },
    el('div', { class: 'entry-head' }, el('span', { class: 'entry-name', text: 'Trefferquote' })),
    ...stats.map(s => el('div', { class: 'gcard-sub',
      text: `${s.player.name}: ${s.hits} von ${s.played} Ansagen richtig (${s.quote} %)` }))
  ));

  $('#sumBox').className = 'sumbox';
  $('#sumBox').replaceChildren(el('b', { text: 'Spiel beendet' }), 'Runden lassen sich in der Tabelle korrigieren');
  const btn = $('#btnRoundNext');
  btn.textContent = 'Zur Tabelle';
  btn.disabled = false;
}

/* =========================================================
   Tabelle
   ========================================================= */
function renderTable() {
  const game = currentGame();
  if (!game) { show('home'); return; }

  $('#appTitle').textContent = game.name;

  const { perRound, totals } = computeTotals(game);
  const running = {};
  game.players.forEach(p => { running[p.id] = 0; });

  const table = $('#scoreTable');
  table.replaceChildren();

  const thead = el('thead');
  thead.append(el('tr',
    {},
    el('th', { class: 'rc', text: 'Runde' }),
    ...game.players.map(p => el('th', { text: p.name }))
  ));
  table.append(thead);

  const tbody = el('tbody');
  game.rounds.forEach((r, i) => {
    game.players.forEach(p => { if (r.done) running[p.id] += perRound[i][p.id]; });

    const tr = el('tr', {
      class: r.done ? '' : 'pending',
      onclick: () => openRoundSheet(i)
    },
      el('td', { class: 'rc' }, `${i + 1}`, el('span', { class: 'cell-sub', text: `${r.cards} K.` }))
    );

    for (const p of game.players) {
      if (!r.done) {
        tr.append(el('td', { text: '–' }));
        continue;
      }
      const bid = r.bids[p.id], tricks = r.tricks[p.id];
      const hit = bid === tricks;
      tr.append(el('td', { class: hit ? 'cell-hit' : 'cell-miss' },
        String(running[p.id]),
        el('span', { class: 'cell-sub', text: `${bid}/${tricks} · ${signed(perRound[i][p.id])}` })
      ));
    }
    tbody.append(tr);
  });
  table.append(tbody);

  const rank = ranking(game);
  const placeById = Object.fromEntries(rank.map(r => [r.id, r.place]));
  const tfoot = el('tfoot');
  tfoot.append(el('tr', { class: 'total' },
    el('td', { class: 'rc', text: 'Summe' }),
    ...game.players.map(p => el('td', { class: placeById[p.id] === 1 ? 'leader' : '' },
      String(totals[p.id]),
      el('span', { class: 'cell-sub', text: `${placeById[p.id]}. Platz` })
    ))
  ));
  table.append(tfoot);

  // Trefferquote
  const statsBox = $('#statsList');
  statsBox.replaceChildren();
  for (const s of statsFor(game)) {
    statsBox.append(el('div', { class: 'gcard', style: 'cursor:default' },
      el('div', { class: 'gcard-main' },
        el('div', { class: 'gcard-title', text: s.player.name }),
        el('div', { class: 'gcard-sub', text: `${s.hits} von ${s.played} Ansagen getroffen` })
      ),
      el('div', { class: 'gcard-right', text: s.played ? s.quote + ' %' : '–' })
    ));
  }

  $('#btnBackToGame').textContent = game.finished ? 'Zum Endstand' : 'Weiter spielen';
}

/* =========================================================
   Runde nachträglich bearbeiten
   ========================================================= */
function openRoundSheet(index) {
  const game = currentGame();
  const round = game.rounds[index];
  ui.sheetRound = {
    index,
    bids: { ...round.bids },
    tricks: { ...round.tricks }
  };

  $('#sheetTitle').textContent = `Runde ${index + 1} · ${round.cards} Karten`;
  renderSheet();
  $('#sheet').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeSheet() {
  $('#sheet').hidden = true;
  ui.sheetRound = null;
  document.body.style.overflow = '';
}

function renderSheet() {
  const game = currentGame();
  const s = ui.sheetRound;
  const round = game.rounds[s.index];
  const body = $('#sheetBody');
  body.replaceChildren();

  for (const p of game.players) {
    body.append(el('div', { class: 'entry' },
      el('div', { class: 'entry-head' },
        el('span', { class: 'entry-name', text: p.name }),
        el('span', { class: 'entry-meta',
          text: game.players[round.dealer].id === p.id ? 'Geber' : '' })
      ),
      el('div', { class: 'badge-bid', text: 'Ansage' }),
      el('div', { class: 'numgrid', style: 'margin:6px 0 10px' },
        range(0, round.cards).map(v => el('button', {
          class: 'num' + (s.bids[p.id] === v ? ' on' : ''), text: String(v),
          onclick: () => { s.bids[p.id] = v; renderSheet(); }
        }))
      ),
      el('div', { class: 'badge-bid', text: 'Stiche' }),
      el('div', { class: 'numgrid', style: 'margin-top:6px' },
        range(0, round.cards).map(v => el('button', {
          class: 'num' + (s.tricks[p.id] === v ? ' on' : ''), text: String(v),
          onclick: () => { s.tricks[p.id] = v; renderSheet(); }
        }))
      )
    ));
  }

  const sum = game.players.reduce((a, p) => a + (s.tricks[p.id] ?? 0), 0);
  body.append(el('p', { class: 'hint',
    text: `Summe der Stiche: ${sum} / ${round.cards}` +
          (sum === round.cards ? ' ✓' : ' — muss übereinstimmen') }));
}

function saveSheet() {
  const game = currentGame();
  const s = ui.sheetRound;
  const round = game.rounds[s.index];

  const complete = game.players.every(p =>
    Number.isInteger(s.bids[p.id]) && Number.isInteger(s.tricks[p.id]));
  const sum = game.players.reduce((a, p) => a + (s.tricks[p.id] ?? 0), 0);

  if (!complete) { toast('Bitte alle Werte setzen'); return; }
  if (sum !== round.cards) { toast(`Stiche ergeben ${sum}, erwartet ${round.cards}`); return; }

  round.bids = s.bids;
  round.tricks = s.tricks;
  round.done = true;
  game.finished = game.rounds.every(r => r.done);
  touch(game);
  closeSheet();
  renderTable();
  toast('Runde aktualisiert');
}

/* =========================================================
   Import / Export
   ========================================================= */
function exportData() {
  const blob = new Blob([JSON.stringify(store, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', {
    href: url,
    download: `stichansagen-${new Date().toISOString().slice(0, 10)}.json`
  });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result));
      if (!data || !Array.isArray(data.games)) throw new Error('Kein gültiger Export');
      const byId = new Map(store.games.map(g => [g.id, g]));
      let added = 0;
      for (const g of data.games) {
        if (!g || !g.id || byId.has(g.id)) continue;
        store.games.push(g);
        added++;
      }
      saveStore();
      renderHome();
      toast(added ? `${added} Spiel(e) importiert` : 'Nichts Neues gefunden');
    } catch (e) {
      toast('Datei konnte nicht gelesen werden');
    }
  };
  reader.readAsText(file);
}

/* =========================================================
   Theme
   ========================================================= */
function applyTheme(mode) {
  if (mode === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', mode);
  localStorage.setItem(THEME_KEY, mode);
}

function cycleTheme() {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = cur === 'auto' ? 'light' : cur === 'light' ? 'dark' : 'auto';
  applyTheme(next);
  toast('Design: ' + ({ auto: 'System', light: 'Hell', dark: 'Dunkel' })[next]);
}

/* =========================================================
   Ereignisse
   ========================================================= */
function bindEvents() {
  $('#btnTheme').onclick = cycleTheme;

  $('#btnBack').onclick = () => {
    if (ui.view === 'setup') { show('home'); return; }
    if (ui.view === 'table') { show('game'); return; }
    show('home');
  };

  $$('.tabbtn').forEach(b => { b.onclick = () => show(b.dataset.view); });

  // Home
  $('#btnNewGame').onclick = () => { ui.draft = newDraft(); syncMax(); show('setup'); };
  $('#btnExport').onclick = exportData;
  $('#btnImport').onclick = () => $('#fileImport').click();
  $('#fileImport').onchange = e => {
    const f = e.target.files[0];
    if (f) importData(f);
    e.target.value = '';
  };

  // Setup
  $('#setupName').oninput = e => { ui.draft.name = e.target.value; };
  $('#btnAddPlayer').onclick = () => {
    if (ui.draft.players.length >= 10) { toast('Maximal 10 Spieler'); return; }
    ui.draft.players.push({ id: uid(), name: '' });
    syncMax();
    renderSetup();
  };
  $('#setupDeck').onchange = e => {
    ui.draft.deck = Number(e.target.value);
    syncMax();
    renderSetup();
  };
  $('#setupMaxCards').oninput = e => {
    ui.draft.maxCards = Math.max(1, Math.min(30, Number(e.target.value) || 1));
    ui.draft.deck = 0;
    $('#setupDeck').value = '0';
    $('#setupPreview').textContent = previewText();
  };
  $('#setupRounds').oninput = e => {
    ui.draft.rounds = Math.max(1, Math.min(60, Number(e.target.value) || 1));
    $('#setupPreview').textContent = previewText();
  };
  $('#setupFixedCards').oninput = e => {
    ui.draft.fixedCards = Math.max(1, Math.min(30, Number(e.target.value) || 1));
    $('#setupPreview').textContent = previewText();
  };

  const scoreInputs = {
    '#cfgBonus': 'bonus', '#cfgPerTrick': 'perTrick',
    '#cfgPerDiff': 'perDiff', '#cfgWrongBase': 'wrongBase',
    '#cfgZeroFromCards': 'zeroFromCards', '#cfgZeroBonus': 'zeroBonus'
  };
  for (const [sel, key] of Object.entries(scoreInputs)) {
    $(sel).oninput = e => {
      ui.draft.scoring[key] = Number(e.target.value) || 0;
      ui.draft.preset = 'custom';
      $('#formulaPreview').textContent = formulaText(ui.draft.scoring);
      markPresetCustom();
    };
  }
  $('#cfgTricksWhenWrong').onchange = e => {
    ui.draft.scoring.tricksWhenWrong = e.target.checked;
    ui.draft.preset = 'custom'; markPresetCustom();
    $('#formulaPreview').textContent = formulaText(ui.draft.scoring);
  };
  $('#cfgLowestWins').onchange = e => {
    ui.draft.scoring.lowestWins = e.target.checked;
    ui.draft.preset = 'custom'; markPresetCustom();
    $('#formulaPreview').textContent = formulaText(ui.draft.scoring);
  };
  $('#cfgExtraSingles').onchange = e => {
    ui.draft.extraSingles = e.target.checked;
    $('#setupPreview').textContent = previewText();
  };
  $('#cfgStrictDealer').onchange = e => { ui.draft.strictDealer = e.target.checked; };

  $('#btnCancelSetup').onclick = () => show('home');
  $('#btnStartGame').onclick = startGame;

  // Spiel
  $('#tabBid').onclick   = () => { ui.phase = 'bid'; renderGame(); };
  $('#tabTrick').onclick = () => {
    const g = currentGame();
    const r = g.rounds[activeRoundIndex(g)];
    if (!bidsComplete(g, r)) { toast('Erst alle Ansagen erfassen'); return; }
    ui.phase = 'trick';
    renderGame();
  };
  $('#btnRoundNext').onclick = () => {
    const g = currentGame();
    if (g.rounds.every(r => r.done)) { show('table'); return; }
    nextStep();
  };

  // Tabelle
  $('#btnBackToGame').onclick = () => show('game');
  $('#btnDeleteGame').onclick = () => {
    const g = currentGame();
    if (!g) return;
    if (!confirm(`„${g.name}" endgültig löschen?`)) return;
    store.games = store.games.filter(x => x.id !== g.id);
    saveStore();
    ui.gameId = null;
    show('home');
    toast('Spiel gelöscht');
  };

  // Sheet
  $$('#sheet [data-close]').forEach(n => n.onclick = closeSheet);
  $('#btnSheetSave').onclick = saveSheet;
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet();
  });
}

function markPresetCustom() {
  $$('#setupPreset .chip').forEach(c =>
    c.setAttribute('aria-checked', String(c.textContent === PRESETS.custom.label)));
  $('#presetDesc').textContent = PRESETS.custom.desc;
}

function previewText() {
  const d = ui.draft;
  const counts = buildCardCounts(cfgFromDraft(d));
  const preview = counts.length > 12
    ? counts.slice(0, 6).join(', ') + ' … ' + counts.slice(-4).join(', ')
    : counts.join(', ');
  const n = extraSingleRounds(cfgFromDraft(d));
  const extra = n > 0 ? ` (davon ${n} Einer-Runden zum Schluss)` : '';
  return `${counts.length} Runden${extra} · Karten je Runde: ${preview}`;
}

/* =========================================================
   Start
   ========================================================= */
applyTheme(localStorage.getItem(THEME_KEY) || 'auto');
bindEvents();
show('home');

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}
