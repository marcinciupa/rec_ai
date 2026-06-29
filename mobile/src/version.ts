// Numer builda (jedno źródło prawdy dla wyświetlania w apce). Trzymać w synchronie z app.json:
//   version === APP_VERSION,  versionCode === round(APP_VERSION * 10000)  (0.963 → 9630, 0.9635 → 9635, 0.964 → 9640).
// Konwencja: zmiana normalna = +0.001 (3. cyfra: 0.963 → 0.964); mała zmiana = 4. cyfra (0.963 → 0.9635).
// versionCode liczone ×10000 (zmiana z ×1000), żeby 4. cyfra dawała unikalny, ROSNĄCY versionCode dla Google Play.
export const APP_VERSION = '0.9665';
