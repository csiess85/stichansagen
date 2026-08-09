const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
  .replace(/<script src="app\.js[^"]*"><\/script>/, '');

let failed = 0;
function ok(cond, msg) {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) failed++;
}

const dom = new JSDOM(html, {
  url: 'https://example.com/stichansagen/',
  runScripts: 'outside-only',
  pretendToBeVisual: true
});
const { window } = dom;
window.confirm = () => true;
window.scrollTo = () => {};

// app.js im jsdom-Kontext ausführen
window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));

const doc = window.document;
const $ = s => doc.querySelector(s);
const $$ = s => Array.from(doc.querySelectorAll(s));
const click = n => n.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const setVal = (n, v) => { n.value = v; n.dispatchEvent(new window.Event('input', { bubbles: true })); };
const visible = id => !$(id).hidden;

console.log('\n== Start ==');
ok(visible('#screen-home'), 'Startbildschirm sichtbar');
ok($('#listRunning').textContent.includes('Noch kein laufendes'), 'Leerer Zustand angezeigt');

console.log('\n== Setup ==');
click($('#btnNewGame'));
ok(visible('#screen-setup'), 'Setup geöffnet');
setVal($('#setupName'), 'Testrunde');
const inputs = $$('#setupPlayers input');
ok(inputs.length === 3, 'drei Spielerzeilen als Vorgabe');
['Anna', 'Ben', 'Clara'].forEach((n, i) => setVal(inputs[i], n));
click($('#btnAddPlayer'));
setVal($$('#setupPlayers input')[3], 'Dora');
ok($$('#setupPlayers input').length === 4, 'vierter Spieler hinzugefügt');
ok($('#setupMaxCards').value === '15', 'max. Karten aus Deckgröße 60/4 = 15, ist ' + $('#setupMaxCards').value);

// Kleines Spiel: feste Runden, 2 Runden à 2 Karten
const modeChips = $$('#setupMode .chip');
click(modeChips.find(c => c.textContent === 'Feste Runden'));
setVal($('#setupRounds'), '2');
setVal($('#setupFixedCards'), '2');
$('#cfgExtraSingles').checked = false;
$('#cfgExtraSingles').dispatchEvent(new window.Event('change', { bubbles: true }));
ok($('#setupPreview').textContent.startsWith('2 Runden ·'), 'Vorschau: ' + $('#setupPreview').textContent);

const presetChips = $$('#setupPreset .chip');
click(presetChips.find(c => c.textContent === 'Wizard'));
$('#cfgStrictDealer').checked = true;
$('#cfgStrictDealer').dispatchEvent(new window.Event('change', { bubbles: true }));

click($('#btnStartGame'));
ok(visible('#screen-game'), 'Spiel gestartet');
ok($('#roundLabel').textContent === 'Runde 1 / 2', 'Runde 1/2, ist: ' + $('#roundLabel').textContent);
ok($('#roundCards').textContent === '2 Karten', 'Kartenzahl angezeigt');

console.log('\n== Runde 1: Ansagen ==');
// Geber ist Spieler 1 (Anna, index 0) -> Ansagereihenfolge Ben, Clara, Dora, Anna
const firstEntry = $$('#entryList .entry')[0];
ok(firstEntry.querySelector('.entry-name').textContent === 'Ben', 'Ansage beginnt links vom Geber: ' + firstEntry.querySelector('.entry-name').textContent);
const lastEntry = $$('#entryList .entry')[3];
ok(lastEntry.classList.contains('dealer'), 'Geber sagt zuletzt an');

function pick(entryIdx, value) {
  const entry = $$('#entryList .entry')[entryIdx];
  const btn = Array.from(entry.querySelectorAll('.num')).find(b => b.textContent === String(value));
  if (!btn) throw new Error('Knopf ' + value + ' nicht gefunden');
  click(btn);
  return btn;
}
// Ben 1, Clara 1, Dora 0  -> Summe 2 = Kartenzahl -> Anna darf 0 nicht wählen
pick(0, 1); pick(1, 1); pick(2, 0);
const annaEntry = $$('#entryList .entry')[3];
const zeroBtn = Array.from(annaEntry.querySelectorAll('.num')).find(b => b.textContent === '0');
ok(zeroBtn.disabled, 'Geber-Regel: verbotene Ansage 0 ist gesperrt');
ok($('#btnRoundNext').disabled, 'Weiter noch gesperrt, Ansage fehlt');
pick(3, 1);
ok(!$('#btnRoundNext').disabled, 'Weiter frei nach allen Ansagen');
ok($('#sumBox').textContent === 'Ansagen: 3 / 21 zu viel angesagt',
   'Summenanzeige ohne Textreste: ' + JSON.stringify($('#sumBox').textContent));

