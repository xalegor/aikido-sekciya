# Айкидо — Program za polaganje (для секции)

Открытая страничка и приложение для людей секции **Aikido klub
Marumero · マルメロ**: программы аттестации **6 → 1 кю**, связки и
«Другие приёмы» — с роликами канала Aikido klub Centar (Белград) на YouTube. Ничего своего не
крутим: страница, данные `kyu.json` и APK в одном репозитории.

- **Сайт:** GitHub Pages этого репозитория (`github.com/xalegor/aikido-sekciya`
  → `xalegor.github.io/aikido-sekciya/`).
- **Ролики:** канал Aikido klub Centar (Белград) — `youtube.com/@aikidoklubcentar` (вкладка
  «Видео»). Каждая техника играется плеером YouTube прямо на странице;
  рядом всегда ссылка «Открыть в YouTube» — если плеер отказал (нет
  связи, WebView без Referer), ссылка остаётся рабочей дверью к ролику.
- **APK:** выпуски репозитория — файл `aikido-sekciya.apk`
  (страница внутри приложения, работает в один тап с экрана телефона).

## Как пользоваться

### На iPhone — «На экран Домой»

1. Открой адрес сайта в Safari.
2. Кнопка «Поделиться» → «На экран "Домой"» → «Добавить».
3. Значок 合 появится на домашнем экране — открывается как приложение
   во весь экран (без адресной строки Safari), отметки «знаю» хранятся
   на телефоне.

### На Android — APK из выпуска

1. Открой страницу выпусков репозитория → последний `aikido-sekciya.apk`.
2. Скачай, открой файл, разреши установку из этого источника (Android
   спросит один раз).
3. Значок 合 — в списке приложений. Страница та же, что на сайте;
   отметки «знаю» — в памяти приложения.

## Как играются ролики

- Плеер — **YouTube IFrame API** на хосте `youtube-nocookie.com`
  (облегчённый домен без рекламных кук). Номер ролика берётся из
  `kyu.json`. Источник поведения — документация YouTube:
  `developers.google.com/youtube/iframe_api_reference` (событие
  `onError`, коды 101/150 — «владелец запретил встраивание», 153 —
  отказ плеера).
- Плеер отказал или `iframe_api` не загрузился — на его месте (и всегда
  рядом) ссылка **«Открыть в YouTube»** `watch?v=<номер>`.
- В APK ссылка открывается во **внешнем приложении** (системный
  браузер или YouTube), а не внутри WebView: WebView передаёт
  `window.open(..., '_blank')` системе — поведение по документации
  Capacitor (`capacitorjs.com`, раздел про WebView и внешние ссылки).
- Приложение никуда не ходит, кроме YouTube: серверов у него нет,
  `capacitor.config.json` без `server.url`, `cleartext` не разрешён.

## Что внутри

```
www/                 страничка (vanilla JS, hash-роутинг, без зависимостей)
  index.html         вход; все пути относительные — сайт живёт в подпапке Pages
  app.js             экраны: кю 6…1 → связки → техника; «Другие приёмы»; «знаю»
  kyu.json           программы и номера роликов
  manifest.webmanifest + icon-*.png   PWA: имя, значки, standalone
scripts/podgotovit-android.cjs   значок 合, номер сборки, правки манифеста
proverka/            adb-проверка запуска APK в эмуляторе
  zapustit-proverku.sh   установка → запуск → страница ролика → улики
  najdi-tapnut.cjs       цели тапа по дереву uiautomator
  sobrat-otchet.cjs      otchet-zapuska.json: «прошло»/«не прошло» с причинами
.github/workflows/
  pages.yml          выкладка www/ на GitHub Pages
  apk.yml            сборка APK → проверка запуска → выпуск по тегу v*
```

## Сборка и проверка (CI)

- **pages.yml** — пуш в `main` (или руками) выкладывает `www/` на
  GitHub Pages официальными `configure-pages` → `upload-pages-artifact`
  → `deploy-pages`.
- **apk.yml** — `workflow_dispatch` и теги `v*`:
  1. `apk`: Node 24, Java 21, Gradle 8.11.1, `npx cap add android` →
     `podgotovit-android.cjs` → `cap sync` → Gradle. С секретами
     `AIKIDO_SEKCIYA_KEYSTORE_B64`, `AIKIDO_SEKCIYA_KEYSTORE_PASS`,
     `AIKIDO_SEKCIYA_KEY_ALIAS`, `AIKIDO_SEKCIYA_KEY_PASS` APK
     подписывается своим ключом (следующий APK ставится поверх
     прежнего); без секретов — debug-подпись.
  2. `zapusk`: эмулятор API 34 x86_64, `target: default` (службы
     Google WebView-приложению не нужны) — устанавливает APK, запускает
     приложение, открывает страницу ролика и проверяет: приложение в
     фокусе, снимки не пустые, на странице ролика плеер YouTube или
     ссылка «Открыть в YouTube». Отчёт `otchet-zapuska.json` и снимки —
     артефактом прогона.
  3. `reliz` (только теги `v*`, после зелёной проверки): APK кладётся в
     выпуск `softprops/action-gh-release`.
- Все сторонние действия закреплены по полному хэшу коммита.

## Локальная сборка

```bash
npm install            # Capacitor 8 (точные версии)
npx cap add android    # платформа android/ (в .gitignore)
node scripts/podgotovit-android.cjs
npx cap sync android
cd android && ./gradlew assembleDebug   # debug-APK для телефона
```

Страничку без приложения можно смотреть любым статическим сервером из
`www/` — все пути относительные.
