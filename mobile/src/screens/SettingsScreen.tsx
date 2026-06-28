/**
 * SettingsScreen — ekran ustawień (node 161:12291, device_view).
 * `useSettingsScreen()` zwraca treść (slot Display) ORAZ kontekstową klawiaturę
 * z podpiętą logiką 3 klawiszy "screen":
 *   CHANGE       → zmienia wartość zaznaczonego elementu (cykl opcji, np. ON/OFF, DARK/LIGHT)
 *   BACK  → wraca do ekranu, z którego weszliśmy w ustawienia (onClose)
 *   NEXT [CYCLE] → przesuwa zaznaczenie w dół listy (z ostatniego wraca na pierwszy)
 */
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { color, font, screen, textShadow, ThemeName } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import { ScreenTopBar, BottomBar, Mode, stopBackKey } from './ScreenChrome';

const SETTINGS_KEY = 'recai.settings.v1'; // trwałość ustawień (AsyncStorage; web=localStorage)

const phosphorGlow = {
  textShadowColor: textShadow.phosphor.color,
  textShadowRadius: textShadow.phosphor.radius,
  textShadowOffset: { width: 0, height: 0 },
} as const;

/** Nagłówek sekcji (RECORDING / PLAYBACK / OTHER) — wyśrodkowany, phosphor. */
function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <Text
      style={{
        fontFamily: font.uiLabel.family,
        fontSize: font.uiLabel.size,
        color: screen.olive.primary,
        textAlign: 'center',
        ...phosphorGlow,
      }}
    >
      {children}
    </Text>
  );
}

/** Wiersz ustawienia: etykieta (mono) z lewej, wartość (mono, większa) z prawej.
 *  `selected` = wiersz zaznaczony (tło phosphor, ciemny tekst). Klik przenosi zaznaczenie. */
function Row({
  label,
  value,
  selected = false,
  locked = false,
  onPress,
  innerRef,
}: {
  label: string;
  value: string;
  selected?: boolean;
  locked?: boolean;
  onPress?: () => void;
  innerRef?: (node: View | null) => void;
}) {
  const fg = selected ? color.dark21 : screen.olive.primary;
  const glow = selected ? null : phosphorGlow;
  // wartość zablokowana → kolor inactive (wygaszona), bez glow
  const valueColor = locked ? screen.olive.inactive : fg;
  return (
    <Pressable
      ref={innerRef as any}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        alignSelf: 'stretch',
        gap: 24,
        paddingHorizontal: 4,
        paddingVertical: 2,
        borderRadius: 2,
        backgroundColor: selected ? screen.olive.primary : 'transparent',
      }}
    >
      <Text
        style={{ flex: 1, fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: fg, ...glow }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontFamily: font.monoHeading.family,
          fontSize: font.monoHeading.size,
          color: valueColor,
          textAlign: 'right',
          ...(locked ? null : glow),
        }}
      >
        {value}
      </Text>
    </Pressable>
  );
}

function Section({ header, children }: { header: string; children: ReactNode }) {
  return (
    <View style={{ alignSelf: 'stretch', gap: 8 }}>
      <SectionHeader>{header}</SectionHeader>
      {children}
    </View>
  );
}

/**
 * Czy sprzęt nagrywa w stereo. Na razie mock (na webie brak detekcji; docelowo z natywnego API).
 * Gdy false → RECORD MONO wymuszony ON i zablokowany (wartość w kolorze inactive).
 */
const STEREO_CAPABLE = true;

/** Element ustawienia: etykieta + lista wartości + indeks bieżącej. `locked` = nie do zmiany (wartość wygaszona). */
type Item = { label: string; options: string[]; value: number; locked?: boolean };
type SectionData = { header: string; items: Item[] };

