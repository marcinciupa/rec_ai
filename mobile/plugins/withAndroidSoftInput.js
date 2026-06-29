// Config-plugin: wymusza android:windowSoftInputMode="adjustNothing" na MainActivity.
// Expo (app.json softwareKeyboardLayoutMode) daje tylko "resize"/"pan" — a my chcemy, żeby okno
// NIE zmieniało rozmiaru ani się nie przesuwało: klawiatura systemowa nakłada się (oś Z) na dolną
// sekcję obudowy o jej wysokości (patrz DeviceShell.hideControls + kbH).
const { withAndroidManifest } = require('@expo/config-plugins');

const MODE = 'adjustNothing';

module.exports = function withAndroidSoftInput(config) {
  return withAndroidManifest(config, (cfg) => {
    const app = cfg.modResults.manifest.application?.[0];
    const activities = app?.activity ?? [];
    const main =
      activities.find((a) =>
        (a['intent-filter'] ?? []).some((f) =>
          (f.action ?? []).some((act) => act['$']?.['android:name'] === 'android.intent.action.MAIN')
        )
      ) ?? activities.find((a) => a['$']?.['android:name'] === '.MainActivity');
    if (main) main['$']['android:windowSoftInputMode'] = MODE;
    return cfg;
  });
};
