'use strict';
/*
 * najdi-tapnut.cjs — цели тапа по дереву uiautomator (задача 3.24,
 * Т11.3): навигация «Айкидо без сети» без привязки к пикселям.
 *
 *   node proverka/najdi-tapnut.cjs <ui.xml> <подстрока>
 *     stdout «X Y» — центр рамки ближайшего кликабельного предка узла с
 *     подстрокой (сама карточка, а не текст в ней — прогон 2: тап по
 *     узлу текста «6.» карточку не открыл). Кликабельного предка нет —
 *     центр самого узла. Узла нет — код 1 и причина в stderr.
 *
 *   node proverka/najdi-tapnut.cjs --po-tekstu <ui.xml> <подстрока>
 *     stdout «X Y» — центр самого узла с текстом (запасной способ:
 *     тап по рамке карточки страницу не сменил).
 *
 *   node proverka/najdi-tapnut.cjs --zhiv <ui.xml>
 *     код 0 — в поддереве WebView есть узел с непустым text; код 4 —
 *     дерево снято до текста (WebView ещё не отдал a11y-контент:
 *     прогон 2 — семь узлов с пустым text при метке на экране).
 *     WebView в дереве нет — достаточно любого непустого text.
 *
 * Узел есть, а у него и у кликабельного предка bounds=[0,0][0,0] — он за
 * краем видимой части WebView (uiautomator отдаёт координаты только
 * видимым a11y-узлам): код 3, тапать нечего — вызывающий крутит
 * страницу и дампит заново. Выше ближайшего кликабельного предка не
 * поднимаемся: следующий кликабельный — сам WebView, тап в его центр
 * попадёт не в карточку.
 */
const fs = require('fs');

const argv = process.argv.slice(2);
let rezhim = 'ramka';
let put, podstroka;
if (argv[0] === '--zhiv') { rezhim = 'zhiv'; put = argv[1]; }
else if (argv[0] === '--po-tekstu') { rezhim = 'tekst'; [put, podstroka] = argv.slice(1); }
else { [put, podstroka] = argv; }

if (!put || (rezhim !== 'zhiv' && !podstroka)) {
  console.error('najdi-tapnut: нужны файл дампа и подстрока (или --zhiv <файл>)');
  process.exit(2);
}
let xml;
try { xml = fs.readFileSync(put, 'utf8'); }
catch (e) {
  console.error(`najdi-tapnut: дамп не читается: ${e.message}`);
  process.exit(1);
}

// разбор дерева: родитель у каждого узла — кликабельный предок ищется
// подъёмом от найденного текста
function parseAttrs(tag) {
  const attrs = {};
  for (const m of tag.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = m[2];
  return attrs;
}
function parseDerevo(s) {
  const koren = { attrs: {}, deti: [], predok: null };
  const stek = [koren];
  const re = /<node\b[^>]*?\/?>|<\/node\s*>/g;
  let m;
  while ((m = re.exec(s))) {
    const tag = m[0];
    if (tag.startsWith('</')) { stek.pop(); continue; }
    const uzel = { attrs: parseAttrs(tag), deti: [], predok: stek[stek.length - 1] };
    stek[stek.length - 1].deti.push(uzel);
    if (!tag.endsWith('/>')) stek.push(uzel);
  }
  return koren;
}
function obojti(koren, fn) { // в порядке документа, включая сам koren
  if (fn(koren)) return koren;
  for (const d of koren.deti) {
    const r = obojti(d, fn);
    if (r) return r;
  }
  return null;
}
function centrBounds(u) {
  const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec((u && u.attrs.bounds) || '');
  if (!b) return null;
  const x1 = Number(b[1]), y1 = Number(b[2]), x2 = Number(b[3]), y2 = Number(b[4]);
  if (x2 <= x1 || y2 <= y1) return null;
  return `${Math.round((x1 + x2) / 2)} ${Math.round((y1 + y2) / 2)}`;
}
const derevo = parseDerevo(xml);

if (rezhim === 'zhiv') {
  const web = obojti(derevo, (u) => /WebView/i.test(u.attrs.class || ''));
  const otKogo = web || derevo;
  const zhiv = obojti(otKogo, (u) => (u.attrs.text || '').trim() !== '') !== null;
  process.exit(zhiv ? 0 : 4);
}

// сначала ищем по text: у карточки content-desc собирает текст всех
// детей («6. KYU 0 из 12 отмечено») и совпадение ушло бы в предка раньше
// текстового узла — тап по тексту должен вести именно в узел текста
let uzel = obojti(derevo, (u) => (u.attrs.text || '').includes(podstroka));
if (!uzel) uzel = obojti(derevo, (u) => (u.attrs['content-desc'] || '').includes(podstroka));
if (!uzel) {
  console.error(`najdi-tapnut: «${podstroka}» в дереве экрана не найдено`);
  process.exit(1);
}
if (rezhim === 'tekst') {
  const c = centrBounds(uzel);
  if (c) { console.log(c); process.exit(0); }
  console.error(`najdi-tapnut: «${podstroka}» за краем экрана — нужен скролл`);
  process.exit(3);
}
// ramka: ближайший предок-или-сам с clickable="true"; за краем — код 3,
// выше не поднимаемся (дальше кликабельный только сам WebView)
for (let u = uzel; u; u = u.predok) {
  if (u.attrs.clickable !== 'true') continue;
  const c = centrBounds(u);
  if (c) { console.log(c); process.exit(0); }
  console.error(`najdi-tapnut: карточка «${podstroka}» за краем экрана — нужен скролл`);
  process.exit(3);
}
// кликабельного предка нет — тап по рамке самого узла
const c2 = centrBounds(uzel);
if (c2) { console.log(c2); process.exit(0); }
console.error(`najdi-tapnut: «${podstroka}» за краем экрана — нужен скролл`);
process.exit(3);