/** Stan początkowy (wartości jak w Figmie). Większość to przełącznik OFF/ON. */
const INITIAL_SECTIONS: SectionData[] = [
  {
    header: 'RECORDING',
    items: [
      { label: 'KEEP SCREEN ON', options: ['OFF', 'ON'], value: 1 },
      // brak stereo → MONO wymuszony ON i zablokowany
      { label: 'RECORD MONO', options: ['OFF', 'ON'], value: STEREO_CAPABLE ? 0 : 1, locked: !STEREO_CAPABLE },
      { label: 'SAVE UNCOMPRESSED\n(VERY LARGE FILES)', options: ['OFF', 'ON'], value: 0 },
    ],
  },
  {
    header: 'PLAYBACK',
    items: [
      { label: 'AUTO TRANSCRIBE', options: ['OFF', 'ON'], value: 1 },
      { label: 'SHOW TIME LEFT', options: ['OFF', 'ON'], value: 0 },
    ],
  },
  {
    header: 'OTHER',
    items: [
      { label: 'THEME', options: ['LIGHT', 'DARK', 'ORANGE', 'NAVY'], value: 0 },
      { label: 'FULLSCREEN', options: ['OFF', 'ON'], value: 0 },
      { label: 'MOTION', options: ['OFF', 'ON'], value: 1 },
      { label: 'REC AS START PAGE', options: ['OFF', 'ON'], value: 0 },
      { label: 'LEFT-HANDED MODE', options: ['OFF', 'ON'], value: 0 },
    ],
  },
];

const TOTAL_ITEMS = INITIAL_SECTIONS.reduce((n, s) => n + s.items.length, 0);
/** Indeks startowy każdej sekcji w spłaszczonej liście (do mapowania zaznaczenia). */
const SECTION_STARTS = (() => {
  const out: number[] = [];
  let acc = 0;
  for (const s of INITIAL_SECTIONS) {
    out.push(acc);
    acc += s.items.length;
  }
  return out;
})();

/**
 * Hook ekranu Settings — trzyma stan (wartości + zaznaczony element) i zwraca
 * gotową treść do slotu Display oraz kontekstową klawiaturę z podpiętą logiką.
 */
