# Polityka Prywatności — REC_AI

_Ostatnia aktualizacja: 23 czerwca 2026_

Wersja hostowana (do Google Play / App Store): **https://rec-ai-backend-production.up.railway.app/privacy**

Niniejsza Polityka opisuje, jak aplikacja **REC_AI** („Aplikacja") przetwarza dane podczas korzystania z funkcji nagrywania notatek głosowych, ich transkrypcji oraz czatu AI o notatce.

**Administrator:** [UZUPEŁNIJ: imię i nazwisko / nazwa]
**Kontakt:** [UZUPEŁNIJ: adres e-mail]

## 1. Jakie dane przetwarzamy
- **Nagrania audio** — tworzone, gdy nagrywasz notatkę. Zapisywane **lokalnie na Twoim urządzeniu**.
- **Transkrypcje i wiadomości czatu** — tekst z transkrypcji nagrań oraz Twoje pytania i odpowiedzi AI. Zapisywane **lokalnie na urządzeniu**.
- **Anonimowy identyfikator urządzenia** — losowy identyfikator generowany w Aplikacji (nie powiązany z tożsamością, kontem ani numerem telefonu). Służy wyłącznie ograniczaniu nadużyć i kontroli kosztów po stronie serwera.
- **Dane techniczne** — podstawowe metadane żądań (czas, rozmiar pliku, kod odpowiedzi). **Nie zawierają treści** nagrań.

Aplikacja **nie wymaga konta** i **nie zbiera** danych takich jak imię, e-mail, lokalizacja, kontakty czy identyfikatory reklamowe.

## 2. Po co przetwarzamy dane
- Aby **przetworzyć nagranie na tekst** (transkrypcja).
- Aby **odpowiadać na pytania o notatkę** (czat AI).
- Aby **zapewnić działanie i bezpieczeństwo** usługi (ograniczanie nadużyć).

## 3. Komu przekazujemy dane (podmioty przetwarzające)
Aby zrealizować transkrypcję i czat, treść jest wysyłana z Aplikacji do naszego serwera pośredniczącego, a stamtąd do dostawców AI:
- **deAPI** — transkrypcja audio (model Whisper). Wysyłany jest plik audio nagrania.
- **OpenRouter** (i podłączony model językowy, np. Google Gemini) — czat o notatce. Wysyłany jest transkrypt i Twoje pytanie.
- **Railway** — hosting serwera pośredniczącego.

Nasz serwer pośredniczący **nie przechowuje** Twoich nagrań ani transkryptów — przekazuje je wyłącznie w celu realizacji żądania. Przetwarzanie przez powyższych dostawców podlega ich własnym politykom prywatności.

## 4. Gdzie i jak długo przechowujemy dane
- **Na urządzeniu:** nagrania, transkrypcje i wiadomości czatu są przechowywane lokalnie do momentu **usunięcia przez Ciebie** w Aplikacji lub **odinstalowania** Aplikacji.
- **Na serwerze:** treść nie jest trwale przechowywana (przetwarzanie przejściowe na czas realizacji żądania). Metadane techniczne mogą być przechowywane krótkoterminowo w logach.

## 5. Uprawnienia
- **Mikrofon** — wymagany do nagrywania notatek głosowych. Nagrywanie następuje wyłącznie po jego uruchomieniu przez Ciebie.

## 6. Twoje prawa i kontrola
- Możesz w każdej chwili **usunąć dowolne nagranie** w Aplikacji.
- **Odinstalowanie** Aplikacji usuwa wszystkie dane przechowywane lokalnie na urządzeniu.
- W sprawach dotyczących danych skontaktuj się pod adresem podanym wyżej.

## 7. Bezpieczeństwo
Połączenia z serwerem są szyfrowane (HTTPS). Klucze do usług AI są przechowywane po stronie serwera i nie są zawarte w Aplikacji.

## 8. Dzieci
Aplikacja nie jest skierowana do dzieci poniżej 13. roku życia i nie zbiera świadomie ich danych.

## 9. Zmiany Polityki
Możemy aktualizować niniejszą Politykę. Zmiany publikujemy pod tym samym adresem wraz z datą aktualizacji.
