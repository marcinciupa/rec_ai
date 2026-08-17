/**
 * TOAST — komunikat-pigułka przy dolnej krawędzi szyby, znikający sam. Wzorzec przeniesiony
 * z gallery_ai (§ toast, node 360:5309), żeby obie apki mówiły tym samym językiem.
 *
 * `pointerEvents="none"`, bo to komunikat, nie kontrolka — nie może przechwycić tapnięcia w treść
 * pod spodem (np. w wiersz transkryptu).
 *
 * Wymiary i typografia jak w gallery_ai: Inter Bold 16, padding 8×2, promień 2, ciemny tekst na
 * fosforze. RÓŻNI SIĘ tylko odsunięcie od dołu (40 zamiast 8) — rec_ai ma przy dolnej krawędzi szyby
 * pasek mierników L/R, więc toast na wysokości 8 leżałby na nim.
 *
 * Warianty: `phosphor` (zwykła informacja) i `risk` (czerwony — awaria). Czerwień jest tu świadomym
 * wyjątkiem od reguły „statusbar AI nigdy nie jest czerwony": pasek to stan trwały i ma nie straszyć,
 * a toast to zdarzenie — jeśli transkrypcja padła, użytkownik ma się o tym dowiedzieć raz i wyraźnie.
 */
import { View, Text } from 'react-native';
import { color, font, screen } from '../../theme/tokens';

export type ToastVariant = 'phosphor' | 'risk';

export function Toast({ text, variant = 'phosphor' }: { text?: string | null; variant?: ToastVariant }) {
  if (!text) return null;
  const bg = variant === 'risk' ? color.recordRed : screen.olive.primary;
  const glow = variant === 'risk' ? 'rgba(255,76,76,0.35)' : 'rgba(226,255,228,0.25)';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 16, right: 16, bottom: 40, alignItems: 'center' }}>
      <View
        style={
          {
            paddingHorizontal: 8,
            paddingVertical: 2,
            maxWidth: '100%', // długi tytuł notatki ma się ZAWINĄĆ, a nie wyjechać poza szybę
            borderRadius: 2,
            backgroundColor: bg,
            boxShadow: `0px 0px 4px 0px ${glow}`,
          } as any
        }
      >
        {/* Font DOKŁADNIE jak w gallery_ai (bodyLgBold = Inter Bold 16) — toast to ten sam element
            obu apek, więc nie ma powodu, żeby czytał się inaczej. */}
        <Text style={{ fontFamily: font.bodyLgBold.family, fontSize: font.bodyLgBold.size, lineHeight: font.bodyLgBold.size + 4, color: color.dark21, textAlign: 'center' }}>
          {text}
        </Text>
      </View>
    </View>
  );
}
