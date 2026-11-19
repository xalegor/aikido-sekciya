// Айкидо — Program za polaganje · версия для секции. Vanilla SPA,
// hash-роутинг, ноль зависимостей. Данные — ./kyu.json рядом со
// страницей; ролики играет плеер YouTube с канала клуба, рядом всегда
// ссылка «Открыть в YouTube». Отметки «знаю» — в localStorage.
const app = document.getElementById('app');
let DATA = null;

// Хост youtube-nocookie — облегчённый домен YouTube без рекламных кук.
// Клик по «Открыть в YouTube» уходит во внешнее приложение (в обёртке
// Capacitor — системный браузер или приложение YouTube), а не внутрь
// WebView: WebView передаёт window.open с _blank операционной системе.
const YT_EMBED = 'https://www.youtube-nocookie.com/embed/';
const YT_WATCH = 'https://www.youtube.com/watch?v=';
const YT_IFRAME_API = 'https://www.youtube.com/iframe_api';

// 'ok' — номер ролика есть · 'none' — ролик не подобран
function videoState(id) { return id ? 'ok' : 'none'; }
const BADGE = { ok: '▶ YouTube', none: 'нет видео' };

const KEY = (l, w, a, t) => `aik-know-${l}-${w}-${a}-${t}`.replace(/\s+/g, '_');
const known = (k) => localStorage.getItem(k) === '1';
const setKnown = (k, v) => v ? localStorage.setItem(k, '1') : localStorage.removeItem(k);

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

function kyuStats(kyu) {
  let total = 0, done = 0;
  for (const s of kyu.sections) for (const g of s.groups) for (const it of g.items) {
    total++;
    if (known(KEY(kyu.level, s.waza, g.attack, it.tech))) done++;
  }
  return { total, done };
}

/* ---------- YouTube ---------- */
// IFrame API загружается один раз: он умеет событие onError — отказ
// встраивания (коды 101/150) и отказ самого YouTube в WebView без
// Referer (код 153) ловятся им и заменяются ссылкой на месте плеера.
// API не доехал (нет сети до скрипта) — промис отказывает, страница
// ставит обычный iframe embed.
let ytApiP = null;
function ytApi() {
  if (typeof window !== 'undefined' && window.YT && window.YT.Player) {
    return Promise.resolve(window.YT);
  }
  if (ytApiP) return ytApiP;
  ytApiP = new Promise((res, rej) => {
    try {
      const s = document.createElement('script');
      s.src = YT_IFRAME_API;
      s.async = true;
      s.addEventListener('error', () => rej(new Error('iframe_api не загрузился')));
      document.head.appendChild(s);
      const pred = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        try { if (pred) pred(); } catch (e) { /* колбэк страницы не роняем */ }
        if (window.YT && window.YT.Player) res(window.YT);
        else rej(new Error('YT.Player не появился'));
      };
    } catch (e) { rej(e); }
  });
  return ytApiP;
}

function ytLink(id, cls) {
  const a = el('a', 'yt-open' + (cls ? ' ' + cls : ''), 'Открыть в YouTube');
  a.href = `${YT_WATCH}${id}`;
  a.setAttribute('target', '_blank');
  a.setAttribute('rel', 'noopener noreferrer');
  a.addEventListener('click', (e) => {
    if (e && e.preventDefault) e.preventDefault();
    window.open(a.href, '_blank', 'noopener');
  });
  return a;
}

