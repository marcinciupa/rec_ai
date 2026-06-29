/**
 * WelcomeDialog — onboarding pierwszego uruchomienia. Pyta o domyślne: AI LANGUAGE, THEME, FULLSCREEN.
 * Steruje TYMI SAMYMI ustawieniami co ekran Settings (przez optionOf/cycleByLabel z useSettingsScreen),
 * więc zmiany są od razu trwałe i widać podgląd na żywo (motyw/fullscreen obudowy za nakładką).
 * Styl spójny z InfoDialog/wierszami Settings (phosphor na ciemnej pigułce). Nakładka MIEŚCI SIĘ W EKRANIE
 * urządzenia (jak inne dialogi). Zamknięcie onboardingu = klawisz CONFIRM (środkowy klawisz klawiatury).
 */
import { View, Text, Pressable } from 'react-native';
import { font, screen, textShadow } from '../theme/tokens';

const glow = { textShadowColor: textShadow.phosphor.color, textShadowRadius: textShadow.phosphor.radius, textShadowOffset: { width: 0, height: 0 } } as const;

/** Wiersz wyboru: etykieta z lewej, wartość z prawej; tap cyklą wartość (jak w Settings). */
function PickRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', alignSelf: 'stretch', gap: 16, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 2 }}>
      {({ pressed }) => (
        <>
          <Text style={{ fontFamily: font.monoBody.family, fontSize: font.monoBody.size, color: screen.olive.secondary }}>{label}</Text>
          <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: screen.olive.primary, opacity: pressed ? 0.6 : 1, ...glow }}>{value}</Text>
        </>
      )}
    </Pressable>
  );
}

export function WelcomeDialog({
  optionOf,
  cycleByLabel,
}: {
  optionOf: (label: string) => string;
  cycleByLabel: (label: string) => void;
}) {
  return (
    // mieści się w ekranie urządzenia (renderowany w slocie Display, obok treści) — jak CONFIRM/DETAILS
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'rgba(0,0,0,0.6)' }}>
      <View style={{ alignSelf: 'stretch', maxWidth: 360, backgroundColor: 'rgba(26,26,26,0.95)', borderWidth: 1, borderColor: screen.olive.primary, borderRadius: 4, padding: 16, gap: 10, boxShadow: '0px 0px 8px 0px rgba(226,255,228,0.25)' } as any}>
        <Text style={{ fontFamily: font.monoHeading.family, fontSize: font.monoHeading.size, color: screen.olive.primary, textAlign: 'center', ...glow }}>WELCOME TO REC_AI</Text>
        <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, textAlign: 'center' }}>SET YOUR DEFAULTS · TAP A ROW TO CHANGE</Text>
        <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: screen.olive.inactive, marginVertical: 4 }} />
        <PickRow label="LANGUAGE" value={optionOf('AI LANGUAGE')} onPress={() => cycleByLabel('AI LANGUAGE')} />
        <PickRow label="THEME" value={optionOf('THEME')} onPress={() => cycleByLabel('THEME')} />
        <PickRow label="FULLSCREEN" value={optionOf('FULLSCREEN')} onPress={() => cycleByLabel('FULLSCREEN')} />
        {/* START przeniesiony na klawisz CONFIRM (środkowy klawisz klawiatury) */}
        <Text style={{ fontFamily: font.caption.family, fontSize: font.caption.size, color: screen.olive.secondary, textAlign: 'center', marginTop: 4, ...glow }}>PRESS CONFIRM TO START</Text>
      </View>
    </View>
  );
}
