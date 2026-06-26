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
import { DeviceShell } from './src/components/chrome/DeviceShell';
import { KeyboardConfig } from './src/components/chrome/Keyboard';
import { useSettingsScreen } from './src/screens/SettingsScreen';
import { useRecordingScreen } from './src/screens/RecordingScreen';
import { usePlaybackScreen } from './src/screens/PlaybackScreen';
import { useRecordings } from './src/hooks/useRecordings';
import { useTranscription } from './src/hooks/useTranscription';
import { Mode, nextMode } from './src/screens/ScreenChrome';

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

  // Wspólny store nagrań — dzielony przez nagrywanie (zapis) i playback (lista).
  const recStore = useRecordings();
  // Manager realnej transkrypcji (upload → backend deAPI), dzielony przez oba ekrany.
  const transcription = useTranscription(recStore);

  // Oba hooki zawsze zamontowane (reguły hooków + zachowanie stanu między trybami).
  const settings = useSettingsScreen({ onClose: closeSettings, mode, onCycleMode: cycleMode });
  const recording = useRecordingScreen({
    aiEnabled: settings.autoTranscribe,
    mono: settings.recordMono,
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
    mode,
    onCycleMode: cycleMode,
    onOpenSettings: () => setMode('SETTINGS'),
    onStartRecording: () => setMode('RECORDING'),
    transcription,
    pendingPlayId: pendingPlay,
    onConsumePending: () => setPendingPlay(null),
  });
  const variant = settings.fullscreen ? 'fullscreen' : 'device';

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
  // Poza ekranem nagrywania klawisz ⏺ ZAWSZE przenosi do nagrywania.
  const keyboard: KeyboardConfig =
    mode === 'RECORDING'
      ? handed
      : { ...handed, metal: handed.metal.map((k) => (k.type === 'record' ? { ...k, onPress: () => setMode('RECORDING') } : k)) };
  const slider = mode === 'SETTINGS' ? settings.slider : mode === 'PLAYBACK' ? playback.slider : undefined;

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
          keyboard={keyboard}
          slider={slider}
          onPinch={(dir) => settings.setFullscreen(dir === 'out')}
        >
          {content}
        </DeviceShell>
      </View>

      <StatusBar style={barStyle} />
    </View>
  );
}