console.log('\n== Runde 1: Stiche ==');
click($('#btnRoundNext'));
ok($('#tabTrick').classList.contains('on'), 'Phase Stiche aktiv');
// Anna 1, Ben 1, Clara 0, Dora 0 -> Summe 2 ✓
pick(0, 1); pick(1, 1); pick(2, 0); pick(3, 0);
ok(!$('#btnRoundNext').disabled, 'Abschließen möglich bei korrekter Stichsumme');
click($('#btnRoundNext'));
ok($('#roundLabel').textContent === 'Runde 2 / 2', 'Runde 2 begonnen');
ok($('#roundDealer').textContent.startsWith('Geber: Ben'), 'Geber rotiert: ' + $('#roundDealer').textContent);

console.log('\n== Punkte prüfen ==');
// Runde 1: Anna 1/1 richtig -> 20+10=30 | Ben 1/1 richtig -> 30
// Clara 1/0 falsch -> -10 | Dora 0/0 richtig -> 20+0=20
click($$('.tabbtn').find(b => b.dataset.view === 'table'));
ok(visible('#screen-table'), 'Tabelle sichtbar');
const readTotals = () => Array.from($('#scoreTable').querySelectorAll('tfoot td')).slice(1)
  .map(td => parseInt(td.firstChild.nodeValue, 10));
const totals = readTotals();
ok(JSON.stringify(totals) === JSON.stringify([30, 30, -10, 20]),
   'Summen Anna/Ben/Clara/Dora = 30,30,-10,20 → ' + totals.join(','));
const heads = Array.from($('#scoreTable').querySelectorAll('thead th')).map(t => t.textContent);
ok(JSON.stringify(heads) === JSON.stringify(['Runde', 'Anna', 'Ben', 'Clara', 'Dora']), 'Kopfzeile korrekt');
const quoten = Array.from($$('#statsList .gcard-right')).map(n => n.textContent);
ok(JSON.stringify(quoten) === JSON.stringify(['100 %','100 %','0 %','100 %']),
   'Trefferquoten → ' + quoten.join(', '));

console.log('\n== Runde nachträglich korrigieren ==');
click($('#scoreTable').querySelector('tbody tr'));
ok(!$('#sheet').hidden, 'Bearbeiten-Sheet geöffnet');
// Clara auf 0 angesagt setzen -> richtig -> +20 statt -10
const claraBlock = $$('#sheetBody .entry')[2];
const claraBidBtns = Array.from(claraBlock.querySelectorAll('.numgrid'))[0].querySelectorAll('.num');
click(Array.from(claraBidBtns).find(b => b.textContent === '0'));
click($('#btnSheetSave'));
ok($('#sheet').hidden, 'Sheet nach Speichern geschlossen');
const totals2 = readTotals();
ok(JSON.stringify(totals2) === JSON.stringify([30, 30, 20, 20]), 'Clara korrigiert auf 20 → ' + totals2.join(','));

console.log('\n== Persistenz ==');
const raw = window.localStorage.getItem('stichansagen.v1');
ok(!!raw, 'localStorage geschrieben');
const parsed = JSON.parse(raw);
ok(parsed.games.length === 1 && parsed.games[0].name === 'Testrunde', 'Spiel gespeichert');
ok(parsed.games[0].rounds[0].done === true && parsed.games[0].rounds[1].done === false,
   'Rundenstatus gespeichert');

console.log('\n== Neuladen ==');
const dom2 = new JSDOM(html, { url: 'https://example.com/stichansagen/', runScripts: 'outside-only', pretendToBeVisual: true });
dom2.window.scrollTo = () => {};
dom2.window.localStorage.setItem('stichansagen.v1', raw);
dom2.window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
const d2 = dom2.window.document;
ok(d2.querySelector('#listRunning').textContent.includes('Testrunde'), 'Spiel nach Reload in Liste');
ok(d2.querySelector('#listRunning').textContent.includes('Runde 2/2'), 'Fortschritt nach Reload: '
   + d2.querySelector('#listRunning .gcard-sub').textContent);
// Fortsetzen
d2.querySelector('#listRunning .gcard').dispatchEvent(new dom2.window.MouseEvent('click', { bubbles: true }));
ok(!d2.querySelector('#screen-game').hidden, 'Spiel fortgesetzt');
ok(d2.querySelector('#roundLabel').textContent === 'Runde 2 / 2', 'richtige Runde geladen');

