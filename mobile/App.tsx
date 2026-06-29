import { useState, useEffect, useRef } from 'react';
import { View, Text, Platform, StatusBar as RNStatusBar, BackHandler, useWindowDimensions } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { themes } from './src/theme/tokens';
import {
  useFonts,
  Inter_400Regular,
  Inter_500Medium,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import { KodeMono_400Regular, KodeMono_700Bold } from '@expo-google-fonts/kode-mono';
import * as SplashScreen from 'expo-splash-screen';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceShell } from './src/components/chrome/DeviceShell';
import { KeyboardConfig } from './src/components/chrome/Keyboard';
import { useSettingsScreen } from './src/screens/SettingsScreen';
import { WelcomeDialog } from './src/screens/WelcomeDialog';
import { useRecordingScreen } from './src/screens/RecordingScreen';
import { usePlaybackScreen } from './src/screens/PlaybackScreen';
import { useRecordings } from './src/hooks/useRecordings';
import { useTranscription } from './src/hooks/useTranscription';
import { Mode, nextMode } from './src/screens/ScreenChrome';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

// Android dodaje includeFontPadding (extra padding wg metryk fontu) → linia tekstu wyższa niż w Figmie/na web.
// Wyłączamy globalnie, by wysokość linii (zwł. Kode Mono) zgadzała się z projektem. (Na web/iOS no-op.)
const TextWithDefaults = Text as unknown as { defaultProps?: { includeFontPadding?: boolean } };
TextWithDefaults.defaultProps = { ...(TextWithDefaults.defaultProps || {}), includeFontPadding: false };

// trzymaj natywny (czarny) splash aż do załadowania fontów → brak białego błyśnięcia
SplashScreen.preventAutoHideAsync();

