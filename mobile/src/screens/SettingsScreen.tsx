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
import { APP_VERSION } from '../version';

const SETTINGS_KEY = 'recai.settings.v1'; // trwałość ustawień (AsyncStorage; web=localStorage)

const phosphorGlow = {
  textShadowColor: textShadow.phosphor.color,
  textShadowRadius: textShadow.phosphor.radius,
  textShadowOffset: { width: 0, height: 0 },
} as const;

// długie pojedyncze słowa na labelach klawiszy → ręczny podział na 2 linie z dywizem
// (jak RECORD-\nINGS / TRANS-\nCRIBE). Patrz memory feedback_key_label_wrap.
const KEY_WRAP: Record<string, string> = { REMAINING: 'REMAIN-\nING', FULLSCREEN: 'FULL-\nSCREEN', 'SYSTEM DEFAULT': 'SYSTEM\nDEFAULT' };
const keyWrap = (s: string) => KEY_WRAP[s] ?? s;

// język UI z systemu (gdy UI LANGUAGE = SYSTEM DEFAULT). Intl (Hermes) → kod języka; fallback EN.
const systemLang = (): 'en' | 'pl' => {
  try {
    const loc = (Intl as any)?.DateTimeFormat?.().resolvedOptions?.().locale ?? 'en';
    return String(loc).toLowerCase().startsWith('pl') ? 'pl' : 'en';
  } catch {
    return 'en';
  }
};

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

/** Nakładka „o aplikacji" (wiersz INFO): wersja + skład techniczny. Zamyka CLOSE / fizyczny BACK. */
function InfoDialog() {
  const rows: [string, string][] = [
    ['VERSION', APP_VERSION],
    ['TRANSCRIPTION', 'deAPI · WHISPER'],
    ['CHAT', 'OPENROUTER'],
    ['PACKAGE', 'com.glue010.recai'],
  ];
  const body = { fontFamily: font.monoBody.family, fontSize: font.monoBody.size } as const;
  const cap = { fontFamily: font.caption.family, fontSize: font.caption.size } as const;
  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, backgroundColor: 'rgba(0,0,0,0.5)' }}>
      <View style={{ alignSelf: 'stretch', backgroundColor: color.dark1A, borderWidth: 1, borderColor: screen.olive.primary, borderRadius: 4, padding: 16, gap: 8, boxShadow: '0px 0px 8px 0px rgba(226,255,228,0.25)' } as any}>
        <Text style={{ ...body, fontSize: font.monoHeading.size, color: screen.olive.primary, textAlign: 'center', ...phosphorGlow }}>REC_AI</Text>
        <Text style={{ ...cap, color: screen.olive.secondary, textAlign: 'center' }}>SKEUOMORPHIC VOICE NOTES + AI</Text>
        {rows.map(([k, v]) => (
          <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
            <Text style={{ ...body, color: screen.olive.secondary }}>{k}</Text>
            <Text style={{ ...body, color: screen.olive.primary }}>{v}</Text>
          </View>
        ))}
        <Text style={{ ...cap, color: screen.olive.inactive, textAlign: 'center', marginTop: 4 }}>© 2026 · CLOSE / BACK TO RETURN</Text>
      </View>
    </View>
  );
}

/**
 * Czy sprzęt nagrywa w stereo. Na razie mock (na webie brak detekcji; docelowo z natywnego API).
 * Gdy false → RECORD MONO wymuszony ON i zablokowany (wartość w kolorze inactive).
 */
const STEREO_CAPABLE = true;

/** Element ustawienia: etykieta + lista wartości + indeks bieżącej. `locked` = nie do zmiany (wartość wygaszona).
 *  `action` = wiersz-akcja (np. INFO): CHANGE/tap/knob nie cyklują wartości, tylko odpalają nakładkę. */
// hints = opcjonalny supporting label per opcja (np. COMPRESSION HIGH→[BIG]), pokazywany na kontekstowym klawiszu #1
type Item = { label: string; options: string[]; value: number; locked?: boolean; action?: boolean; hints?: string[] };
type SectionData = { header: string; items: Item[] };

