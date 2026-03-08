# 🚀 HS Code Verifier v1.5.0

System weryfikacji kodów celnych HS z bazą ISZTAR, autoryzacją JWT i panelem administratora.

## 📋 Nowe funkcjonalności w wersji 1.5.0

- ✅ **Logowanie i autoryzacja** – dostęp do systemu wymaga konta użytkownika.
- ✅ **Panel administratora** – podgląd logów zapytań i zarządzanie użytkownikami.
- ✅ **Bezpieczne przechowywanie haseł** – hashowanie HMAC-SHA256 z solą.
- ✅ **Obsługa różnych formatów kodów:** 1234, 1234 56, 1234-56-78, 1234567890.
- ✅ **Auto-formatowanie** – automatyczne dodawanie spacji podczas wpisywania.
- ✅ **Rozszerzanie kodów ogólnych** z jednym podkodem do pełnych 10 cyfr.
- ✅ **System ostrzeżeń sankcyjnych** dla grup towarów (kody 4-cyfrowe).
- ✅ **Weryfikacja kodów HS 4-10 cyfr**.
- ✅ **Delta updates** – tylko zmiany są synchronizowane z API ISZTAR.
- ✅ **Automatyczna synchronizacja** codziennie przez CRON workera i GitHub Actions.
- ✅ **Limit 20,000 zapytań dziennie** na adres IP.
- ✅ **Cache w pamięci** dla szybkich odpowiedzi.

## 🎯 Obsługiwane formaty kodów HS

System akceptuje kody w różnych formatach:
- **1234** – kod 4-cyfrowy
- **1234 56** – kod z separatorem spacji
- **1234-56-78** – kod z myślnikami
- **1234567890** – kod bez separatorów (max 10 cyfr)

## 🔐 Autoryzacja

- Użytkownicy logują się za pomocą nazwy użytkownika i hasła.
- Token JWT jest przechowywany w `localStorage` i używany do autoryzacji zapytań do API.
- Rola `admin` umożliwia dostęp do panelu `/admin`.

## 🛠️ Skrypty pomocnicze

- `npm run add-user <username> <password> [role]` – dodaje nowego użytkownika do KV.
- `npm run sanctions-list` – wyświetla aktualne kody sankcyjne.
- `npm run sanctions-update <token> <file>` – aktualizuje listę sankcji.
- `npm run controlled-list` – wyświetla kody pod kontrolą SANEPID.
- `npm run controlled-update <token> <file>` – aktualizuje listę kontroli.
- `npm run delta-sync` – ręczna synchronizacja bazy z API ISZTAR.
- `npm run test-isztar` – test połączenia z API ISZTAR.

## 📦 Wdrożenie (skrót)

1. Utwórz repozytorium GitHub i skopiuj pliki.
2. W Codespace zainstaluj zależności: `npm install` i `cd backend && npm install`.
3. Skonfiguruj Cloudflare: konto, namespace KV, worker.
4. Wdróż workera: `cd backend && npx wrangler deploy`.
5. Skonfiguruj Cloudflare Pages dla katalogu `frontend` z zmienną `API_BASE_URL`.
6. Dodaj sekrety w workerze: `JWT_SECRET`, `SYNC_TOKEN` (opc.), `CRON_SECRET` (opc.).
7. Dodaj pierwszego użytkownika: `export JWT_SECRET=... && npm run add-user admin hasło admin`.
8. (Opcjonalnie) Uruchom synchronizację bazy: `npm run delta-sync`.
9. Przetestuj działanie.

Szczegółowa instrukcja znajduje się w pliku `INSTRUKCJA.md` (lub w repozytorium).