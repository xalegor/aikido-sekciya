#!/usr/bin/env bash
# zapustit-proverku.sh — adb-сценарий проверки запуска APK «Айкидо» для
# секции в эмуляторе. Исполняется внутри шага
# reactivecircus/android-emulator-runner на машине сборки: эмулятор уже
# поднят, adb доступен.
#
# Серверов у приложения нет: страница своя внутри APK, ролики играет
# YouTube. В эмуляторе target: default нет служб Google и до YouTube
# путь может не открыться — тогда плеер заменяется ссылкой «Открыть в
# YouTube»; пункт «rolik» засчитывает плеер или ссылку.
#
# Собирает улики в $REZ и вызывает sobrat-otchet.cjs — код выхода
# сценария = код отчёта (любой красный пункт — работа красная).
# Сбои сбора не роняют сценарий сами — недостающую улику засчитает
# отчёт.
#
# Переменные: REZ (каталог улик), TEKHNIKA (приём для страницы ролика,
# по умолчанию «Ikkyo» — первая техника 6 кю), METKA (заголовок
# странички в дереве, по умолчанию «Program za polaganje»).
set -u

PAKET=aikido.sekciya
APK="apk/aikido-sekciya.apk"
REZ="${REZ:-${RUNNER_TEMP:?переменная RUNNER_TEMP обязательна}/rez}"
TEKHNIKA="${TEKHNIKA:-Ikkyo}"
METKA="${METKA:-Program za polaganje}"
mkdir -p "$REZ"

echo "== ожидание загрузки эмулятора =="
adb wait-for-device
adb shell 'while [ -z "$(getprop sys.boot_completed)" ]; do sleep 2; done'

# Системные окна ошибок перехватывают передний план у приложения —
# ждём спокойной системы, запрещаем показ окон ошибок и перед запуском
# и внутри ожидания переднего плана закрываем системные окна.
anrAktiven() { # 0 — живой ANR: процесс в notResponding или окно ANR в фокусе
  adb shell dumpsys activity 2>/dev/null \
    | grep -qE "mNotResponding=true|Application Not Responding" && return 0
  adb shell dumpsys window 2>/dev/null \
    | grep -q "Application Not Responding" && return 0
  return 1
}
SPOKOJ_SEKUND="${SPOKOJ_SEKUND:-60}"
zhdatSpokojSistemy() {
  for _i in $(seq 1 "$SPOKOJ_SEKUND"); do
    gotov=1
    [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ] || gotov=0
    [ "$(adb shell getprop dev.bootcomplete 2>/dev/null | tr -d '\r')" = "1" ] || gotov=0
    anrAktiven && gotov=0
    [ "$gotov" = 1 ] && return 0
    sleep 1
  done
  echo "== система не успокоилась за ${SPOKOJ_SEKUND} с — продолжаю ==" >&2
  return 1
}
# 0 — окно ANR было в фокусе (закрыто KEYCODE_BACK), 1 — фокус чист
zakrytSistemy() {
  adb shell am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS \
    >/dev/null 2>&1 || true
  if adb shell dumpsys window 2>/dev/null \
      | grep -q "mCurrentFocus.*Application Not Responding"; then
    adb shell input keyevent KEYCODE_BACK >/dev/null 2>&1 || true
    return 0
  fi
  return 1
}

echo "== жду спокойной системы (без активных ANR, до $SPOKOJ_SEKUND с) =="
zhdatSpokojSistemy || true
# ненулевое HIDE_ERROR_DIALOGS скрывает все системные окна ошибок —
# и падения, и ANR; система идёт дальше, как будто окно приняли
adb shell settings put global hide_error_dialogs 1 2>/dev/null || true

echo "== установка $APK =="
adb install -r "$APK" 2>&1 | tee "$REZ/ustanovka.txt"

# запуск — опрос до переднего плана пакета, не фиксированный сон
PEREDNIJ_SEKUND="${PEREDNIJ_SEKUND:-20}"
perednijPlan() { # <пакет> [предел_сек] — 0, когда пакет вышел на передний план
  local pk="$1" predel="${2:-$PEREDNIJ_SEKUND}" _p
  for _p in $(seq 1 "$predel"); do
    # каждый опрос — с закрытием системных окон: окно ANR могло всплыть
    # посреди ожидания и его не засчитываем за приложение
    if ! zakrytSistemy; then
      adb shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus.*${pk}/" && return 0
      adb shell dumpsys activity activities 2>/dev/null \
        | grep -qE "(topResumedActivity|mResumedActivity).*[[:space:]]${pk}/" && return 0
    fi
    sleep 1
  done
  echo "perednijPlan: $pk не вышел на передний план за ${predel} с" >&2
  return 1
}