/** Stan początkowy (wartości jak w Figmie). Większość to przełącznik OFF/ON. */
const INITIAL_SECTIONS: SectionData[] = [
  {
    header: 'RECORDING',
    items: [
      { label: 'KEEP SCREEN ON', options: ['OFF', 'ON'], value: 1 },
      // brak stereo → MONO wymuszony i zablokowany
      { label: 'RECORD MODE', options: ['STEREO', 'MONO'], value: STEREO_CAPABLE ? 0 : 1, locked: !STEREO_CAPABLE },
      // jakość AAC (bitrate). HIGH = większy plik [BIG], LOW = mniejszy [SMALL].
      { label: 'COMPRESSION', options: ['HIGH', 'LOW'], hints: ['[BIG]', '[SMALL]'], value: 0 },
    ],
  },
  {
    header: 'PLAYBACK',
    items: [
      { label: 'TRANSCRIPTION', options: ['AUTO', 'MANUAL'], value: 0 },
      // język pytań i odpowiedzi AI (czat). Domyślnie ENGLISH.
      { label: 'AI LANGUAGE', options: ['ENGLISH', 'POLISH'], value: 0 },
      { label: 'PLAYBACK TIMER', options: ['ELAPSED', 'REMAINING'], value: 0 },
    ],
  },
  {
    header: 'OTHER',
    items: [
      { label: 'THEME', options: ['LIGHT', 'DARK', 'ORANGE', 'NAVY'], value: 0 },
      // język interfejsu (osobny od AI LANGUAGE). SYSTEM DEFAULT = język z systemu. INFRA: na main brak
      // jeszcze warstwy tłumaczeń (i18n) → uiLang gotowy, ale UI zostaje EN do czasu nałożenia i18n.
      { label: 'UI LANGUAGE', options: ['SYSTEM DEFAULT', 'ENGLISH', 'POLISH'], value: 0 },
      { label: 'VIEW', options: ['DEVICE', 'FULLSCREEN'], value: 0 },
      { label: 'MOTION', options: ['OFF', 'ON'], value: 1 },
      { label: 'HANDED', options: ['RIGHT', 'LEFT'], value: 0 },
      // wiersz-akcja: otwiera dialog z informacjami o aplikacji (wersja, AI itp.)
      { label: 'INFO', options: ['VIEW'], value: 0, action: true },
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
  const [infoOpen, setInfoOpen] = useState(false); // nakładka „o aplikacji" (wiersz INFO)
  const hydrated = useRef(false); // czy wczytano zapisane ustawienia

  // każde wejście w Settings → zaznaczenie wraca na pierwszy wiersz (nie zostaje tam, gdzie było)
  useEffect(() => {
    if (mode === 'SETTINGS') setSelected(0);
  }, [mode]);

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
    const look = 44; // „lookahead": rezerwa ~jednego wiersza, by sąsiednia opcja (np. INFO pod HANDED) była widoczna
    node.measureLayout(
      contentRef.current as any,
      (_x, y, _w, h) => {
        const top = offsetRef.current;
        const vh = viewportRef.current;
        if (y - pad - look < top) {
          scrollRef.current?.scrollTo({ y: Math.max(0, y - pad - look), animated: true });
        } else if (vh > 0 && y + h + pad + look > top + vh) {
          scrollRef.current?.scrollTo({ y: y + h + pad + look - vh, animated: true });
        }
      },
      () => {}
    );
  }, [selected]);

  // Zaznaczenie w dół / w górę (z zawijaniem). NEXT[CYCLE] i przycisk fwd → dół; prev → góra.
  const move = (dir: -1 | 1) => setSelected((i) => (i + dir + TOTAL_ITEMS) % TOTAL_ITEMS);
  const flatItems = sections.flatMap((s) => s.items); // spłaszczona lista (do wykrycia wiersza-akcji)
  const openInfo = () => setInfoOpen(true);
  const closeInfo = () => setInfoOpen(false);
  // Settery „po etykiecie" — używane przez welcome screen (te same ustawienia, podgląd na żywo).
  const optionOf = (label: string) => { const it = flatItems.find((i) => i.label === label); return it ? it.options[it.value] : ''; };
  const optionsOf = (label: string) => { const it = flatItems.find((i) => i.label === label); return it ? it.options : []; };
  const cycleByLabel = (label: string) =>
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.label === label && !it.locked ? { ...it, value: (it.value + 1) % it.options.length } : it)),
      }))
    );

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
  // CHANGE / wychylenie slidera → zmiana zaznaczonego (a dla wiersza-akcji: odpalenie nakładki).
  const changeBy = (dir: -1 | 1) => {
    if (flatItems[selected]?.action) { openInfo(); return; }
    changeAt(selected, dir);
  };
  // Ustaw FULLSCREEN wprost (np. z gestu pinch na ekranie) — trzyma synchronizację z przełącznikiem.
  const setFullscreen = (on: boolean) =>
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.label === 'VIEW' ? { ...it, value: on ? 1 : 0 } : it)),
      }))
    );
  // Tap w wiersz → zaznacz i przełącz wartość (a dla wiersza-akcji: odpal nakładkę).
  const tapRow = (idx: number) => {
    setSelected(idx);
    if (flatItems[idx]?.action) { openInfo(); return; }
    changeAt(idx, 1);
  };

  // Klawisz #1 dopasowany do kontekstu zaznaczonego wiersza (jak action-key w menu pod nazwą pliku
  // na liście nagrań) — pokazuje WARTOŚĆ, NA KTÓRĄ przełączy (głęboka kontekstowość):
  //  • wiersz-akcja (INFO) → SHOW INFO
  //  • przełącznik ON/OFF → TURN ON / TURN OFF (wg stanu)
  //  • wielo-opcja (PLAYBACK TIMER, THEME, AI LANGUAGE) → następna wartość, np. ELAPSED → REMAIN-ING
  // Akcja klawisza ta sama (changeBy → następna opcja), zmienia się tylko etykieta.
  const selItem = flatItems[selected];
  const nextIdx = selItem ? (selItem.value + 1) % selItem.options.length : 0;
  const nextOpt = selItem ? selItem.options[nextIdx] : '';
  const key1Label = !selItem
    ? 'CHANGE'
    : selItem.action
      ? 'SHOW INFO'
      : selItem.options.length === 2 && selItem.options.includes('OFF') && selItem.options.includes('ON')
        ? (selItem.options[selItem.value] === 'ON' ? 'TURN OFF' : 'TURN ON')
        : keyWrap(nextOpt);
  // supporting na kluczu #1: hint opcji docelowej (np. COMPRESSION → [SMALL]) ma pierwszeństwo;
  // inaczej [CYCLE] jako default gdy >2 opcje (np. THEME); 2-opcyjne bez hintu → bez supportu.
  const key1Supporting = selItem && !selItem.action ? (selItem.hints?.[nextIdx] ?? (selItem.options.length > 2 ? '[CYCLE]' : undefined)) : undefined;

  const keyboard: KeyboardConfig = infoOpen
    ? {
        // nakładka INFO: CLOSE (lub fizyczny BACK) zamyka dialog
        screen: [{ label: 'CLOSE', variant: 'primary', onPress: closeInfo }, { label: '' }, { label: '' }],
        metal: [stopBackKey({ canStop: false, onBack: closeInfo }), { type: 'record' }, { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false }],
      }
    : {
        screen: [
          { label: key1Label, supporting: key1Supporting, variant: 'primary', onPress: () => changeBy(1) },
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
  // przy otwartym dialogu INFO slider nieaktywny (nie ruszamy listy pod nakładką)
  const slider = infoOpen
    ? { highlighted: false }
    : {
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
      {infoOpen ? <InfoDialog /> : null}
    </>
  );

  // Bieżące wartości sterujące obudową: FULLSCREEN (wariant) i THEME (motyw koloru).
  const flat = sections.flatMap((s) => s.items);
  const viewItem = flat.find((it) => it.label === 'VIEW');
  const fullscreen = viewItem ? viewItem.options[viewItem.value] === 'FULLSCREEN' : false;
  const themeItem = flat.find((it) => it.label === 'THEME');
  const theme = (themeItem ? themeItem.options[themeItem.value] : 'LIGHT') as ThemeName;
  const motionItem = flat.find((it) => it.label === 'MOTION');
  const motion = motionItem ? motionItem.options[motionItem.value] === 'ON' : false;
  const hItem = flat.find((it) => it.label === 'HANDED');
  const leftHanded = hItem ? hItem.options[hItem.value] === 'LEFT' : false;
  const atItem = flat.find((it) => it.label === 'TRANSCRIPTION');
  const autoTranscribe = atItem ? atItem.options[atItem.value] === 'AUTO' : false;
  const rmItem = flat.find((it) => it.label === 'RECORD MODE');
  const recordMono = rmItem ? rmItem.options[rmItem.value] === 'MONO' : false;
  const compItem = flat.find((it) => it.label === 'COMPRESSION');
  const recordQuality = (compItem ? compItem.options[compItem.value] : 'HIGH') as 'HIGH' | 'LOW';
  const langItem = flat.find((it) => it.label === 'AI LANGUAGE');
  const language = (langItem ? langItem.options[langItem.value] : 'ENGLISH') === 'POLISH' ? 'pl' : 'en';
  const ptItem = flat.find((it) => it.label === 'PLAYBACK TIMER');
  const showTimeLeft = ptItem ? ptItem.options[ptItem.value] === 'REMAINING' : false;
  const ksoItem = flat.find((it) => it.label === 'KEEP SCREEN ON');
  const keepScreenOn = ksoItem ? ksoItem.options[ksoItem.value] === 'ON' : false;
  // język interfejsu (SYSTEM DEFAULT → z systemu). INFRA: nic na main jeszcze nie konsumuje (i18n osobno).
  const uiLangItem = flat.find((it) => it.label === 'UI LANGUAGE');
  const uiLangOpt = uiLangItem ? uiLangItem.options[uiLangItem.value] : 'SYSTEM DEFAULT';
  const uiLang: 'en' | 'pl' = uiLangOpt === 'POLISH' ? 'pl' : uiLangOpt === 'ENGLISH' ? 'en' : systemLang();

  return { content, keyboard, slider, fullscreen, setFullscreen, theme, motion, leftHanded, autoTranscribe, recordMono, recordQuality, language, uiLang, showTimeLeft, keepScreenOn, optionOf, optionsOf, cycleByLabel };
}
