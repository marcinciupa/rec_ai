/**
 * WelcomeDialog — onboarding pierwszego uruchomienia. Ustawia domyślne: LANGUAGE / TRANSCRIPTION / THEME / VIEW.
 * Steruje TYMI SAMYMI ustawieniami co ekran Settings (optionOf/optionsOf/cycleByLabel) → zmiany trwałe,
 * podgląd na żywo (motyw/fullscreen obudowy za nakładką). Nakładka mieści się w ekranie urządzenia.
 *
 * Nawigacja JAK W SETTINGS: slider prev/next przesuwa zaznaczenie, knob/klawisz #1 zmienia wartość
 * zaznaczonego wiersza (etykieta = wartość docelowa, jak kontekstowy klawisz w Settings), tap też wybiera+zmienia.
 * CONFIRM (środkowy klawisz) kończy onboarding.
 */
import { useState } from 'react';
import { View, Text, Pressable } from 'react-native';
import { color, font, screen, textShadow } from '../theme/tokens';
import type { KeyboardConfig } from '../components/chrome/Keyboard';
import type { SliderConfig } from '../components/chrome/SeekSlider';
import { stopBackKey } from './ScreenChrome';

const glow = { textShadowColor: textShadow.phosphor.color, textShadowRadius: textShadow.phosphor.radius, textShadowOffset: { width: 0, height: 0 } } as const;

// wiersze welcome → klucz ustawienia (Settings) + etykieta wyświetlana
const WELCOME_ROWS: { key: string; label: string }[] = [
  { key: 'AI LANGUAGE', label: 'AI LANGUAGE' },
  { key: 'UI LANGUAGE', label: 'UI LANGUAGE' },
  { key: 'TRANSCRIPTION', label: 'TRANSCRIPTION' },
  { key: 'THEME', label: 'THEME' },
  { key: 'VIEW', label: 'VIEW' },
];
// długie wartości łamane na klawiszu (jak w Settings keyWrap)
const KEY_WRAP: Record<string, string> = { FULLSCREEN: 'FULL-\nSCREEN', 'SYSTEM DEFAULT': 'SYSTEM\nDEFAULT' };

/** Wiersz wyboru: etykieta z lewej, wartość z prawej. Zaznaczony = tło phosphor + ciemny tekst (jak Settings). */
function PickRow({ label, value, selected, onPress }: { label: string; value: string; selected: boolean; onPress: () => void }) {
  const fg = selected ? color.dark21 : screen.olive.primary;
  return (
    <Pressable
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', gap: 16, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 2, backgroundColor: selected ? screen.olive.primary : 'transparent' }}
    >
      {({ pressed }) => (
        <>
          <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: selected ? color.dark21 : screen.olive.secondary }}>{label}</Text>
          <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: fg, opacity: pressed ? 0.6 : 1, ...(selected ? null : glow) }}>{value}</Text>
        </>
      )}
    </Pressable>
  );
}

export function useWelcomeDialog({
  optionOf,
  optionsOf,
  cycleByLabel,
  onFinish,
}: {
  optionOf: (label: string) => string;
  optionsOf: (label: string) => string[];
  cycleByLabel: (label: string) => void;
  onFinish: () => void;
}) {
  const [selected, setSelected] = useState(0);
  const move = (d: -1 | 1) => setSelected((i) => (i + d + WELCOME_ROWS.length) % WELCOME_ROWS.length);
  const tapRow = (i: number) => { setSelected(i); cycleByLabel(WELCOME_ROWS[i].key); };
  const changeSel = () => cycleByLabel(WELCOME_ROWS[selected].key);

  // kontekstowy klawisz #1 = wartość, NA KTÓRĄ przełączymy zaznaczony wiersz (jak w Settings)
  const curKey = WELCOME_ROWS[selected].key;
  const opts = optionsOf(curKey);
  const nextVal = opts.length ? opts[(opts.indexOf(optionOf(curKey)) + 1) % opts.length] : '';
  const key1Label = KEY_WRAP[nextVal] ?? nextVal;

  const keyboard: KeyboardConfig = {
    // CHANGE (kontekstowy) · CONFIRM (kończy) · NEXT [CYCLE] (przesuwa zaznaczenie) — reszta metalu zgaszona
    screen: [
      // [CYCLE] jako default support gdy >2 opcje (THEME); 2-opcyjne → bez supportu
      { label: key1Label, supporting: opts.length > 2 ? '[CYCLE]' : undefined, variant: 'primary', onPress: changeSel },
      { label: 'CONFIRM', variant: 'primary', onPress: onFinish },
      { label: 'NEXT', supporting: '[CYCLE]', onPress: () => move(1) },
    ],
    metal: [
      stopBackKey({ canStop: false }),
      { type: 'record' },
      { type: 'label', upper: 'PLAY', lower: 'PAUSE', active: false },
    ],
  };

  // slider jak w Settings: prev/next = zaznaczenie, knob (discrete) = zmiana wartości
  const slider: SliderConfig = { highlighted: true, discrete: true, onPrev: () => move(-1), onNext: () => move(1), onAdjust: () => changeSel() };

  const overlay = (
    // mieści się w ekranie urządzenia (renderowany w slocie Display, obok treści)
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <View style={{ alignSelf: 'stretch', maxWidth: 360, backgroundColor: color.dark1A, borderWidth: 1, borderColor: screen.olive.primary, borderRadius: 4, padding: 16, gap: 6, boxShadow: '0px 0px 8px 0px rgba(226,255,228,0.25)' } as any}>
        <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: screen.olive.primary, textAlign: 'center', ...glow }}>WELCOME TO REC_AI</Text>
        <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, textAlign: 'center' }}>SET YOUR DEFAULTS</Text>
        {WELCOME_ROWS.map((r, i) => (
          <PickRow key={r.key} label={r.label} value={optionOf(r.key)} selected={i === selected} onPress={() => tapRow(i)} />
        ))}
        {/* nawigacja: slider/CHANGE edytuje, CONFIRM startuje */}
        <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, textAlign: 'center', marginTop: 4, ...glow }}>CHANGE TO EDIT · CONFIRM TO START</Text>
      </View>
    </View>
  );

  return { overlay, keyboard, slider };
}