export function useSettingsScreen({
  onClose,
  mode = 'SETTINGS',
  onCycleMode,
}: { onClose?: () => void; mode?: Mode; onCycleMode?: () => void } = {}) {
  const [sections, setSections] = useState<SectionData[]>(INITIAL_SECTIONS);
  const [selected, setSelected] = useState(0); // indeks w spłaszczonej liście; domyślnie pierwszy
  const hydrated = useRef(false); // czy wczytano zapisane ustawienia

  // wczytaj zapisane wartości po starcie (mapa label→value), z poszanowaniem locked
  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw) as Record<string, number>;
          setSections((prev) =>
            prev.map((sec) => ({
              ...sec,
              items: sec.items.map((it) =>
                !it.locked && saved[it.label] != null && saved[it.label] < it.options.length
                  ? { ...it, value: saved[it.label] }
                  : it
              ),
            }))
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        hydrated.current = true;
      });
  }, []);

  // zapisuj przy każdej zmianie (dopiero po wczytaniu, by nie nadpisać domyślnymi)
  useEffect(() => {
    if (!hydrated.current) return;
    const map: Record<string, number> = {};
    sections.forEach((s) => s.items.forEach((it) => (map[it.label] = it.value)));
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(map)).catch(() => {});
  }, [sections]);

  // Auto-scroll: zawsze trzymamy zaznaczony wiersz w widoku szyby.
  const scrollRef = useRef<ScrollView>(null);
  const contentRef = useRef<View>(null);
  const rowRefs = useRef<Map<number, View>>(new Map());
  const offsetRef = useRef(0); // bieżące przewinięcie
  const viewportRef = useRef(0); // wysokość okna scrolla

  useEffect(() => {
    const node = rowRefs.current.get(selected);
    if (!node || !contentRef.current || !scrollRef.current) return;
    const pad = 8;
    node.measureLayout(
      contentRef.current as any,
      (_x, y, _w, h) => {
        const top = offsetRef.current;
        const vh = viewportRef.current;
        if (y - pad < top) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - pad), animated: true });
        } else if (vh > 0 && y + h + pad > top + vh) {
          scrollRef.current?.scrollTo({ y: y + h + pad - vh, animated: true });
        }
      },
      () => {}
    );
  }, [selected]);

  // Zaznaczenie w dół / w górę (z zawijaniem). NEXT[CYCLE] i przycisk fwd → dół; prev → góra.
  const move = (dir: -1 | 1) => setSelected((i) => (i + dir + TOTAL_ITEMS) % TOTAL_ITEMS);

  // Zmiana wartości elementu o indeksie `idx` o `dir` opcji (locked → bez zmian).
  const changeAt = (idx: number, dir: -1 | 1) =>
    setSections((prev) => {
      let flat = -1;
      return prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => {
          flat++;
          if (flat !== idx || it.locked) return it;
          const n = it.options.length;
          return { ...it, value: (it.value + dir + n) % n };
        }),
      }));
    });
  // CHANGE / wychylenie slidera → zmiana zaznaczonego.
  const changeBy = (dir: -1 | 1) => changeAt(selected, dir);
  // Ustaw FULLSCREEN wprost (np. z gestu pinch na ekranie) — trzyma synchronizację z przełącznikiem.
  const setFullscreen = (on: boolean) =>
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.label === 'FULLSCREEN' ? { ...it, value: on ? 1 : 0 } : it)),
      }))
    );
  // Tap w wiersz → zaznacz i przełącz jego wartość na następną.
  const tapRow = (idx: number) => {
    setSelected(idx);
    changeAt(idx, 1);
  };

  const keyboard: KeyboardConfig = {
    screen: [
      { label: 'CHANGE', variant: 'primary', onPress: () => changeBy(1) },
      { label: '' },
      { label: 'NEXT', supporting: '[CYCLE]', onPress: () => move(1) },
    ],
    metal: [
      // metal[0] = stały fizyczny STOP/BACK; w ustawieniach STOP zgaszony, BACK świeci (wyjście do poprz. ekranu)
      stopBackKey({ canStop: false, onBack: onClose }),
      { type: 'record' },
      { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false },
    ],
  };

  // Slider podświetlony i aktywny: prev/next wybierają element listy, knob zmienia parametr.
  const slider = {
    highlighted: true,
    discrete: true, // ustawienia: knob dyskretny (zmiana o krok przy 10% wychylenia), bez narastania
    onPrev: () => move(-1),
    onNext: () => move(1),
    onAdjust: (dir: -1 | 1) => changeBy(dir),
  };

  const content = (
    <>
      <ScreenTopBar mode={mode} onCycleMode={onCycleMode} />

      {/* content_area: scrollowalna lista (bottom_bar zostaje przypięty pod spodem).
          Auto-scroll trzyma zaznaczony wiersz w widoku. */}
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, alignSelf: 'stretch' }}
        contentContainerStyle={{ gap: 24, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
          offsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        onLayout={(e: LayoutChangeEvent) => {
          viewportRef.current = e.nativeEvent.layout.height;
        }}
      >
        <View ref={contentRef} style={{ gap: 24 }}>
          {sections.map((section, si) => (
            <Section key={section.header} header={section.header}>
              {section.items.map((item, ii) => {
                const flat = SECTION_STARTS[si] + ii;
                return (
                  <Row
                    key={item.label}
                    innerRef={(node) => {
                      if (node) rowRefs.current.set(flat, node);
                      else rowRefs.current.delete(flat);
                    }}
                    label={item.label}
                    value={item.options[item.value]}
                    selected={flat === selected}
                    locked={item.locked}
                    onPress={() => tapRow(flat)}
                  />
                );
              })}
            </Section>
          ))}
        </View>
      </ScrollView>

      <BottomBar />
    </>
  );

  // Bieżące wartości sterujące obudową: FULLSCREEN (wariant) i THEME (motyw koloru).
  const flat = sections.flatMap((s) => s.items);
  const fullscreenItem = flat.find((it) => it.label === 'FULLSCREEN');
  const fullscreen = fullscreenItem ? fullscreenItem.options[fullscreenItem.value] === 'ON' : false;
  const themeItem = flat.find((it) => it.label === 'THEME');
  const theme = (themeItem ? themeItem.options[themeItem.value] : 'LIGHT') as ThemeName;
  const motionItem = flat.find((it) => it.label === 'MOTION');
  const motion = motionItem ? motionItem.options[motionItem.value] === 'ON' : false;
  const lhItem = flat.find((it) => it.label === 'LEFT-HANDED MODE');
  const leftHanded = lhItem ? lhItem.options[lhItem.value] === 'ON' : false;
  const atItem = flat.find((it) => it.label === 'AUTO TRANSCRIBE');
  const autoTranscribe = atItem ? atItem.options[atItem.value] === 'ON' : false;
  const rmItem = flat.find((it) => it.label === 'RECORD MONO');
  const recordMono = rmItem ? rmItem.options[rmItem.value] === 'ON' : false;

  return { content, keyboard, slider, fullscreen, setFullscreen, theme, motion, leftHanded, autoTranscribe, recordMono };
}