console.log('\n== Rundenverläufe ==');
const dom3 = new JSDOM(html, { url: 'https://example.com/x/', runScripts: 'outside-only' });
dom3.window.scrollTo = () => {};
// 'use strict' kapselt eval – Funktionen gezielt herausreichen
const api = dom3.window.eval(
  fs.readFileSync(path.join(DIR, 'app.js'), 'utf8') +
  '\n;({ buildCardCounts, roundScore })');
const bcc = api.buildCardCounts;
ok(JSON.stringify(bcc({ mode: 'updown', maxCards: 4 })) === '[1,2,3,4,3,2,1]', 'auf und ab');
ok(JSON.stringify(bcc({ mode: 'up', maxCards: 3 })) === '[1,2,3]', 'aufsteigend');
ok(JSON.stringify(bcc({ mode: 'down', maxCards: 3 })) === '[3,2,1]', 'absteigend');
ok(JSON.stringify(bcc({ mode: 'downup', maxCards: 3 })) === '[3,2,1,2,3]', 'ab und auf');
ok(JSON.stringify(bcc({ mode: 'fixed', rounds: 3, fixedCards: 5 })) === '[5,5,5]', 'feste Runden');
ok(JSON.stringify(bcc({ mode: 'updown', maxCards: 1 })) === '[1]', 'Sonderfall max=1');

console.log('\n== Zusätzliche Einer-Runden je Spieler ==');
ok(JSON.stringify(bcc({ mode: 'updown', maxCards: 5, extraSingles: true, players: 4 }))
   === '[1,2,3,4,5,4,3,2,1,1,1,1,1]', '4 Spieler, max 5: 9 + 4 Einer-Runden → '
   + bcc({ mode: 'updown', maxCards: 5, extraSingles: true, players: 4 }).join(','));
ok(bcc({ mode: 'updown', maxCards: 5, extraSingles: true, players: 4 }).length === 13,
   'insgesamt 13 Runden');
ok(bcc({ mode: 'updown', maxCards: 5, extraSingles: true, players: 6 }).length === 15,
   '6 Spieler: 9 + 6 = 15 Runden');
ok(bcc({ mode: 'updown', maxCards: 5, extraSingles: true, players: 4 }).slice(-4)
   .every(c => c === 1), 'die letzten 4 Runden haben genau eine Karte');
ok(JSON.stringify(bcc({ mode: 'updown', maxCards: 5, extraSingles: false, players: 4 }))
   === '[1,2,3,4,5,4,3,2,1]', 'ohne Option unverändert');
ok(JSON.stringify(bcc({ mode: 'up', maxCards: 3, extraSingles: true, players: 3 }))
   === '[1,2,3,1,1,1]', 'greift auch bei aufsteigend');
ok(JSON.stringify(bcc({ mode: 'updown', maxCards: 5, extraSingles: true }))
   === '[1,2,3,4,5,4,3,2,1]', 'ohne Spielerzahl (alter Spielstand) unverändert');
ok(bcc({ mode: 'fixed', rounds: 10, fixedCards: 5, extraSingles: true, players: 4 }).length === 10,
   'bei "Feste Runden" bleibt die eingestellte Rundenzahl unangetastet');

const rs = api.roundScore;
const wiz = { bonus: 20, perTrick: 10, perDiff: -10, wrongBase: 0, tricksWhenWrong: false };
ok(rs(3, 3, wiz) === 50, 'Wizard richtig 3 Stiche = 50');
ok(rs(0, 0, wiz) === 20, 'Wizard richtig 0 Stiche = 20');
ok(rs(3, 0, wiz) === -30, 'Wizard 3 daneben = -30');
const diffOnly = { bonus: 0, perTrick: 0, perDiff: 1, wrongBase: 0, tricksWhenWrong: false };
ok(rs(2, 5, diffOnly) === 3, 'Nur-Differenz-Regel = 3');
const plusBonus = { bonus: 10, perTrick: 1, perDiff: 0, wrongBase: 0, tricksWhenWrong: true };
ok(rs(2, 4, plusBonus) === 4, 'Stiche+Bonus bei falsch = 4');
ok(rs(4, 4, plusBonus) === 14, 'Stiche+Bonus bei richtig = 14');

console.log('\n== Null-Ansage-Bonus ab 7 Karten (Preset Klassisch) ==');
const kl = { bonus: 10, perTrick: 1, perDiff: -1, wrongBase: 0,
             tricksWhenWrong: false, lowestWins: false, zeroFromCards: 7, zeroBonus: 20 };