function videoBlock(id) {
  const wrap = el('div', 'video-wrap');
  if (!id) {
    wrap.append(el('p', 'novideo-note',
      'Для этой связки ролика не подобрано. Техника в программе — спроси у тренера.'));
    return wrap;
  }
  // blok — стабильное место плеера: реальный YT.Player заменяет
  // переданный ему элемент на свой iframe, поэтому «место» держит
  // обёртка, а host — только сменная начинка
  const blok = el('div', 'yt-blok');
  const host = el('div', 'yt-host');
  blok.append(host);
  wrap.append(blok);
  const vmesto = () => {
    const mesto = host.parentNode ? host : blok;
    mesto.replaceChildren(ytLink(id, 'yt-repl'));
  };
  const embedIframe = () => {
    const f = document.createElement('iframe');
    f.className = 'yt-iframe';
    f.src = `${YT_EMBED}${id}`;
    f.setAttribute('title', 'ролик техники на YouTube');
    f.setAttribute('allow',
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture');
    f.setAttribute('allowfullscreen', '');
    f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
    f.addEventListener('error', vmesto);
    host.replaceChildren(f);
  };
  ytApi().then((YT) => {
    try {
      new YT.Player(host, {
        videoId: id,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { rel: 0, playsinline: 1 },
        events: { onError: vmesto },
      });
    } catch (e) { embedIframe(); }
  }).catch(() => embedIframe());
  // ссылка всегда рядом с плеером — не только после ошибки
  wrap.append(ytLink(id));
  return wrap;
}

/* ---------- экран: список кю ---------- */
function renderHome() {
  app.replaceChildren();
  const head = el('header', 'home-head');
  head.append(el('div', 'kanji', '合気道'));
  head.append(el('h1', null, 'Program za polaganje'));
  head.append(el('p', 'sub', DATA.club));
  app.append(head);

  const list = el('div', 'kyu-list');
  for (const k of DATA.kyu) {
    const st = kyuStats(k);
    const card = el('a', 'kyu-card');
    card.href = `#/kyu/${k.level}`;
    card.append(el('div', 'kyu-num', `${k.level}.`));
    const body = el('div', 'kyu-body');
    body.append(el('div', 'kyu-title', 'KYU'));
    body.append(el('div', 'kyu-progress', `${st.done} из ${st.total} отмечено`));
    const bar = el('div', 'bar');
    const fill = el('div', 'bar-fill');
    fill.style.width = st.total ? `${Math.round(100 * st.done / st.total)}%` : '0%';
    bar.append(fill);
    body.append(bar);
    card.append(body);
    list.append(card);
  }
  const lib = el('a', 'kyu-card lib-card');
  lib.href = '#/lib';
  lib.append(el('div', 'kyu-num', '✦'));
  const lb = el('div', 'kyu-body');
  lb.append(el('div', 'kyu-title', 'Другие приёмы'));
  lb.append(el('div', 'kyu-progress',
    `${DATA.library.length} приёмов с роликами канала — базовые формы, оружие`));
  lib.append(lb);
  list.append(lib);
  app.append(list);
  if (DATA.motto) app.append(el('p', 'motto', DATA.motto));
}

/* ---------- экран: программа кю ---------- */
function renderKyu(level) {
  const kyu = DATA.kyu.find((k) => k.level === level);
  if (!kyu) { location.hash = '#/'; return; }
  app.replaceChildren();
  app.append(backBar('#/', `${level}. KYU`));

  for (const [si, s] of kyu.sections.entries()) {
    app.append(el('h2', 'waza', s.waza));
    for (const [gi, g] of s.groups.entries()) {
      const row = el('div', 'group');
      row.append(el('div', 'attack-box', g.attack));
      const items = el('div', 'items');
      for (const [ii, it] of g.items.entries()) {
        const key = KEY(level, s.waza, g.attack, it.tech);
        const state = videoState(it.video);
        const line = el('div', 'item' + (state === 'ok' ? '' : ' novideo'));
        line.dataset.video = state;
        const chk = el('button', 'chk' + (known(key) ? ' on' : ''), known(key) ? '✓' : '');
        chk.setAttribute('aria-label', 'знаю');
        chk.addEventListener('click', (e) => {
          e.stopPropagation();
          setKnown(key, !known(key));
          renderKyu(level);
        });
        line.append(chk);
        const name = el('div', 'item-name');
        name.append(el('span', null, it.tech));
        if (it.var) name.append(el('span', 'variant', ` (${it.var})`));
        line.append(name);
        line.append(el('span', 'vbadge vbadge-' + state, BADGE[state]));
        // техника остаётся в программе и открывается всегда: без ролика
        // экран честно скажет почему
        line.addEventListener('click', () => { location.hash = `#/t/${level}/${si}/${gi}/${ii}`; });
        items.append(line);
      }
      row.append(items);
      app.append(row);
    }
  }
}

/* ---------- экран: техника ---------- */
function renderTech(level, si, gi, ii) {
  const kyu = DATA.kyu.find((k) => k.level === level);
  const s = kyu && kyu.sections[si];
  const g = s && s.groups[gi];
  const it = g && g.items[ii];
  if (!it) { location.hash = '#/'; return; }
  app.replaceChildren();
  app.append(backBar(`#/kyu/${level}`, `${level}. KYU · ${s.waza}`));

  const h = el('h2', 'tech-title');
  h.append(el('span', 'tech-attack', g.attack));
  h.append(el('span', null, ` — ${it.tech}`));
  if (it.var) h.append(el('span', 'variant', ` (${it.var})`));
  app.append(h);

  app.append(videoBlock(it.video));

  const key = KEY(level, s.waza, g.attack, it.tech);
  const btn = el('button', 'know-btn' + (known(key) ? ' on' : ''),
    known(key) ? '✓ Знаю эту технику' : 'Отметить: знаю');
  btn.addEventListener('click', () => {
    setKnown(key, !known(key));
    renderTech(level, si, gi, ii);
  });
  app.append(btn);
  if (videoState(it.video) === 'ok') app.append(videoCredit());
}

/* ---------- экран: «Другие приёмы» ---------- */
function renderLib() {
  app.replaceChildren();
  app.append(backBar('#/', 'Другие приёмы'));
  const items = el('div', 'items lib-items');
  for (const [i, t] of DATA.library.entries()) {
    const state = videoState(t.video);
    const line = el('div', 'item' + (state === 'ok' ? '' : ' novideo'));
    line.dataset.video = state;
    line.append(el('div', 'item-name', t.name));
    line.append(el('span', 'vbadge vbadge-' + state, BADGE[state]));
    line.addEventListener('click', () => { location.hash = `#/libt/${i}`; });
    items.append(line);
  }
  app.append(items);
}

function renderLibTech(i) {
  const t = DATA.library[i];
  if (!t) { location.hash = '#/lib'; return; }
  app.replaceChildren();
  app.append(backBar('#/lib', 'Другие приёмы'));
  app.append(el('h2', 'tech-title', t.name));
  app.append(videoBlock(t.video));
  if (videoState(t.video) === 'ok') app.append(videoCredit());
}

/* ---------- общие блоки ---------- */
// подпись об источнике роликов — только там, где ролик действительно есть
function videoCredit() {
  return el('p', 'credit', DATA.videoCredit || 'видео: Aikido klub Centar (Beograd)');
}

function backBar(href, title) {
  const bar = el('div', 'topbar');
  const back = el('a', 'back', '←');
  back.href = href;
  bar.append(back);
  bar.append(el('div', 'topbar-title', title));
  return bar;
}

/* ---------- роутер ---------- */
function route() {
  if (!DATA) return;
  const h = location.hash || '#/';
  let m;
  if ((m = h.match(/^#\/kyu\/(\d)$/))) renderKyu(Number(m[1]));
  else if ((m = h.match(/^#\/t\/(\d)\/(\d+)\/(\d+)\/(\d+)$/))) renderTech(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]));
  else if (h === '#/lib') renderLib();
  else if ((m = h.match(/^#\/libt\/(\d+)$/))) renderLibTech(Number(m[1]));
  else renderHome();
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);

// kyu.json лежит рядом со страницей — путь относительный: сайт живёт и
// в корне APK (WebView), и в подпапке GitHub Pages
fetch('./kyu.json')
  .then((r) => { if (!r.ok) throw new Error(`kyu.json: ${r.status}`); return r.json(); })
  .then((d) => { DATA = d; route(); })
  .catch(() => {
    app.replaceChildren(el('p', 'loading',
      'Не удалось загрузить программу — проверь связь и обнови страницу.'));
  });
