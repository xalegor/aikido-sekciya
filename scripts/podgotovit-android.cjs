'use strict';
/* podgotovit-android.cjs — подготовка сгенерированной платформы
 * android/ приложения «Айкидо — Program za polaganje» (версия для
 * секции: открытый репозиторий, страница внутри APK, ролики играет
 * YouTube). Запускать после `npx cap add android`, до сборки APK:
 *
 *   1) значок — белый иероглиф 合 на поле #8c2f1b (фирменный цвет
 *      страницы), рисуется здесь же без сети и библиотек; адаптивные
 *      anydpi-значки шаблона убираются, чтобы везде стоял наш;
 *   2) versionCode/versionName — из AIKIDO_SEKCIYA_APP_VERSION_CODE
 *      (в CI — github.run_number), чтобы следующий APK ставился поверх
 *      прежнего тем же ключом;
 *   3) провайдер загружаемых шрифтов EmojiCompat снимается слиянием
 *      манифеста: он тянет com.google.android.gms и на эмуляторе без
 *      служб Google уносил процесс приложения («depends on provider
 *      …FontsProvider in dying proc») — эмодзи рисует сам WebView;
 *   4) cleartext не разрешается нигде: приложение ходит только на
 *      YouTube по https — остатки usesCleartextTraffic и
 *      network_security_config из шаблона снимаются.
 *
 * Без android/ — громкий отказ: платформу сначала генерирует cap add.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const KOREN = path.resolve(__dirname, '..');
const RES = path.join(KOREN, 'android', 'app', 'src', 'main', 'res');
const MANIFEST = path.join(KOREN, 'android', 'app', 'src', 'main', 'AndroidManifest.xml');
const NSC = path.join(RES, 'xml', 'network_security_config.xml');
if (!fs.existsSync(RES)) {
  console.error('podgotovit-android: нет android/app/src/main/res — '
    + 'сначала `npx cap add android`');
  process.exit(1);
}

// --- PNG без библиотек ---
const CRC_TAB = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TAB[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(tip, data) {
  const t = Buffer.from(tip, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
/* Иероглиф 合 12×11: крыша 𠆢, черта 一, устойчивое 口 снизу. */
const IEROGLIF = [
  '....####....',
  '...##..##...',
  '..##....##..',
  '.##......##.',
  '##........##',
  '############',
  '..########..',
  '..#......#..',
  '..#......#..',
  '..#......#..',
  '..########..',
];
function pngZnachok(px) {
  const bg = [140, 47, 27];        // #8c2f1b — фирменный цвет страницы
  const fg = [250, 248, 248];
  const w = 12; const h = IEROGLIF.length;
  const scale = Math.max(1, Math.floor((px * 0.62) / w));
  const bw = w * scale; const bh = h * scale;
  const x0 = Math.floor((px - bw) / 2); const y0 = Math.floor((px - bh) / 2);
  const raw = Buffer.alloc(px * (1 + px * 3));
  for (let y = 0; y < px; y++) {
    const row = y * (1 + px * 3);
    raw[row] = 0; // фильтр None
    for (let x = 0; x < px; x++) {
      const lx = Math.floor((x - x0) / scale); const ly = Math.floor((y - y0) / scale);
      const on = lx >= 0 && lx < w && ly >= 0 && ly < h && IEROGLIF[ly][lx] === '#';
      const c = on ? fg : bg;
      const o = row + 1 + x * 3;
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(px, 0); ihdr.writeUInt32BE(px, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8 бит, truecolor RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// значок — 合 на фирменном поле. Адаптивные anydpi-описания шаблона
// убираем — иначе на Android 8+ был бы шаблонный значок Capacitor
// поверх наших PNG.
const PLOTNOSTI = { 'mipmap-mdpi': 48, 'mipmap-hdpi': 72, 'mipmap-xhdpi': 96,
  'mipmap-xxhdpi': 144, 'mipmap-xxxhdpi': 192 };
let zapisano = 0;
for (const [papka, px] of Object.entries(PLOTNOSTI)) {
  const dir = path.join(RES, papka);
  if (!fs.existsSync(dir)) continue;
  const png = pngZnachok(px);
  for (const imya of ['ic_launcher.png', 'ic_launcher_round.png']) {
    fs.writeFileSync(path.join(dir, imya), png);
    zapisano++;
  }
}
for (const imya of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
  fs.rmSync(path.join(RES, 'mipmap-anydpi-v26', imya), { force: true });
}
if (!zapisano) {
  console.error('podgotovit-android: ни одного mipmap-каталога в res — '
    + 'шаблон изменился?');
  process.exit(1);
}
console.log(`podgotovit-android: значок 合 записан в ${zapisano} файлов`);

// versionCode — из переменной, чтобы следующий APK ставился поверх
const kod = String(process.env.AIKIDO_SEKCIYA_APP_VERSION_CODE || '').trim();
if (kod) {
  if (!/^\d+$/.test(kod)) {
    console.error(`podgotovit-android: AIKIDO_SEKCIYA_APP_VERSION_CODE не число: «${kod}»`);
    process.exit(1);
  }
  const bg = path.join(KOREN, 'android', 'app', 'build.gradle');
  let s = fs.readFileSync(bg, 'utf8');
  if (!/versionCode \d+/.test(s) || !/versionName "[^"]*"/.test(s)) {
    console.error('podgotovit-android: в app/build.gradle нет '
      + 'versionCode/versionName — шаблон изменился?');
    process.exit(1);
  }
  s = s.replace(/versionCode \d+/, `versionCode ${kod}`);
  s = s.replace(/versionName "[^"]*"/, `versionName "1.0.${kod}"`);
  fs.writeFileSync(bg, s);
  console.log(`podgotovit-android: versionCode=${kod}, versionName=1.0.${kod}`);
}

// --- манифест: без EmojiCompat и без cleartext ---
let manifest = fs.readFileSync(MANIFEST, 'utf8');
function atributManifest(imya, znachenie) {
  const re = new RegExp(`\\s*android:${imya}="[^"]*"`);
  if (znachenie === null) { manifest = manifest.replace(re, ''); return; }
  if (re.test(manifest)) manifest = manifest.replace(re, ` android:${imya}="${znachenie}"`);
  else manifest = manifest.replace(/<application\b/, `<application android:${imya}="${znachenie}"`);
}

// EmojiCompatInitializer из androidx.emoji2 (его тянет AppCompat)
// стартует через androidx.startup и берёт загружаемый шрифт у
// com.google.android.gms; когда умирает gms.persistent, система снимает
// и наше приложение. Эмодзи в приложении рисует WebView — узел
// снимается слиянием манифеста (tools:node="remove", по документации
// androidx.startup).
if (!/xmlns:tools=/.test(manifest)) {
  manifest = manifest.replace(/<manifest\b/,
    '<manifest xmlns:tools="http://schemas.android.com/tools"');
}
if (!/androidx\.emoji2\.text\.EmojiCompatInitializer/.test(manifest)) {
  manifest = manifest.replace(/(\n?)(\s*)<\/application>/,
    '$1$2  <provider android:name="androidx.startup.InitializationProvider"\n'
    + '$2    android:authorities="${applicationId}.androidx-startup"\n'
    + '$2    android:exported="false" tools:node="merge">\n'
    + '$2    <meta-data android:name="androidx.emoji2.text.EmojiCompatInitializer"\n'
    + '$2      tools:node="remove" />\n'
    + '$2  </provider>\n$2</application>');
}

// приложение ходит только на YouTube по https — cleartext нигде не нужен
fs.rmSync(NSC, { force: true });
atributManifest('usesCleartextTraffic', null);
atributManifest('networkSecurityConfig', null);
fs.writeFileSync(MANIFEST, manifest);
console.log('podgotovit-android: EmojiCompat снят, cleartext выключен (только https)');