ok(rs(0, 0, kl, 6) === 10, '6 Karten: 0 angesagt und getroffen = 10 (normale Formel)');
ok(rs(0, 0, kl, 7) === 20, '7 Karten: 0 angesagt und getroffen = 20');
ok(rs(0, 0, kl, 12) === 20, '12 Karten: weiterhin 20');
ok(rs(0, 0, kl, 1) === 10, '1 Karte: normale 10 Punkte');
ok(rs(0, 2, kl, 9) === -2, '9 Karten: 0 angesagt, 2 gemacht = -2 (Bonus greift nicht)');
ok(rs(2, 2, kl, 9) === 12, '9 Karten: 2 angesagt und getroffen = 12 (unverändert)');
ok(rs(1, 1, kl, 9) === 11, '9 Karten: 1 angesagt und getroffen = 11 (unverändert)');
const wizNoZero = { ...wiz, zeroFromCards: 0, zeroBonus: 0 };
ok(rs(0, 0, wizNoZero, 9) === 20, 'Wizard ohne Sonderregel unverändert 20');
// Altbestand ohne die neuen Felder darf nicht umkippen
ok(rs(0, 0, wiz, 9) === 20, 'alter Spielstand ohne zeroFromCards bleibt bei 20');

console.log('\n== Sonderregel im echten Spielverlauf ==');
const clean = new JSDOM(html, { url: 'https://example.com/y/', runScripts: 'outside-only', pretendToBeVisual: true });
clean.window.scrollTo = () => {};
clean.window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
const cd = clean.window.document;
const cq = sel => cd.querySelector(sel);
const cqa = sel => Array.from(cd.querySelectorAll(sel));
const cclick = n => n.dispatchEvent(new clean.window.MouseEvent('click', { bubbles: true }));
const cset = (n, v) => { n.value = v; n.dispatchEvent(new clean.window.Event('input', { bubbles: true })); };

cclick(cq('#btnNewGame'));
['Eva', 'Finn'].forEach((n, i) => cset(cqa('#setupPlayers input')[i], n));
cclick(cqa('#setupPlayers .del')[2]);          // dritten Spieler entfernen -> 2 Spieler
cclick(cqa('#setupMode .chip').find(c => c.textContent === 'Aufsteigend'));
cq('#cfgExtraSingles').checked = false;
cq('#cfgExtraSingles').dispatchEvent(new clean.window.Event('change', { bubbles: true }));
cset(cq('#setupMaxCards'), '8');           // Runden mit 1..8 Karten
cclick(cqa('#setupPreset .chip').find(c => c.textContent === 'Klassisch'));
ok(cq('#presetDesc').textContent.includes('Ab 7 Karten'), 'Preset-Beschreibung nennt die Regel');
ok(cq('#cfgZeroFromCards').value === '7' && cq('#cfgZeroBonus').value === '20',
   'Formularfelder vorbelegt: ab ' + cq('#cfgZeroFromCards').value + ' Karten / ' + cq('#cfgZeroBonus').value + ' Punkte');
cclick(cq('#btnStartGame'));

// 8 Runden mit 1..8 Karten: Eva sagt immer 0 und macht 0, Finn nimmt alle Stiche
for (let cards = 1; cards <= 8; cards++) {
  for (const phase of [0, 1]) {
    cqa('#entryList .entry').forEach(entry => {
      const name = entry.querySelector('.entry-name').textContent;
      const want = name === 'Eva' ? 0 : cards;
      cclick(Array.from(entry.querySelectorAll('.num')).find(b => b.textContent === String(want)));
    });
    cclick(cq('#btnRoundNext'));          // erst zu den Stichen, dann abschließen
  }
}
cclick(cqa('.tabbtn').find(b => b.dataset.view === 'table'));
const heads2 = Array.from(cq('#scoreTable').querySelectorAll('thead th')).map(t => t.textContent);
const tot = Array.from(cq('#scoreTable').querySelectorAll('tfoot td')).slice(1)
  .map(td => parseInt(td.firstChild.nodeValue, 10));