# окно ANR могло всплыть ПОСЛЕДНИМ в шаге и съесть страницу — каждый
# шаг «открыть страницу или ждать передний план» повторяется один раз,
# если окно было в фокусе после него
NAVLOG="$REZ/nav-zhurnal.txt"
: > "$NAVLOG"
navlog() { echo "$(date -u +%H:%M:%S) $*" >> "$NAVLOG"; }
sPovtoromAnr() { # <название> <команда> [аргументы…]
  local nazv="$1"; shift
  "$@" || true
  if zakrytSistemy; then
    navlog "шаг «${nazv}»: окно ANR в фокусе после шага — закрыто, повторяю один раз"
    echo "== шаг «${nazv}»: окно ANR закрыто — повторяю один раз =="
    "$@" || true
    zakrytSistemy || true
  fi
}

echo "== запуск $PAKET =="
adb logcat -c 2>/dev/null || true
zapuskApp() { # monkey + ожидание переднего плана
  zakrytSistemy || true
  adb shell monkey -p "$PAKET" -c android.intent.category.LAUNCHER 1 2>&1 | tail -3 || true
  perednijPlan "$PAKET" || true
}
sPovtoromAnr "запуск $PAKET" zapuskApp

# фокус окна в момент снимка — улика «на снимке приложение, а не стол»
fokus() { # <файл> — dumpsys window + activity в артефакт
  { adb shell dumpsys window 2>/dev/null
    adb shell dumpsys activity activities 2>/dev/null; } > "$1" || true
}

# дерево экрана: одиночный дамп и дамп с ожиданием текста WebView
# (uiautomator может снять семь пустых узлов раньше, чем WebView отдал
# a11y-контент — дамп повторяется до текста)
dump() { # <файл> — свежий дамп дерева экрана
  adb shell uiautomator dump /sdcard/_t.xml >/dev/null 2>&1 || return 1
  adb pull /sdcard/_t.xml "$1" >/dev/null 2>&1 || return 1
}
DEREVO_TEXT_SEKUND="${DEREVO_TEXT_SEKUND:-30}"
dumpZhiv() { # <файл> — дамп, повторяя пока в WebView не появится текст
  local f="$1" t0=$SECONDS
  while :; do
    dump "$f" || true
    node proverka/najdi-tapnut.cjs --zhiv "$f" >/dev/null 2>&1 && return 0
    [ $((SECONDS - t0)) -ge "$DEREVO_TEXT_SEKUND" ] && return 1
    sleep 2
  done
}

echo "== снимаю улики запуска =="
adb logcat -d > "$REZ/logcat.txt" 2>/dev/null || true
dumpZhiv "$REZ/ui-zapusk.xml" || true
fokus "$REZ/fokus-zapusk.txt"
adb exec-out screencap -p > "$REZ/snimok-zapusk.png" 2>/dev/null || true
echo "$METKA" > "$REZ/metka.txt"

