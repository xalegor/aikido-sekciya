'use strict';
/*
 * sobrat-otchet.cjs — сборщик отчёта проверки запуска APK «Айкидо» для
 * секции в эмуляторе. Node без зависимостей. Читает каталог улик
 * прогона (--rez) и пишет в него же otchet-zapuska.json: по каждому
 * пункту — «прошло» или «не прошло» с причиной. Любой красный пункт —
 * код выхода 1 (работа GitHub красная).
 *
 *   node proverka/sobrat-otchet.cjs --rez <каталог> --paket <appId> \
 *     [--metka <строка>] [--out <файл>]
 *
 * Файлы улик (имена фиксированные, все в --rez):
 *   ustanovka.txt     — вывод `adb install` («Success»)
 *   logcat.txt        — logcat после запуска (нет FATAL EXCEPTION и
 *                       ANR пакета)
 *   ui-zapusk.xml     — дерево экрана после запуска (метка странички)
 *   snimok-zapusk.png — снимок экрана после запуска (не одного цвета)
 *   fokus-zapusk.txt  — фокус окна в момент снимка (пакет приложения —
 *                       иначе многоцветный рабочий стол «прошёл» бы)
 *   ui-rolik.xml      — дерево страницы ролика: плеер YouTube или
 *                       ссылка «Открыть в YouTube» на его месте/рядом
 *                       (в эмуляторе без сети до YouTube плеер может
 *                       отказать — ссылка обязана быть всегда)
 *   snimok-rolik.png, fokus-rolik.txt — снимок страницы ролика и фокус
 *                       в его момент (фокус — дополнительная улика:
 *                       есть — сверяется, нет — решают текст и снимок)
 *   metka.txt         — метка запуска, если --metka не передан
 *   meta.json         — необязательные умолчания параметров
 *
 * «Прошло» без улики не ставится: нет файла — пункт красный.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// ---------- разбор аргументов ----------
function args(argv) {
  const out = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) { out[a.slice(2, eq)] = a.slice(eq + 1); }
      else { out[a.slice(2)] = argv[i + 1]; i++; }
    } else out._.push(a);
  }
  return out;
}
const A = args(process.argv);
const REZ = A.rez;
if (!REZ || !fs.existsSync(REZ)) {
  console.error('sobrat-otchet: нет каталога улик --rez');
  process.exit(2);
}
let meta = {};
try { meta = JSON.parse(fs.readFileSync(path.join(REZ, 'meta.json'), 'utf8')); } catch { /* */ }
const PAKET = A.paket || meta.paket || 'aikido.sekciya';
let METKA = A.metka || meta.metka;
if (!METKA) {
  try { METKA = fs.readFileSync(path.join(REZ, 'metka.txt'), 'utf8').trim(); } catch { /* */ }
}
if (!METKA) METKA = 'Program za polaganje';
const OUT = A.out || path.join(REZ, 'otchet-zapuska.json');

const punkty = [];
function ok(imya, detail) { punkty.push({ imya, proshlo: true, ...(detail ? { detail } : {}) }); }
function fail(imya, prichina) { punkty.push({ imya, proshlo: false, prichina }); }
function chitat(imya) {
  try { return fs.readFileSync(path.join(REZ, imya), 'utf8'); }
  catch { return null; }
}

