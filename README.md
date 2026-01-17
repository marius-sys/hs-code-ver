# 🚀 HS Code Verifier v1.4.3

System weryfikacji kodów celnych HS z bazą ISZTAR (Delta Updates)

## 📋 Nowe funkcjonalności

- ✅ **Obsługa różnych formatów kodów:** 1234, 1234 56, 1234-56-78, 1234567890
- ✅ **Auto-formatowanie:** automatyczne dodawanie spacji podczas wpisywania
- ✅ **Rozszerzanie kodów ogólnych** z jednym podkodem do pełnych 10 cyfr
- ✅ **System ostrzeżeń sankcyjnych** dla grup towarów (kody 4-cyfrowe)
- ✅ Weryfikacja kodów HS 4-10 cyfr
- ✅ Delta updates - tylko zmiany są synchronizowane
- ✅ Automatyczna synchronizacja codziennie
- ✅ Limit 20,000 zapytań dziennie
- ✅ Cache w pamięci dla szybkich odpowiedzi

## 🎯 Obsługiwane formaty kodów HS

System akceptuje kody w różnych formatach:
- **1234** - kod 4-cyfrowy
- **1234 56** - kod z separatorem spacji
- **1234-56-78** - kod z myślnikami
- **1234567890** - kod bez separatorów (max 10 cyfr)

## 🚨 System ostrzeżeń sankcyjnych

System sprawdza czy kod HS należy do grupy sankcyjnej. Jeśli kod zaczyna się od kodu 4-cyfrowego z listy sankcyjnej, wyświetlane jest ostrzeżenie.

### Zarządzanie sankcjami:

1. **Wyświetl aktualną listę:**
   ```bash
   npm run sanction-list