const evaIdx = heads2.indexOf('Eva') - 1;
// Eva: 1-6 Karten je 10 = 60, 7 und 8 Karten je 20 = 40 -> 100
// Finn: 10 + Kartenzahl je Runde = 8x10 + (1+..+8) = 80 + 36 = 116
ok(tot[evaIdx] === 100, 'Eva 6x10 + 2x20 = 100 → ' + tot[evaIdx]);
ok(tot[1 - evaIdx] === 116, 'Finn 8x10 + 36 Stiche = 116 (unberührt) → ' + tot[1 - evaIdx]);
const rows = Array.from(cq('#scoreTable').querySelectorAll('tbody tr'));
const sub = i => rows[i].querySelectorAll('td')[evaIdx + 1].querySelector('.cell-sub').textContent;
ok(sub(5).includes('+10'), 'Runde mit 6 Karten zeigt +10: ' + sub(5));
ok(sub(6).includes('+20'), 'Runde mit 7 Karten zeigt +20: ' + sub(6));
ok(sub(7).includes('+20'), 'Runde mit 8 Karten zeigt +20: ' + sub(7));

console.log('\n== Migration alter Spielstände ==');
const alt = JSON.parse(clean.window.localStorage.getItem('stichansagen.v1'));
alt.games[0].scoring = { bonus: 10, perTrick: 1, perDiff: -1, wrongBase: 0,
                         tricksWhenWrong: false, lowestWins: false,
                         zeroFromRound: 7, zeroBonus: 20 };
const dom6 = new JSDOM(html, { url: 'https://example.com/m/', runScripts: 'outside-only', pretendToBeVisual: true });
dom6.window.scrollTo = () => {};
dom6.window.localStorage.setItem('stichansagen.v1', JSON.stringify(alt));
dom6.window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
const mig = JSON.parse(dom6.window.localStorage.getItem('stichansagen.v1'));
const migScoring = JSON.parse(JSON.stringify(alt.games[0].scoring));
dom6.window.document.querySelector('#listFinished .gcard, #listRunning .gcard')
  .dispatchEvent(new dom6.window.MouseEvent('click', { bubbles: true }));
const mg = dom6.window.document;
ok(migScoring.zeroFromRound === 7, 'Ausgangsstand nutzte noch zeroFromRound');
const loaded = mg.querySelector('#scoreTable') ? true : false;
ok(loaded, 'altes Spiel lässt sich öffnen');
const totM = Array.from(mg.querySelectorAll('#scoreTable tfoot td')).slice(1)
  .map(td => parseInt(td.firstChild.nodeValue, 10));
ok(totM.includes(100), 'migriert: Wert wird als Kartenzahl gelesen, Eva wieder 100 → ' + totM.join(','));

console.log('\n== Einer-Runden im Setup ==');
const dom5 = new JSDOM(html, { url: 'https://example.com/z/', runScripts: 'outside-only', pretendToBeVisual: true });
dom5.window.scrollTo = () => {};
dom5.window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
const d5 = dom5.window.document;
const q5 = sel => d5.querySelector(sel);
const qa5 = sel => Array.from(d5.querySelectorAll(sel));
const c5 = n => n.dispatchEvent(new dom5.window.MouseEvent('click', { bubbles: true }));
const s5 = (n, v) => { n.value = v; n.dispatchEvent(new dom5.window.Event('input', { bubbles: true })); };

c5(q5('#btnNewGame'));
ok(q5('#cfgExtraSingles').checked === true, 'Option bei "Auf und ab" standardmäßig aktiv');
['A', 'B', 'C'].forEach((n, i) => s5(qa5('#setupPlayers input')[i], n));
s5(q5('#setupMaxCards'), '3');            // 3 Spieler, max 3 -> 1,2,3,2,1 + 1,1,1
ok(q5('#setupPreview').textContent === '8 Runden (davon 3 Einer-Runden zum Schluss) · Karten je Runde: 1, 2, 3, 2, 1, 1, 1, 1',
   'Vorschau: ' + q5('#setupPreview').textContent);
c5(q5('#btnAddPlayer'));                   // 4. Spieler -> eine Einer-Runde mehr
s5(qa5('#setupPlayers input')[3], 'D');
ok(q5('#setupPreview').textContent.startsWith('9 Runden (davon 4 Einer-Runden'),
   'Spielerzahl wirkt sofort: ' + q5('#setupPreview').textContent);
q5('#cfgExtraSingles').checked = false;
q5('#cfgExtraSingles').dispatchEvent(new dom5.window.Event('change', { bubbles: true }));
ok(q5('#setupPreview').textContent === '5 Runden · Karten je Runde: 1, 2, 3, 2, 1',
   'abschaltbar: ' + q5('#setupPreview').textContent);
q5('#cfgExtraSingles').checked = true;
q5('#cfgExtraSingles').dispatchEvent(new dom5.window.Event('change', { bubbles: true }));