// ---------- PNG: валидность и «не одного цвета» ----------
// минимальный разбор: сигнатура, IHDR (8 бит, типы 0/2/3/6, без
// интерлейса), IDAT → inflate → разфильтр строк → уникальные цвета.
function pngTsvety(buf) {
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504E47) {
    throw new Error('не PNG');
  }
  let off = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const idat = [];
  let plte = null;
  while (off + 12 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const tip = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (tip === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (tip === 'PLTE') plte = data;
    else if (tip === 'IDAT') idat.push(data);
    else if (tip === 'IEND') break;
    off += 12 + len;
  }
  if (!w || !h || !idat.length) throw new Error('нет IHDR/IDAT');
  if (interlace !== 0) throw new Error('interlaced PNG не разбирается');
  const kanalov = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!kanalov) throw new Error(`colorType ${colorType} не разбирается`);
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} не разбирается`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = kanalov;
  const stride = w * bpp;
  const tsvety = new Set();
  let pred = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    if (f === 1) { // Sub
      for (let i = bpp; i < stride; i++) line[i] = (line[i] + line[i - bpp]) & 0xFF;
    } else if (f === 2) { // Up
      for (let i = 0; i < stride; i++) line[i] = (line[i] + pred[i]) & 0xFF;
    } else if (f === 3) { // Average
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        line[i] = (line[i] + ((a + pred[i]) >> 1)) & 0xFF;
      }
    } else if (f === 4) { // Paeth
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? line[i - bpp] : 0;
        const b = pred[i];
        const c = i >= bpp ? pred[i - bpp] : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        line[i] = (line[i] + (pa <= pb && pa <= pc ? a : (pb <= pc ? b : c))) & 0xFF;
      }
    } else if (f !== 0) throw new Error(`неизвестный фильтр ${f}`);
    for (let x = 0; x < w; x++) {
      if (colorType === 3 && plte) {
        const idx = line[x];
        tsvety.add(`${plte[idx * 3]},${plte[idx * 3 + 1]},${plte[idx * 3 + 2]}`);
      } else {
        tsvety.add(line.readUIntBE(x * bpp, bpp));
      }
      if (tsvety.size > 8) return tsvety; // уже явно не один цвет
    }
    pred = line;
  }
  return tsvety;
}
function snimokNePustoj(imya) {
  const put = path.join(REZ, imya);
  if (!fs.existsSync(put)) return { proshlo: false, prichina: `нет улики ${imya}` };
  let tsvety;
  try { tsvety = pngTsvety(fs.readFileSync(put)); }
  catch (e) { return { proshlo: false, prichina: `${imya}: ${e.message}` }; }
  if (tsvety.size < 2) return { proshlo: false, prichina: `${imya} одного цвета — экран пустой/белый` };
  return { proshlo: true, detail: `${tsvety.size} разных цвета` };
}

// ---------- фокус окна в момент снимка ----------
// дамп `dumpsys window`/`dumpsys activity`: строки mCurrentFocus,
// mFocusedApp/mFocusedWindow, topResumedActivity/mResumedActivity несут
// компонент «пакет/активность» — в фокусе обязан быть пакет приложения,
// не лаунчер и не чужой экран
function fokusKto(imya) {
  const s = chitat(imya);
  if (s === null) {
    return { proshlo: false,
      prichina: `нет улики ${imya} — фокус окна в момент снимка не доказан` };
  }
  const reK = /(mCurrentFocus|mFocusedApp|mFocusedWindow|topResumedActivity|mResumedActivity)\s*[=:]/;
  let strokaByla = false;
  for (const l of s.split('\n')) {
    const m = reK.exec(l);
    if (!m) continue;
    strokaByla = true;
    const kv = /([\w.]+)\/[^\s}\],]*/.exec(l.slice(m.index));
    if (kv) return { proshlo: true, paket: kv[1] };
  }
  return { proshlo: false, prichina: strokaByla
    ? `${imya}: в строке фокуса нет компонента «пакет/активность»`
    : `${imya}: нет строки mCurrentFocus/topResumedActivity — фокус не доказан` };
}
// ---------- окно ANR системы ----------
// На перегруженном эмуляторе системные окна «Application Not
// Responding: <пакет>» рабочего стола и служб перехватывают передний
// план у приложения. Окно ANR приложением не засчитывается: причина
// называет окно — это сбой стенда, не приложения.
function anrOkno(imya) { // пакет из окна ANR в строке фокуса дампа, либо null
  const s = chitat(imya);
  if (s === null) return null;
  const m = /(?:mCurrentFocus|mFocusedWindow)\s*=\s*Window\{[^}]*Application Not Responding:\s*([\w.]+)/
    .exec(s);
  return m ? m[1] : null;
}
// окно убрали до дампа фокуса, а сам ANR остался в logcat — пакет
// берём из последнего «ANR in <пакет>» чужого (не приложения) процесса
function anrLogcat() {
  const s = chitat('logcat.txt');
  if (s === null) return null;
  const pk = [...s.matchAll(/ANR in ([\w.]+)/g)].map((m) => m[1])
    .filter((p) => p !== PAKET && !p.startsWith(`${PAKET}.`));
  return pk.length ? pk[pk.length - 1] : null;
}
function fokusPaket(imya) {
  const k = fokusKto(imya);
  if (!k.proshlo) return k;
  const anr = anrOkno(imya);
  if (anr) {
    return { proshlo: false,
      prichina: `на экране окно ANR системы: ${anr}` };
  }
  if (k.paket === PAKET) return { proshlo: true, detail: `в фокусе ${PAKET}` };
  const anrZh = anrLogcat();
  if (anrZh) {
    return { proshlo: false,
      prichina: `на экране окно ANR системы: ${anrZh} (ANR в logcat, в фокусе ${k.paket})` };
  }
  return { proshlo: false,
    prichina: `приложение ${PAKET} не вышло на передний план (в фокусе ${k.paket}) — снимок снял не приложение` };
}
// улика фокуса дополнительная: есть — сверяется, нет — пункт решают
// остальные признаки
function fokusEsliEst(imya) {
  if (chitat(imya) === null) return { proshlo: true };
  return fokusPaket(imya);
}

// ---------- дерево отдал текст ----------
// uiautomator может снять дамп до того, как WebView отдал a11y-контент
// — метка на экране есть, в XML её нет. «Пустое дерево» — своя
// причина, не «нет метки»: есть ли в поддереве WebView узел с непустым
// text; WebView в дереве нет — достаточно любого текста.
function derevoSTekstom(xml) {
  const attr = (tag, n) => {
    const m = new RegExp(`${n}="([^"]*)"`).exec(tag);
    return m ? m[1] : '';
  };
  const re = /<node\b[^>]*?\/?>|<\/node\s*>/g;
  const stek = [];
  let webByl = false;
  let tekstVneWeba = false;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    if (tag.startsWith('</')) { stek.pop(); continue; }
    const vWeb = stek.some((a) => a.web) || /WebView/i.test(attr(tag, 'class'));
    if (vWeb) webByl = true;
    if ((attr(tag, 'text') || '').trim() !== '') {
      if (vWeb) return true;
      tekstVneWeba = true;
    }
    if (!tag.endsWith('/>')) stek.push({ web: vWeb });
  }
  return !webByl && tekstVneWeba;
}

