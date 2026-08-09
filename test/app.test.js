const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const DIR = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8')
  .replace('<script src="app.js"></script>', '');

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
ok($('#setupPreview').textContent.includes('2 Runden'), 'Vorschau: ' + $('#setupPreview').textContent);

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

console.log('\n== Null-Ansage-Bonus ab Runde 7 (Preset Klassisch) ==');
const kl = { bonus: 10, perTrick: 1, perDiff: -1, wrongBase: 0,
             tricksWhenWrong: false, lowestWins: false, zeroFromRound: 7, zeroBonus: 20 };
ok(rs(0, 0, kl, 6) === 10, 'Runde 6: 0 angesagt und getroffen = 10 (normale Formel)');
ok(rs(0, 0, kl, 7) === 20, 'Runde 7: 0 angesagt und getroffen = 20');
ok(rs(0, 0, kl, 12) === 20, 'Runde 12: weiterhin 20');
ok(rs(0, 2, kl, 9) === -2, 'Runde 9: 0 angesagt, 2 gemacht = -2 (Bonus greift nicht)');
ok(rs(2, 2, kl, 9) === 12, 'Runde 9: 2 angesagt und getroffen = 12 (unverändert)');
ok(rs(1, 1, kl, 9) === 11, 'Runde 9: 1 angesagt und getroffen = 11 (unverändert)');
const wizNoZero = { ...wiz, zeroFromRound: 0, zeroBonus: 0 };
ok(rs(0, 0, wizNoZero, 9) === 20, 'Wizard ohne Sonderregel unverändert 20');
// Altbestand ohne die neuen Felder darf nicht umkippen
ok(rs(0, 0, wiz, 9) === 20, 'alter Spielstand ohne zeroFromRound bleibt bei 20');

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
cclick(cqa('#setupMode .chip').find(c => c.textContent === 'Feste Runden'));
cset(cq('#setupRounds'), '7');
cset(cq('#setupFixedCards'), '1');
cclick(cqa('#setupPreset .chip').find(c => c.textContent === 'Klassisch'));
ok(cq('#presetDesc').textContent.includes('Ab Runde 7'), 'Preset-Beschreibung nennt die Regel');
ok(cq('#cfgZeroFromRound').value === '7' && cq('#cfgZeroBonus').value === '20',
   'Formularfelder vorbelegt: ab Runde ' + cq('#cfgZeroFromRound').value + ' / ' + cq('#cfgZeroBonus').value + ' Punkte');
cclick(cq('#btnStartGame'));

// 7 Runden à 1 Karte: Eva sagt immer 0 und macht 0, Finn sagt 1 und macht 1
for (let r = 1; r <= 7; r++) {
  const first = cqa('#entryList .entry');
  first.forEach(entry => {
    const name = entry.querySelector('.entry-name').textContent;
    const want = name === 'Eva' ? 0 : 1;
    cclick(Array.from(entry.querySelectorAll('.num')).find(b => b.textContent === String(want)));
  });
  cclick(cq('#btnRoundNext'));            // zu den Stichen
  cqa('#entryList .entry').forEach(entry => {
    const name = entry.querySelector('.entry-name').textContent;
    const want = name === 'Eva' ? 0 : 1;
    cclick(Array.from(entry.querySelectorAll('.num')).find(b => b.textContent === String(want)));
  });
  cclick(cq('#btnRoundNext'));            // Runde abschließen
}
cclick(cqa('.tabbtn').find(b => b.dataset.view === 'table'));
const heads2 = Array.from(cq('#scoreTable').querySelectorAll('thead th')).map(t => t.textContent);
const tot = Array.from(cq('#scoreTable').querySelectorAll('tfoot td')).slice(1)
  .map(td => parseInt(td.firstChild.nodeValue, 10));
const evaIdx = heads2.indexOf('Eva') - 1;
// Eva: Runden 1-6 je 10, Runde 7 = 20 -> 80 | Finn: 7 x (10+1) = 77
ok(tot[evaIdx] === 80, 'Eva 6x10 + 20 in Runde 7 = 80 → ' + tot[evaIdx]);
ok(tot[1 - evaIdx] === 77, 'Finn 7x11 = 77 (unberührt) → ' + tot[1 - evaIdx]);
const rows = Array.from(cq('#scoreTable').querySelectorAll('tbody tr'));
const cellR7 = rows[6].querySelectorAll('td')[evaIdx + 1];
ok(cellR7.querySelector('.cell-sub').textContent.includes('+20'), 'Runde 7 zeigt +20: '
   + cellR7.querySelector('.cell-sub').textContent);
const cellR6 = rows[5].querySelectorAll('td')[evaIdx + 1];
ok(cellR6.querySelector('.cell-sub').textContent.includes('+10'), 'Runde 6 zeigt +10: '
   + cellR6.querySelector('.cell-sub').textContent);

console.log('\n== Sichtbarkeit: [hidden] gegen eigene display-Regeln ==');
// styles.css inline einspielen, damit getComputedStyle die Kaskade sieht.
const css = fs.readFileSync(path.join(DIR, 'styles.css'), 'utf8');
const html4 = html.replace('</head>', '<style>' + css + '</style></head>')
                  .replace('<link rel="stylesheet" href="styles.css">', '');
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
