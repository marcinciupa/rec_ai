// Config-plugin: wstrzykuje do android/app/build.gradle konfigurację podpisu UPLOADOWEGO do Google Play.
// Katalog android/ jest generowany (gitignore) — bez tego pluginu `expo prebuild --clean` kasował ręczną
// edycję build.gradle i release wychodził podpisany kluczem DEBUG, którego Play odrzuca.
//
// Sam klucz i hasła są POZA repo — w ~/.gradle/gradle.properties:
//   RECAI_UPLOAD_STORE_FILE, RECAI_UPLOAD_STORE_PASSWORD, RECAI_UPLOAD_KEY_ALIAS, RECAI_UPLOAD_KEY_PASSWORD
// Gdy właściwości nie ma (np. inna maszyna, CI bez sekretów), release spada na debug-keystore —
// build się wykonuje, ale TAKIEGO artefaktu nie wolno wysyłać na Play.
const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = 'RECAI_UPLOAD_STORE_FILE';

const RELEASE_SIGNING_CONFIG = `        release {
            // Klucz uploadowy do Google Play — z ~/.gradle/gradle.properties (RECAI_UPLOAD_*), poza repo.
            if (project.hasProperty('RECAI_UPLOAD_STORE_FILE')) {
                storeFile file(RECAI_UPLOAD_STORE_FILE)
                storePassword RECAI_UPLOAD_STORE_PASSWORD
                keyAlias RECAI_UPLOAD_KEY_ALIAS
                keyPassword RECAI_UPLOAD_KEY_PASSWORD
            }
        }
`;

module.exports = function withAndroidReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withAndroidReleaseSigning: oczekiwano build.gradle w Groovy');
    }
    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg; // już wstrzyknięte (prebuild bez --clean)

    // 1) Dopisz blok release na KOŃCU signingConfigs { … }. Koniec bloku znajdujemy licząc klamry —
    // regex „do pierwszego `}`" wpadał w zamknięcie zagnieżdżonego `debug {}` i wstawiał release
    // WEWNĄTRZ debug (gradle: „Could not find method release()").
    // Anchor na SAM OTWIERAJĄCY blok, nie na gołe słowo — inaczej wzmianka „signingConfigs"
    // w komentarzu szablonu przestawiłaby licznik klamer na przypadkowy `{`.
    const opener = /signingConfigs\s*\{/.exec(src);
    if (!opener) {
      throw new Error('withAndroidReleaseSigning: nie znaleziono bloku signingConfigs w build.gradle');
    }
    const brace = opener.index + opener[0].length - 1;
    let depth = 0;
    let close = -1;
    for (let i = brace; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) { close = i; break; }
    }
    if (close < 0) {
      throw new Error('withAndroidReleaseSigning: niedomknięty blok signingConfigs w build.gradle');
    }
    // `close` wskazuje `}` domykający signingConfigs — wstawiamy tuż przed jego wcięciem.
    const lineStart = src.lastIndexOf('\n', close) + 1;
    src = src.slice(0, lineStart) + RELEASE_SIGNING_CONFIG + src.slice(lineStart);

    // 2) buildTypes.release → podmień domyślny `signingConfig signingConfigs.debug` na warunkowy.
    // Szablon wstawia między `release {` a tą linią komentarz „Caution! …own keystore" — stąd
    // leniwe `[\s\S]*?` zamiast samego `\n`. Komentarz zostaje wycięty razem z linią (nieaktualny:
    // własny keystore MAMY, tylko poza repo).
    const releaseSigning =
      /(buildTypes\s*\{[\s\S]*?\n\s*release\s*\{\n)(?:[ \t]*\/\/[^\n]*\n)*([ \t]*)signingConfig signingConfigs\.debug\n/;
    if (!releaseSigning.test(src)) {
      throw new Error('withAndroidReleaseSigning: nie znaleziono signingConfig w buildTypes.release');
    }
    src = src.replace(
      releaseSigning,
      `$1$2// Podpis uploadowy do Google Play; fallback na debug, gdy brak właściwości RECAI_UPLOAD_*.\n` +
        `$2signingConfig project.hasProperty('RECAI_UPLOAD_STORE_FILE') ? signingConfigs.release : signingConfigs.debug\n`
    );

    cfg.modResults.contents = src;
    return cfg;
  });
};