// ---------- пункты ----------
// 1. установка без ошибки
(function () {
  const s = chitat('ustanovka.txt');
  if (s === null) return fail('ustanovka', 'нет улики ustanovka.txt');
  if (/success/i.test(s)) return ok('ustanovka');
  fail('ustanovka', `adb install не дал Success: ${s.trim().split('\n').pop() || 'пустой вывод'}`);
})();

// 2. запуск без падения — FATAL EXCEPTION и ANR именно пакета (в logcat
// весь эмулятор, чужой процесс упасть может — это не падение приложения)
(function () {
  const s = chitat('logcat.txt');
  if (s === null) return fail('zapusk', 'нет улики logcat.txt');
  const esc = PAKET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const procRe = new RegExp(`Process:\\s*${esc}(?=[^\\w.-]|$)`);
  const stroki = s.split('\n');
  for (let i = 0; i < stroki.length; i++) {
    if (!/FATAL EXCEPTION/i.test(stroki[i])) continue;
    const proc = stroki.slice(i + 1, i + 11).find((l) => procRe.test(l));
    if (proc) {
      return fail('zapusk',
        `FATAL EXCEPTION пакета в logcat: ${stroki[i].trim()} / ${proc.trim()}`);
    }
  }
  const anr = stroki.find((l) => /ANR in/.test(l) && l.includes(PAKET));
  if (anr) return fail('zapusk', `ANR пакета в logcat: ${anr.trim()}`);
  ok('zapusk');
})();

// 3. снимок не одного цвета И в момент снимка в фокусе пакет приложения
(function () {
  const r = snimokNePustoj('snimok-zapusk.png');
  if (!r.proshlo) return fail('snimok', r.prichina);
  const f = fokusPaket('fokus-zapusk.txt');
  if (!f.proshlo) return fail('snimok', f.prichina);
  ok('snimok', `${r.detail}; ${f.detail}`);
})();

// 4. метка в дереве экрана — заголовок странички
(function () {
  const s = chitat('ui-zapusk.xml');
  if (s === null) return fail('metka', 'нет улики ui-zapusk.xml');
  if (!derevoSTekstom(s)) {
    return fail('metka', 'дерево снято до текста: в ui-zapusk.xml нет ни одного непустого text — uiautomator dump обогнал отрисовку WebView');
  }
  if (s.includes(METKA)) return ok('metka');
  fail('metka', `в дереве экрана нет метки «${METKA}»`);
})();

// 5. страница ролика: плеер YouTube или «Открыть в YouTube»
// (ссылка обязана стоять рядом с плеером всегда и заменять его при
// отказе — в эмуляторе без сети до YouTube ссылка единственная рабочая
// дверь к ролику). Плюс снимок не пустой; фокус — улика дополнительная.
(function () {
  const s = chitat('ui-rolik.xml');
  if (s === null) return fail('rolik', 'нет улики ui-rolik.xml');
  if (!derevoSTekstom(s)) {
    return fail('rolik', 'дерево страницы ролика снято до текста WebView — ни одного непустого text');
  }
  if (!/Открыть в YouTube|youtube/i.test(s)) {
    return fail('rolik', 'на странице ролика ни плеера YouTube, ни ссылки «Открыть в YouTube»');
  }
  const r = snimokNePustoj('snimok-rolik.png');
  if (!r.proshlo) return fail('rolik', r.prichina);
  const f = fokusEsliEst('fokus-rolik.txt');
  if (!f.proshlo) return fail('rolik', f.prichina);
  ok('rolik', `«Открыть в YouTube»/плеер в дереве; ${r.detail}`);
})();

const proshlo = punkty.every((p) => p.proshlo);
const doc = {
  prilozhenie: 'aikido-sekciya',
  paket: PAKET,
  kogda: new Date().toISOString(),
  proshlo,
  punkty,
};
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n');
for (const p of punkty) {
  console.log(`${p.proshlo ? 'ok  ' : 'FAIL'} ${p.imya}${p.proshlo ? (p.detail ? ` (${p.detail})` : '') : `: ${p.prichina}`}`);
}
console.log(`sobrat-otchet: ${OUT} — ${proshlo ? 'ПРОШЛО' : 'НЕ ПРОШЛО'}`);
process.exit(proshlo ? 0 : 1);