export default function App() {
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_700Bold,
    KodeMono_400Regular,
    KodeMono_700Bold,
  });
  // MUSI być przed wczesnym returnem (font gate) — inaczej liczba hooków się zmienia między renderami.
  const { width: winW, height: winH } = useWindowDimensions();

  // Tryb (zakamuflowany przełącznik w pasku ekranu): RECORDING / PLAYBACK / SETTINGS.
  const [mode, setMode] = useState<Mode>('RECORDING');
  const cycleMode = () => setMode((m) => nextMode(m));
  // ostatni tryb inny niż SETTINGS — żeby BACK z ustawień wracał tam, skąd weszliśmy
  const prevModeRef = useRef<Mode>('RECORDING');
  useEffect(() => {
    if (mode !== 'SETTINGS') prevModeRef.current = mode;
  }, [mode]);
  const closeSettings = () => setMode(prevModeRef.current);
  // po zapisaniu nagrania PLAY przenosi do PLAYBACK i otwiera player tego pliku (autostart)
  const [pendingPlay, setPendingPlay] = useState<string | null>(null);
  // czat → tryb pisania: klawiatura systemowa, fullscreen + schowana dolna obudowa (slider/klawiatura/mic)
  const [chatTyping, setChatTyping] = useState(false);
  // onboarding (pierwsze uruchomienie): pytamy o domyślny język/motyw/fullscreen. null = jeszcze nie sprawdzono.
  const [showWelcome, setShowWelcome] = useState<boolean | null>(null);
  useEffect(() => {
    AsyncStorage.getItem('recai.welcome.v1')
      .then((v) => setShowWelcome(!v))
      .catch(() => setShowWelcome(false));
  }, []);
  const finishWelcome = () => {
    AsyncStorage.setItem('recai.welcome.v1', '1').catch(() => {});
    setShowWelcome(false);
  };

  // Wspólny store nagrań — dzielony przez nagrywanie (zapis) i playback (lista).
  const recStore = useRecordings();
  // Manager realnej transkrypcji (upload → backend deAPI), dzielony przez oba ekrany.
  const transcription = useTranscription(recStore);

  // Oba hooki zawsze zamontowane (reguły hooków + zachowanie stanu między trybami).
  const settings = useSettingsScreen({ onClose: closeSettings, mode, onCycleMode: cycleMode });
  const recording = useRecordingScreen({
    aiEnabled: settings.autoTranscribe,
    mono: settings.recordMono,
    quality: settings.recordQuality,
    mode,
    onCycleMode: cycleMode,
    onOpenSettings: () => setMode('SETTINGS'),
    onOpenRecordings: () => setMode('PLAYBACK'),
    onOpenPlayer: (id) => {
      setPendingPlay(id);
      setMode('PLAYBACK');
    },
    onSave: recStore.add,
    recordings: recStore.recordings,
    transcription,
  });
  const playback = usePlaybackScreen({
    store: recStore,
    mono: settings.recordMono,
    language: settings.language,
    showTimeLeft: settings.showTimeLeft,
    onTyping: setChatTyping,
    mode,
    onCycleMode: cycleMode,
    onOpenSettings: () => setMode('SETTINGS'),
    onStartRecording: () => setMode('RECORDING'),
    transcription,
    pendingPlayId: pendingPlay,
    onConsumePending: () => setPendingPlay(null),
  });
  // tryb pisania w czacie wymusza fullscreen + schowaną dolną obudowę; po wyjściu wraca do ustawienia użytkownika
  const variant = settings.fullscreen || chatTyping ? 'fullscreen' : 'device';

  // KEEP SCREEN ON: gdy włączone, nie usypiaj ekranu (expo-keep-awake). Web = wake lock (best-effort).
  useEffect(() => {
    if (settings.keepScreenOn) activateKeepAwakeAsync('recai').catch(() => {});
    else deactivateKeepAwake('recai').catch(() => {});
    return () => { deactivateKeepAwake('recai').catch(() => {}); };
  }, [settings.keepScreenOn]);

  // Systemowy back (Android): playback(panel→lista→nagrywanie), settings→nagrywanie, nagrywanie→wyjście.
  const backRef = useRef<() => boolean>(() => false);
  backRef.current = () => {
    if (mode === 'PLAYBACK') {
      if (playback.goBack?.()) return true; // zamknij panel / wyjdź z odtwarzacza do listy
      setMode('RECORDING'); // z listy → ekran nagrywania
      return true;
    }
    if (mode === 'SETTINGS') {
      closeSettings(); // wróć do ekranu, z którego weszliśmy w ustawienia
      return true;
    }
    return false; // RECORDING → domyślne (wyjście z apki)
  };
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => backRef.current());
    return () => sub.remove();
  }, []);
  // Web (podgląd): brak systemowego back → Escape pełni jego rolę (zamyka panele/menu, wychodzi z odtwarzacza).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') backRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  let content;
  let baseKeyboard;
  if (mode === 'SETTINGS') {
    content = settings.content;
    baseKeyboard = settings.keyboard;
  } else if (mode === 'RECORDING') {
    content = recording.content;
    baseKeyboard = recording.keyboard;
  } else {
    // PLAYBACK
    content = playback.content;
    baseKeyboard = playback.keyboard;
  }
  // LEFT-HANDED MODE: zamiana klawisza 1 i 3 (górny rząd "screen").
  const handed: KeyboardConfig =
    settings.leftHanded && baseKeyboard.screen.length >= 3
      ? { ...baseKeyboard, screen: [baseKeyboard.screen[2], baseKeyboard.screen[1], baseKeyboard.screen[0]] }
      : baseKeyboard;
  // Poza ekranem nagrywania klawisz ⏺ przenosi do nagrywania — CHYBA że ekran nadał mu własną akcję
  // (np. czat: ⏺ = nagraj pytanie głosem). Nadpisujemy tylko klawisz bez zdefiniowanego onPress.
  const keyboard: KeyboardConfig =
    mode === 'RECORDING'
      ? handed
      : { ...handed, metal: handed.metal.map((k) => (k.type === 'record' && !k.onPress ? { ...k, onPress: () => setMode('RECORDING') } : k)) };
  const slider = mode === 'SETTINGS' ? settings.slider : mode === 'PLAYBACK' ? playback.slider : undefined;
  // onboarding: klawiatura ograniczona do CONFIRM (środkowy klawisz, wariant fosforowy = primary); reszta wyłączona,
  // by nie wchodzić w interakcję z ekranem pod spodem. CONFIRM zamyka onboarding (finishWelcome).
  const welcomeKeyboard: KeyboardConfig = {
    screen: [{ label: '' }, { label: 'CONFIRM', variant: 'primary', onPress: finishWelcome }, { label: '' }],
    metal: [
      { type: 'label', upper: 'STOP', lower: 'BACK', active: false },
      { type: 'record' },
      { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false },
    ],
  };
  const finalKeyboard = showWelcome ? welcomeKeyboard : keyboard;

  // schowaj splash dopiero gdy fonty gotowe (płynne przejście, bez białego błysku)
  useEffect(() => {
    if (fontsLoaded) SplashScreen.hideAsync().catch(() => {});
  }, [fontsLoaded]);

  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: '#000000' }} />;
  }

  // device: gadżet pod systemowym paskiem statusu. fullscreen: edge-to-edge (odstęp robi DeviceShell wewnątrz).
  const topInset = Platform.OS === 'android' && variant === 'device' ? RNStatusBar.currentHeight || 0 : 0;
  const barStyle = themes[settings.theme].casingDark ? 'light' : 'dark';
  // PODGLĄD WEB: skaluj całe urządzenie 390×844 do okna (zachowując proporcje), zamiast rozciągać
  // width/height:100% niezależnie — przy oknie niższym niż 844 ekran (flex) inaczej się ściska.
  const webScale = Platform.OS === 'web' ? Math.min(winW / 390, winH / 844, 1) : 1;

  return (
    <View
      style={{
        flex: 1,
        paddingTop: topInset,
        backgroundColor: '#000',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* ramka telefonu: web = stałe 390×844 przeskalowane do okna (proporcje OK); natywnie wypełnia */}
      <View
        style={
          Platform.OS === 'web'
            ? { width: 390, height: 844, transform: [{ scale: webScale }], overflow: 'hidden' }
            : { width: '100%', height: '100%', overflow: 'hidden' }
        }
      >
        <DeviceShell
          variant={variant}
          recording={mode === 'RECORDING' && recording.isRecording}
          muted={mode === 'RECORDING' && recording.isMuted}
          theme={settings.theme}
          motion={settings.motion}
          keyboard={finalKeyboard}
          slider={showWelcome ? undefined : slider}
          hideControls={chatTyping}
          onPinch={(dir) => settings.setFullscreen(dir === 'out')}
        >
          {content}
          {/* onboarding mieści się W EKRANIE urządzenia (slot Display), jak inne dialogi */}
          {showWelcome ? <WelcomeDialog optionOf={settings.optionOf} cycleByLabel={settings.cycleByLabel} /> : null}
        </DeviceShell>
      </View>

      <StatusBar style={barStyle} />
    </View>
  );
}