# ---------- страница ролика: «KYU» → приём → «Открыть в YouTube» ----------
# приезд — точная строка ссылки в дереве: ссылка стоит рядом с плеером
# всегда и заменяет его при отказе — в эмуляторе без служб Google это
# единственная детерминированная улика рабочей двери к ролику
skroll() { # <файл> — свайп вверх в центре экрана
  wh=$(grep -o 'bounds="\[0,0\]\[[0-9]*,[0-9]*\]"' "$1" 2>/dev/null | head -1 \
    | sed -E 's/.*\[([0-9]+),([0-9]+)\].*/\1 \2/')
  w=${wh% *}; h=${wh#* }
  [ "${w:-0}" -gt 0 ] 2>/dev/null || { w=320; h=640; }
  adb shell input swipe $((w / 2)) $((h * 7 / 10)) $((w / 2)) $((h * 3 / 10)) 300 \
    >/dev/null 2>&1 || true
}
pribil() { grep -q "Открыть в YouTube" "$1" 2>/dev/null; }
# «страница сменилась» — сменился набор текстов дерева
otpechatok() { grep -oE '(text|content-desc)="[^"]*"' "$1" 2>/dev/null | md5sum | cut -d' ' -f1; }
zhdatSmeny() { # <отпечаток> — ждёт свежего дерева с другим отпечатком
  local stary="$1" i
  for i in 1 2 3 4 5 6 7 8; do
    sleep 1
    dump "$REZ/_nav2.xml" 2>/dev/null || continue
    [ "$(otpechatok "$REZ/_nav2.xml")" = "$stary" ] && continue
    cp "$REZ/_nav2.xml" "$REZ/_nav.xml"
    return 0
  done
  return 1
}
# нажатие с проверкой смены страницы: рамка кликабельной карточки →
# узел текста → KEYCODE_ENTER после фокуса
nazhat() { # <подстрока> — 0 сменилось; 9 нажали, не сменилось; 3 за краем; 1 нет
  local cel="$1" stary xy sposob
  stary=$(otpechatok "$REZ/_nav.xml")
  for sposob in ramka tekst enter; do
    case "$sposob" in
      ramka)
        xy=$(node proverka/najdi-tapnut.cjs "$REZ/_nav.xml" "$cel" 2>>"$NAVLOG") || return $?
        navlog "«$cel» способ ramka — тап $xy"
        adb shell input tap $xy >/dev/null 2>&1 || true ;;
      tekst)
        xy=$(node proverka/najdi-tapnut.cjs --po-tekstu "$REZ/_nav.xml" "$cel" 2>>"$NAVLOG") || return $?
        navlog "«$cel» способ tekst — тап $xy"
        adb shell input tap $xy >/dev/null 2>&1 || true ;;
      enter)
        navlog "«$cel» способ enter — KEYCODE_ENTER после фокуса"
        adb shell input keyevent KEYCODE_ENTER >/dev/null 2>&1 || true ;;
    esac
    if zhdatSmeny "$stary"; then
      navlog "«$cel» способ $sposob — страница сменилась"
      return 0
    fi
    navlog "«$cel» способ $sposob — страница не сменилась"
  done
  return 9
}
# сначала цель-приём — на странице кю «KYU» это заголовок topbar, тап
# по нему вернул бы домой
navigiruy() { # <техника> — 0: приехали на страницу ролика
  local cel rc _i
  for _i in $(seq 1 16); do
    if zakrytSistemy; then
      navlog "окно ANR в фокусе посреди навигации — закрыто (KEYCODE_BACK)"
      sleep 1
    fi
    dump "$REZ/_nav.xml" || { sleep 3; continue; }
    pribil "$REZ/_nav.xml" && return 0
    cel=""
    if grep -q "$1" "$REZ/_nav.xml"; then
      cp "$REZ/_nav.xml" "$REZ/ui-nav2.xml" 2>/dev/null || true
      cel="$1"
    elif grep -q "KYU" "$REZ/_nav.xml"; then
      cp "$REZ/_nav.xml" "$REZ/ui-nav1.xml" 2>/dev/null || true
      cel="KYU"
    fi
    if [ -z "$cel" ]; then
      navlog "ни «$1», ни «KYU» в дереве — скролл"
      skroll "$REZ/_nav.xml"; sleep 2
      continue
    fi
    nazhat "$cel"; rc=$?
    navlog "итог по «$cel»: код $rc"
    if [ "$rc" -eq 0 ]; then sleep 2
    elif [ "$rc" -eq 3 ]; then skroll "$REZ/_nav.xml"; sleep 2
    else sleep 3; fi
  done
  pribil "$REZ/_nav.xml" 2>/dev/null
}

echo "== страница ролика «$TEKHNIKA» =="
sPovtoromAnr "страница ролика «$TEKHNIKA»" navigiruy "$TEKHNIKA"
# пауза — плееру подняться или отказать и ссылке встать на его место
sleep 5
dumpZhiv "$REZ/ui-rolik.xml" || true
fokus "$REZ/fokus-rolik.txt"
adb exec-out screencap -p > "$REZ/snimok-rolik.png" 2>/dev/null || true

adb logcat -d > "$REZ/logcat-konec.txt" 2>/dev/null || true

echo "== собираю отчёт =="
node proverka/sobrat-otchet.cjs --rez "$REZ" --paket "$PAKET" --metka "$METKA"
status=$?
echo "zapustit-proverku: отчёт — $REZ/otchet-zapuska.json (код $status)"
exit "$status"