c5(q5('#btnStartGame'));
const g5 = JSON.parse(dom5.window.localStorage.getItem('stichansagen.v1')).games[0];
ok(g5.rounds.length === 9, 'Spiel hat 9 Runden');
ok(JSON.stringify(g5.rounds.map(r => r.cards)) === '[1,2,3,2,1,1,1,1,1]',
   'Kartenfolge gespeichert: ' + g5.rounds.map(r => r.cards).join(','));
ok(JSON.stringify(g5.rounds.slice(-4).map(r => r.dealer)) === '[1,2,3,0]',
   'Geber rotiert auch in den Einer-Runden weiter: ' + g5.rounds.slice(-4).map(r => r.dealer).join(','));
ok(new Set(g5.rounds.slice(-4).map(r => r.dealer)).size === 4,
   'in den 4 Einer-Runden gibt jeder Spieler genau einmal');

// Checkbox bei "Feste Runden" ausgeblendet und ohne Wirkung
c5(qa5('#setupMode .chip').find(c => c.textContent === 'Feste Runden'));
ok(q5('#cfgExtraSingles').closest('.check').hidden === true,
   'Option bei "Feste Runden" ausgeblendet');
s5(q5('#setupRounds'), '10'); s5(q5('#setupFixedCards'), '5');
ok(q5('#setupPreview').textContent.startsWith('10 Runden ·'),
   'eingestellte Rundenzahl gilt unverändert: ' + q5('#setupPreview').textContent);
c5(qa5('#setupMode .chip').find(c => c.textContent === 'Auf und ab'));
ok(q5('#cfgExtraSingles').closest('.check').hidden === false,
   'Option bei "Auf und ab" wieder sichtbar');

console.log('\n== Versionsstempel (gegen alte Dateien aus dem Browser-Cache) ==');
const idxSrc = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const appSrc = fs.readFileSync(path.join(DIR, 'app.js'), 'utf8');
const swSrc  = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
const vApp   = (appSrc.match(/const APP_VERSION = '(\d+)'/) || [])[1];
const vCache = (swSrc.match(/stichansagen-v(\d+)/) || [])[1];
const vLinks = [...idxSrc.matchAll(/(?:styles\.css|app\.js)\?v=(\d+)/g)].map(m => m[1]);
const vSwAss = [...swSrc.matchAll(/(?:styles\.css|app\.js)\?v=(\d+)/g)].map(m => m[1]);
ok(vApp !== undefined, 'app.js hat APP_VERSION: ' + vApp);
ok(vLinks.length === 2, 'index.html stempelt beide Assets: ' + vLinks.join(','));
ok(vSwAss.length === 2, 'sw.js listet beide Assets gestempelt: ' + vSwAss.join(','));
ok(new Set([vApp, vCache, ...vLinks, ...vSwAss]).size === 1,
   `alle Versionsangaben identisch (app=${vApp}, cache=${vCache}, html=${vLinks.join('/')}, sw=${vSwAss.join('/')})`);
ok(d2.querySelector('#appVersion') !== null, 'Version wird auf dem Startbildschirm angezeigt');

console.log('\n== Sichtbarkeit: [hidden] gegen eigene display-Regeln ==');
// styles.css inline einspielen, damit getComputedStyle die Kaskade sieht.
const css = fs.readFileSync(path.join(DIR, 'styles.css'), 'utf8');
const html4 = html.replace('</head>', '<style>' + css + '</style></head>')
                  .replace(/<link rel="stylesheet" href="styles\.css[^"]*">/, '');
const dom4 = new JSDOM(html4, { url: 'https://example.com/x/', runScripts: 'outside-only', pretendToBeVisual: true });
dom4.window.scrollTo = () => {};
dom4.window.eval(fs.readFileSync(path.join(DIR, 'app.js'), 'utf8'));
const d4 = dom4.window.document;
const disp = sel => dom4.window.getComputedStyle(d4.querySelector(sel)).display;
for (const sel of ['#sheet', '#tabbar', '#screen-setup', '#screen-game', '#screen-table']) {
  ok(disp(sel) === 'none', `${sel} beim Start unsichtbar (display: ${disp(sel)})`);
}
ok(disp('#screen-home') !== 'none', 'Startbildschirm sichtbar (display: ' + disp('#screen-home') + ')');

console.log('\n' + (failed ? `${failed} Test(s) fehlgeschlagen` : 'Alle Tests bestanden'));
process.exit(failed ? 1 : 0);
