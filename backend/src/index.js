// W pliku backend/src/index.js zmień wersję w odpowiedzi głównej:
return Response.json({
  name: 'HS Code Verifier API v1.4.3',  // ZMIANA: 1.4.2 → 1.4.3
  version: env.VERSION,
  description: 'System weryfikacji kodów celnych HS z bazą ISZTAR',
  worker: 'hs-code-verifier-api',
  url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
  endpoints: [
    'GET /health - Status zdrowia systemu',
    'POST /verify - Weryfikacja kodu HS (obsługuje formaty: 1234, 1234 56, 1234-56-78)',
    'GET /stats - Statystyki bazy danych',
    'GET /sanctions - Lista kodów sankcyjnych',
    'POST /sanctions/update - Aktualizacja listy sankcji (wymaga tokenu)'
  ],
  timestamp: new Date().toISOString()
}, { headers: corsHeaders });