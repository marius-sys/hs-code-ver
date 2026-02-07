import { syncIsztarData } from './sync.js';

// Import nowych modułów
import AuthService from './auth.js';
import UserService from './users.js';
import LogService from './logs.js';

const RATE_LIMIT = {
  maxRequests: 20000,
  windowMs: 24 * 60 * 60 * 1000,
  message: 'Dzienny limit 20,000 zapytań został przekroczony.'
};

const dailyTracker = new Map();
let hsDatabaseCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

// Middleware autoryzacji
async function requireAuth(request, env) {
    const authHeader = request.headers.get('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return { authenticated: false, error: 'Brak tokena autoryzacyjnego' };
    }
    
    const token = authHeader.substring(7);
    const authService = new AuthService(env.USERS_DB);
    const user = await authService.authenticate(token);
    
    if (!user) {
        return { authenticated: false, error: 'Nieprawidłowy lub wygasły token' };
    }
    
    return { authenticated: true, user };
}

// Middleware dla endpointów wymagających admina
async function requireAdmin(request, env) {
    const authResult = await requireAuth(request, env);
    
    if (!authResult.authenticated) {
        return authResult;
    }
    
    if (authResult.user.role !== 'admin') {
        return { authenticated: false, error: 'Brak uprawnień administratora' };
    }
    
    return authResult;
}

function checkRateLimit(ip) {
  const today = new Date().toISOString().split('T')[0];
  const key = `${ip}_${today}`;
  
  let data = dailyTracker.get(key);
  if (!data) {
    data = { count: 0, date: today };
    dailyTracker.set(key, data);
  }
  
  if (data.date !== today) {
    dailyTracker.delete(key);
    data = { count: 1, date: today };
    dailyTracker.set(key, data);
    return true;
  }
  
  if (data.count >= RATE_LIMIT.maxRequests) {
    return false;
  }
  
  data.count++;
  return true;
}

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

async function getDatabase(env) {
  const now = Date.now();
  
  if (hsDatabaseCache && (now - cacheTimestamp) < CACHE_TTL) {
    return hsDatabaseCache;
  }
  
  try {
    if (!env.HS_DATABASE) {
      console.warn('⚠️ Brak bindingu HS_DATABASE');
      return {};
    }
    
    const data = await env.HS_DATABASE.get('HS_CURRENT_DATABASE', 'json');
    hsDatabaseCache = data || {};
    cacheTimestamp = now;
    
    console.log(`📊 Załadowano bazę: ${Object.keys(hsDatabaseCache).length} kodów`);
    return hsDatabaseCache;
  } catch (error) {
    console.error('Błąd ładowania bazy:', error.message);
    return {};
  }
}

function formatDescription(description) {
  if (!description) return '';
  
  const parts = description.split(' → ');
  const lastIndex = parts.length - 1;
  
  // Sprawdź czy ostatnia część to "Pozostałe"
  const isLastRemaining = parts[lastIndex].includes('Pozostałe');
  
  // Formatuj każdą część
  const formattedParts = parts.map((part, index) => {
    let formattedPart = part;
    
    // Pogrubienie odpowiednich części
    if (isLastRemaining) {
      // Jeśli ostatni to "Pozostałe", pogrubiamy ostatnie dwie części
      if (index >= lastIndex - 1) {
        formattedPart = `<strong>${part}</strong>`;
      }
    } else {
      // W przeciwnym razie tylko ostatnią część
      if (index === lastIndex) {
        formattedPart = `<strong>${part}</strong>`;
      }
    }
    
    return formattedPart;
  });
  
  // Połącz z <br> zamiast →
  return formattedParts.join('<br>');
}

async function checkIfSanctioned(code, env) {
  try {
    if (!env.HS_DATABASE) return false;
    
    const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
    if (!sanctionedData || !sanctionedData.codes) return false;
    
    for (const sanctionedCode of sanctionedData.codes) {
      if (code.startsWith(sanctionedCode)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Błąd sprawdzania kodów sankcyjnych:', error);
    return false;
  }
}

async function checkIfControlled(code, env) {
  try {
    if (!env.HS_DATABASE) return false;
    
    const controlledData = await env.HS_DATABASE.get('HS_CONTROLLED_CODES', 'json');
    if (!controlledData || !controlledData.codes) return false;
    
    for (const controlledCode of controlledData.codes) {
      if (code.startsWith(controlledCode)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Błąd sprawdzania kodów pod kontrolą SANEPID:', error);
    return false;
  }
}

function normalizeHSCode(code) {
  // Usuń wszystkie znaki niebędące cyframi
  let cleaned = code.replace(/\D/g, '');
  
  // Jeśli kod ma 10 cyfr i kończy się zerami, usuń końcowe zera
  // ale zostaw co najmniej 4 cyfry
  if (cleaned.length === 10 && cleaned.endsWith('0')) {
    // Usuń końcowe zera
    let normalized = cleaned.replace(/0+$/, '');
    
    // Jeśli po usunięciu zer zostało mniej niż 4 cyfry, wróć do oryginału
    if (normalized.length < 4) {
      normalized = cleaned.substring(0, 4);
    }
    
    // Ale nie skracaj poniżej długości oryginalnego kodu (jeśli ktoś wpisał np. 6 cyfr)
    // Zachowaj minimalną długość 4 cyfr
    if (normalized.length < 4) {
      normalized = cleaned.substring(0, 4);
    }
    
    return normalized;
  }
  
  // Dla kodów o innych długościach, jeśli kończą się zerami i mają więcej niż 4 cyfry
  // usuń końcowe zera, ale zostaw co najmniej 4 cyfry
  if (cleaned.length > 4 && cleaned.endsWith('0')) {
    let normalized = cleaned.replace(/0+$/, '');
    
    // Zawsze zostaw co najmniej 4 cyfry
    if (normalized.length < 4) {
      normalized = cleaned.substring(0, 4);
    }
    
    return normalized;
  }
  
  return cleaned;
}

async function verifyHSCode(code, env) {
  try {
    // Normalizuj kod - usuń końcowe zera dla kodów > 4 cyfr
    let cleanedCode = normalizeHSCode(code);
    
    console.log(`🔍 Weryfikacja kodu: oryginalny=${code}, znormalizowany=${cleanedCode}`);
    
    if (cleanedCode.length < 4 || cleanedCode.length > 10) {
      return {
        success: false,
        code: cleanedCode,
        description: 'Kod HS musi mieć 4-10 cyfr',
        error: 'INVALID_LENGTH'
      };
    }
    
    if (!/^\d+$/.test(cleanedCode)) {
      return {
        success: false,
        code: cleanedCode,
        description: 'Kod HS może zawierać tylko cyfry',
        error: 'INVALID_CHARS'
      };
    }
    
    const database = await getDatabase(env);
    
    // Sprawdź czy kod jest sankcyjny lub pod kontrolą SANEPID
    const isSanctioned = await checkIfSanctioned(cleanedCode, env);
    const isControlled = await checkIfControlled(cleanedCode, env);
    
    // 1. Znajdź wszystkie kody, które zaczynają się od cleanedCode (w tym dokładne dopasowanie)
    const allMatchingCodes = Object.keys(database)
      .filter(k => k.startsWith(cleanedCode))
      .sort();
    
    console.log(`📊 Znaleziono ${allMatchingCodes.length} pasujących kodów dla ${cleanedCode}`);
    
    // 2. Podziel na dokładne dopasowanie i podkody
    const exactMatch = allMatchingCodes.find(k => k === cleanedCode);
    const subCodes = allMatchingCodes.filter(k => k !== cleanedCode);
    
    // Jeśli nie znaleziono żadnego pasującego kodu
    if (allMatchingCodes.length === 0) {
      const result = {
        success: false,
        code: cleanedCode,
        description: 'Kod nieznany w systeme ISZTAR',
        source: 'isztar_delta_database',
        isValid: false,
        sanctioned: isSanctioned,
        controlled: isControlled
      };
      
      if (isSanctioned || isControlled) {
        result.specialStatus = isSanctioned ? 'SANKCJE' : 'SANEPID';
        if (isSanctioned) {
          result.sanctionMessage = 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
        }
        if (isControlled) {
          result.controlMessage = 'UWAGA: Towar podlega kontroli SANEPID - wymagane dokumenty sanitarne!';
        }
      }
      
      return result;
    }
    
    // 3. Jeśli nie ma podkodów - to jest kod końcowy
    if (subCodes.length === 0) {
      const description = database[exactMatch];
      const formattedDescription = formatDescription(description);
      
      const result = {
        success: true,
        code: cleanedCode,
        description: description,
        formattedDescription: formattedDescription,
        source: 'isztar_delta_database',
        isValid: !(isSanctioned || isControlled),
        lastUpdated: await getLastSyncDate(env),
        cached: (Date.now() - cacheTimestamp) < CACHE_TTL,
        sanctioned: isSanctioned,
        controlled: isControlled,
        isFinalCode: true
      };
      
      if (isSanctioned || isControlled) {
        result.specialStatus = isSanctioned ? 'SANKCJE' : 'SANEPID';
        if (isSanctioned) {
          result.sanctionMessage = 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
        }
        if (isControlled) {
          result.controlMessage = 'UWAGA: Towar podlega kontroli SANEPID - wymagane dokumenty sanitarne!';
        }
      }
      
      return result;
    }
    
    // 4. Jeśli jest JEDEN podkod i NIE MA dokładnego dopasowania - rozszerz do pełnego kodu
    if (subCodes.length === 1 && !exactMatch) {
      const singleCode = subCodes[0];
      const paddedCode = singleCode.padEnd(10, '0');
      const formattedDescription = formatDescription(database[singleCode]);
      
      const result = {
        success: true,
        code: paddedCode,
        originalCode: cleanedCode,
        description: database[singleCode],
        formattedDescription: formattedDescription,
        source: 'isztar_delta_database',
        isValid: !(isSanctioned || isControlled),
        isSingleSubcode: true,
        sanctioned: isSanctioned,
        controlled: isControlled
      };
      
      if (isSanctioned || isControlled) {
        result.specialStatus = isSanctioned ? 'SANKCJE' : 'SANEPID';
        if (isSanctioned) {
          result.sanctionMessage = 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
        }
        if (isControlled) {
          result.controlMessage = 'UWAGA: Towar podlega kontroli SANEPID - wymagane dokumenty sanitarne!';
        }
      }
      
      return result;
    }
    
    // 5. Jeśli jest WIELE podkodów lub (JEDEN podkod i dokładne dopasowanie) - to kod ogólny
    if (subCodes.length > 0) {
      const description = exactMatch 
        ? database[exactMatch] 
        : `Kod ogólny, zawiera ${subCodes.length} podkodów`;
      
      const formattedDescription = formatDescription(description);
      
      const result = {
        success: true,
        code: cleanedCode,
        description: description,
        formattedDescription: formattedDescription,
        details: subCodes.slice(0, 10),
        totalSubcodes: subCodes.length,
        source: 'isztar_delta_database',
        isValid: !(isSanctioned || isControlled),
        isGeneralCode: true,
        hasExactMatch: !!exactMatch,
        sanctioned: isSanctioned,
        controlled: isControlled
      };
      
      if (isSanctioned || isControlled) {
        result.specialStatus = isSanctioned ? 'SANKCJE' : 'SANEPID';
        if (isSanctioned) {
          result.sanctionMessage = 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
        }
        if (isControlled) {
          result.controlMessage = 'UWAGA: Towar podlega kontroli SANEPID - wymagane dokumenty sanitarne!';
        }
      }
      
      return result;
    }
    
    // 6. Fallback - nie powinno się zdarzyć
    return {
      success: false,
      code: cleanedCode,
      description: 'Nieznany błąd weryfikacji',
      error: 'UNKNOWN_ERROR'
    };
    
  } catch (error) {
    console.error('Błąd weryfikacji:', error);
    return {
      success: false,
      code: code,
      description: 'Błąd systemu weryfikacji',
      error: error.message
    };
  }
}

async function getLastSyncDate(env) {
  try {
    if (!env.HS_DATABASE) return 'Nieznana';
    const metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
    return metadata ? metadata.lastSync : 'Nieznana';
  } catch {
    return 'Nieznana';
  }
}

async function handleCron(env, ctx) {
  console.log('🔄 Uruchomienie zaplanowanej synchronizacji CRON');
  const result = await syncIsztarData(env, ctx);
  
  if (!result.success) {
    console.error('❌ Synchronizacja CRON nieudana:', result.message);
  }
  
  hsDatabaseCache = null;
  cacheTimestamp = 0;
  
  return result;
}

// Logowanie aktywności wyszukiwań
async function logSearchActivity(env, userId, searchData, result) {
  try {
    if (!env.LOGS_DB) {
      console.warn('⚠️ Brak bindingu LOGS_DB - nie można zapisać logu');
      return;
    }
    
    const logService = new LogService(env.LOGS_DB);
    const ip = searchData.headers.get('CF-Connecting-IP') || 'unknown';
    const userAgent = searchData.headers.get('User-Agent') || 'unknown';
    
    await logService.logSearch(userId, {
      ...searchData,
      ip,
      userAgent
    }, result);
    
    console.log(`📝 Zapisano log wyszukiwania dla użytkownika ${userId}`);
  } catch (error) {
    console.error('Błąd logowania aktywności:', error);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS || '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Cron-Secret'
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // ==================== PUBLIC ENDPOINTS ====================
    
    // Endpoint logowania (publiczny)
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const { username, password } = body;
        
        if (!username || !password) {
          return Response.json(
            { success: false, error: 'Nazwa użytkownika i hasło są wymagane' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        const authService = new AuthService(env.USERS_DB);
        const result = await authService.login(username, password);
        
        if (!result.success) {
          return Response.json(result, { status: 401, headers: corsHeaders });
        }
        
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        console.error('Błąd logowania:', error);
        return Response.json(
          { success: false, error: 'Nieprawidłowy format danych' },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // Health check (publiczny)
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let metadata = null;
        let databaseSize = 0;
        let sanctionedCount = 0;
        let controlledCount = 0;
        let userCount = 0;
        
        if (hasDatabase) {
          try {
            metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
            const database = await getDatabase(env);
            databaseSize = Object.keys(database).length;
            
            const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            if (sanctionedData && sanctionedData.codes) {
              sanctionedCount = sanctionedData.codes.length;
            }
            
            const controlledData = await env.HS_DATABASE.get('HS_CONTROLLED_CODES', 'json');
            if (controlledData && controlledData.codes) {
              controlledCount = controlledData.codes.length;
            }
          } catch (error) {
            console.log('Błąd odczytu KV:', error.message);
          }
        }
        
        // Liczba użytkowników
        if (env.USERS_DB) {
          try {
            const userService = new UserService(env.USERS_DB);
            const usersResult = await userService.getAllUsers();
            if (usersResult.success) {
              userCount = usersResult.users.length;
            }
          } catch (error) {
            console.log('Błąd odczytu użytkowników:', error.message);
          }
        }
        
        return Response.json({
          status: 'healthy',
          version: env.VERSION,
          worker: 'hs-code-verifier-api',
          url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
          database: {
            hasBinding: hasDatabase,
            lastSync: metadata ? metadata.lastSync : 'Nigdy',
            totalRecords: databaseSize,
            status: hasDatabase ? 'ok' : 'no_binding'
          },
          users: {
            totalUsers: userCount,
            authEnabled: true
          },
          sanctions: {
            totalCodes: sanctionedCount
          },
          controlled: {
            totalCodes: controlledCount
          },
          timestamp: new Date().toISOString()
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          status: 'degraded',
          error: error.message,
          timestamp: new Date().toISOString()
        }, { status: 500, headers: corsHeaders });
      }
    }
    
    // Root endpoint (publiczny)
    if (url.pathname === '/' && request.method === 'GET') {
      return Response.json({
        name: 'HS Code Verifier API v2.0.0',
        version: env.VERSION,
        description: 'System weryfikacji kodów celnych HS z bazą ISZTAR i autoryzacją',
        worker: 'hs-code-verifier-api',
        url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
        endpoints: {
          public: [
            'POST /api/auth/login - Logowanie użytkownika',
            'GET /health - Status zdrowia systemu'
          ],
          authenticated: [
            'POST /verify - Weryfikacja kodu HS',
            'GET /api/user/history - Historia wyszukiwań użytkownika',
            'GET /api/user/profile - Profil użytkownika'
          ],
          admin: [
            'GET /api/admin/users - Lista użytkowników (admin)',
            'POST /api/admin/users - Dodaj użytkownika (admin)',
            'DELETE /api/admin/users/:id - Usuń użytkownika (admin)'
          ],
          system: [
            'GET /stats - Statystyki bazy danych',
            'GET /sanctions - Lista kodów sankcyjnych',
            'GET /controlled - Lista kodów pod kontrolą SANEPID'
          ]
        },
        timestamp: new Date().toISOString()
      }, { headers: corsHeaders });
    }
    
    // ==================== PROTECTED ENDPOINTS ====================
    
    // Weryfikacja kodu HS (wymaga autoryzacji)
    if (url.pathname === '/verify' && request.method === 'POST') {
      // Sprawdzenie autoryzacji
      const authResult = await requireAuth(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      // Limitowanie zapytań
      const clientIP = getClientIP(request);
      if (!checkRateLimit(clientIP)) {
        return Response.json(
          { error: RATE_LIMIT.message },
          { status: 429, headers: corsHeaders }
        );
      }
      
      try {
        const body = await request.json();
        const { code } = body;
        
        if (!code) {
          return Response.json(
            { error: 'Brak kodu HS' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        if (!env.HS_DATABASE) {
          return Response.json({
            success: false,
            code: code,
            description: 'Baza danych niedostępna',
            error: 'DATABASE_UNAVAILABLE'
          }, { headers: corsHeaders });
        }
        
        const result = await verifyHSCode(code, env);
        
        // Logowanie aktywności
        await logSearchActivity(env, authResult.user.userId, {
          code: code,
          headers: request.headers
        }, result);
        
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { error: 'Nieprawidłowy format danych' },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // Historia wyszukiwań użytkownika
    if (url.pathname === '/api/user/history' && request.method === 'GET') {
      const authResult = await requireAuth(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      const searchParams = url.searchParams;
      const filters = {
        startDate: searchParams.get('startDate'),
        endDate: searchParams.get('endDate'),
        limit: parseInt(searchParams.get('limit')) || 50,
        offset: parseInt(searchParams.get('offset')) || 0
      };
      
      try {
        const logService = new LogService(env.LOGS_DB);
        const result = await logService.getUserSearchHistory(authResult.user.userId, filters);
        
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        console.error('Błąd pobierania historii:', error);
        return Response.json(
          { success: false, error: 'Błąd pobierania historii' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Profil użytkownika
    if (url.pathname === '/api/user/profile' && request.method === 'GET') {
      const authResult = await requireAuth(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      try {
        const userService = new UserService(env.USERS_DB);
        const result = await userService.getUser(authResult.user.userId);
        
        if (!result.success) {
          return Response.json(result, { status: 404, headers: corsHeaders });
        }
        
        // Pobierz statystyki
        const logService = new LogService(env.LOGS_DB);
        const stats = await logService.getUserStats(authResult.user.userId);
        
        const profileData = {
          ...result.user,
          stats: stats.success ? stats.stats : null
        };
        
        return Response.json({
          success: true,
          profile: profileData
        }, { headers: corsHeaders });
      } catch (error) {
        console.error('Błąd pobierania profilu:', error);
        return Response.json(
          { success: false, error: 'Błąd pobierania profilu' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Zmiana hasła
    if (url.pathname === '/api/user/change-password' && request.method === 'POST') {
      const authResult = await requireAuth(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      try {
        const body = await request.json();
        const { currentPassword, newPassword } = body;
        
        if (!currentPassword || !newPassword) {
          return Response.json(
            { success: false, error: 'Obecne i nowe hasło są wymagane' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        if (newPassword.length < 8) {
          return Response.json(
            { success: false, error: 'Nowe hasło musi mieć co najmniej 8 znaków' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        const authService = new AuthService(env.USERS_DB);
        const result = await authService.changePassword(
          authResult.user.userId,
          currentPassword,
          newPassword
        );
        
        return Response.json(result, { 
          status: result.success ? 200 : 400,
          headers: corsHeaders 
        });
      } catch (error) {
        console.error('Błąd zmiany hasła:', error);
        return Response.json(
          { success: false, error: 'Nieprawidłowy format danych' },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // ==================== ADMIN ENDPOINTS ====================
    
    // Zarządzanie użytkownikami (tylko admin)
    if (url.pathname.startsWith('/api/admin/users')) {
      const authResult = await requireAdmin(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      // Pobierz wszystkich użytkowników
      if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        try {
          const userService = new UserService(env.USERS_DB);
          const result = await userService.getAllUsers();
          
          return Response.json(result, { headers: corsHeaders });
        } catch (error) {
          console.error('Błąd pobierania użytkowników:', error);
          return Response.json(
            { success: false, error: 'Błąd pobierania użytkowników' },
            { status: 500, headers: corsHeaders }
          );
        }
      }
      
      // Dodaj nowego użytkownika
      if (url.pathname === '/api/admin/users' && request.method === 'POST') {
        try {
          const body = await request.json();
          const { username, password, role, email } = body;
          
          if (!username || !password) {
            return Response.json(
              { success: false, error: 'Nazwa użytkownika i hasło są wymagane' },
              { status: 400, headers: corsHeaders }
            );
          }
          
          if (password.length < 8) {
            return Response.json(
              { success: false, error: 'Hasło musi mieć co najmniej 8 znaków' },
              { status: 400, headers: corsHeaders }
            );
          }
          
          const authService = new AuthService(env.USERS_DB);
          const result = await authService.registerUser({
            username,
            password,
            role: role || 'user',
            email: email || ''
          }, authResult.user.userId);
          
          return Response.json(result, { 
            status: result.success ? 201 : 400,
            headers: corsHeaders 
          });
        } catch (error) {
          console.error('Błąd tworzenia użytkownika:', error);
          return Response.json(
            { success: false, error: 'Nieprawidłowy format danych' },
            { status: 400, headers: corsHeaders }
          );
        }
      }
      
      // Usuń użytkownika
      if (url.pathname.startsWith('/api/admin/users/') && request.method === 'DELETE') {
        const userId = url.pathname.split('/').pop();
        
        if (!userId) {
          return Response.json(
            { success: false, error: 'Brak ID użytkownika' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        try {
          const userService = new UserService(env.USERS_DB);
          const result = await userService.deleteUser(userId, authResult.user.userId);
          
          return Response.json(result, { 
            status: result.success ? 200 : 400,
            headers: corsHeaders 
          });
        } catch (error) {
          console.error('Błąd usuwania użytkownika:', error);
          return Response.json(
            { success: false, error: 'Błąd usuwania użytkownika' },
            { status: 500, headers: corsHeaders }
          );
        }
      }
    }
    
    // Logi systemowe (tylko admin)
    if (url.pathname === '/api/admin/logs' && request.method === 'GET') {
      const authResult = await requireAdmin(request, env);
      if (!authResult.authenticated) {
        return Response.json(
          { error: authResult.error },
          { status: 401, headers: corsHeaders }
        );
      }
      
      const searchParams = url.searchParams;
      const filters = {
        level: searchParams.get('level'),
        search: searchParams.get('search'),
        limit: parseInt(searchParams.get('limit')) || 100
      };
      
      try {
        const logService = new LogService(env.LOGS_DB);
        const result = await logService.getSystemLogs(filters);
        
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        console.error('Błąd pobierania logów:', error);
        return Response.json(
          { success: false, error: 'Błąd pobierania logów systemowych' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // ==================== SYSTEM ENDPOINTS ====================
    
    // Statystyki systemu
    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let metadata = null;
        let databaseSize = 0;
        let sanctionedCount = 0;
        let controlledCount = 0;
        let sanctionsLastUpdated = null;
        let controlledLastUpdated = null;
        
        if (hasDatabase) {
          try {
            metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
            const database = await getDatabase(env);
            databaseSize = Object.keys(database).length;
            
            const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            if (sanctionedData) {
              sanctionedCount = sanctionedData.codes ? sanctionedData.codes.length : 0;
              sanctionsLastUpdated = sanctionedData.lastUpdated || null;
            }
            
            const controlledData = await env.HS_DATABASE.get('HS_CONTROLLED_CODES', 'json');
            if (controlledData) {
              controlledCount = controlledData.codes ? controlledData.codes.length : 0;
              controlledLastUpdated = controlledData.lastUpdated || null;
            }
          } catch (error) {
            console.log('Błąd odczytu statystyk:', error.message);
          }
        }
        
        // Statystyki użytkowników
        let userCount = 0;
        let activeUsers = 0;
        if (env.USERS_DB) {
          try {
            const userService = new UserService(env.USERS_DB);
            const usersResult = await userService.getAllUsers();
            if (usersResult.success) {
              userCount = usersResult.users.length;
              activeUsers = usersResult.users.filter(u => u.active).length;
            }
          } catch (error) {
            console.log('Błąd odczytu statystyk użytkowników:', error.message);
          }
        }
        
        return Response.json({
          name: 'HS Code Verifier API v2.0.0',
          version: env.VERSION,
          worker: 'hs-code-verifier-api',
          url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
          database: {
            hasBinding: hasDatabase,
            lastSync: metadata ? metadata.lastSync : 'Nigdy',
            totalRecords: databaseSize,
            changes: metadata ? metadata.changes : null
          },
          users: {
            totalUsers: userCount,
            activeUsers: activeUsers
          },
          sanctions: {
            totalCodes: sanctionedCount,
            lastUpdated: sanctionsLastUpdated
          },
          controlled: {
            totalCodes: controlledCount,
            lastUpdated: controlledLastUpdated
          },
          rateLimit: {
            dailyLimit: RATE_LIMIT.maxRequests,
            description: 'per IP address'
          },
          timestamp: new Date().toISOString()
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { error: 'Błąd pobierania statystyk' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Lista kodów sankcyjnych
    if (url.pathname === '/sanctions' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let sanctionedData = null;
        
        if (hasDatabase) {
          try {
            sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
          } catch (error) {
            console.log('Błąd odczytu kodów sankcyjnych:', error.message);
          }
        }
        
        return Response.json({
          success: true,
          codes: sanctionedData ? sanctionedData.codes || [] : [],
          lastUpdated: sanctionedData ? sanctionedData.lastUpdated : null,
          totalCodes: sanctionedData && sanctionedData.codes ? sanctionedData.codes.length : 0
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { success: false, error: 'Błąd pobierania kodów sankcyjnych' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Aktualizacja listy sankcji (wymaga tokena sync)
    if (url.pathname === '/sanctions/update' && request.method === 'POST') {
      const authToken = request.headers.get('Authorization');
      if (!env.SYNC_TOKEN || authToken !== `Bearer ${env.SYNC_TOKEN}`) {
        return Response.json(
          { error: 'Brak autoryzacji' },
          { status: 401, headers: corsHeaders }
        );
      }
      
      try {
        const body = await request.json();
        const { codes } = body;
        
        if (!codes || !Array.isArray(codes)) {
          return Response.json(
            { error: 'Nieprawidłowy format danych. Oczekiwano tablicy "codes"' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        const validCodes = codes.filter(code => /^\d{4}$/.test(code));
        
        if (validCodes.length !== codes.length) {
          console.warn(`Niektóre kody są nieprawidłowe. Zaakceptowano ${validCodes.length} z ${codes.length}`);
        }
        
        const data = {
          codes: validCodes,
          lastUpdated: new Date().toISOString(),
          totalCodes: validCodes.length,
          version: '1.0'
        };
        
        await env.HS_DATABASE.put('HS_SANCTIONED_CODES', JSON.stringify(data));
        
        return Response.json({
          success: true,
          message: `Zaktualizowano ${validCodes.length} kodów sankcyjnych`,
          data: data
        }, { headers: corsHeaders });
        
      } catch (error) {
        return Response.json(
          { error: 'Nieprawidłowy format danych', details: error.message },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // Lista kodów pod kontrolą SANEPID
    if (url.pathname === '/controlled' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let controlledData = null;
        
        if (hasDatabase) {
          try {
            controlledData = await env.HS_DATABASE.get('HS_CONTROLLED_CODES', 'json');
          } catch (error) {
            console.log('Błąd odczytu kodów kontroli SANEPID:', error.message);
          }
        }
        
        return Response.json({
          success: true,
          codes: controlledData ? controlledData.codes || [] : [],
          lastUpdated: controlledData ? controlledData.lastUpdated : null,
          totalCodes: controlledData && controlledData.codes ? controlledData.codes.length : 0,
          listType: 'sanepid_control'
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { success: false, error: 'Błąd pobierania kodów kontroli SANEPID' },
          { status: 500, headers: corsHeaders }
        );
      }
    }
    
    // Aktualizacja listy kontroli SANEPID (wymaga tokena sync)
    if (url.pathname === '/controlled/update' && request.method === 'POST') {
      const authToken = request.headers.get('Authorization');
      if (!env.SYNC_TOKEN || authToken !== `Bearer ${env.SYNC_TOKEN}`) {
        return Response.json(
          { error: 'Brak autoryzacji' },
          { status: 401, headers: corsHeaders }
        );
      }
      
      try {
        const body = await request.json();
        const { codes } = body;
        
        if (!codes || !Array.isArray(codes)) {
          return Response.json(
            { error: 'Nieprawidłowy format danych. Oczekiwano tablicy "codes"' },
            { status: 400, headers: corsHeaders }
          );
        }
        
        const validCodes = codes.filter(code => /^\d{4}$/.test(code));
        
        if (validCodes.length !== codes.length) {
          console.warn(`Niektóre kody są nieprawidłowe. Zaakceptowano ${validCodes.length} z ${codes.length}`);
        }
        
        const data = {
          codes: validCodes,
          lastUpdated: new Date().toISOString(),
          totalCodes: validCodes.length,
          version: '1.0',
          listType: 'sanepid_control'
        };
        
        await env.HS_DATABASE.put('HS_CONTROLLED_CODES', JSON.stringify(data));
        
        return Response.json({
          success: true,
          message: `Zaktualizowano ${validCodes.length} kodów pod kontrolą SANEPID`,
          data: data
        }, { headers: corsHeaders });
        
      } catch (error) {
        return Response.json(
          { error: 'Nieprawidłowy format danych', details: error.message },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // CRON synchronizacji
    if (url.pathname === '/cron/sync' && request.method === 'POST') {
      const cronSecret = request.headers.get('X-Cron-Secret');
      if (!env.CRON_SECRET || cronSecret !== env.CRON_SECRET) {
        return new Response('Unauthorized', { 
          status: 401,
          headers: corsHeaders 
        });
      }
      
      ctx.waitUntil(handleCron(env, ctx));
      
      return Response.json({
        success: true,
        message: 'Synchronizacja CRON uruchomiona',
        timestamp: new Date().toISOString()
      }, { headers: corsHeaders });
    }
    
    // ==================== NOT FOUND ====================
    
    return Response.json(
      { 
        error: 'Nie znaleziono endpointu',
        availableEndpoints: [
          'POST /api/auth/login - Logowanie',
          'POST /verify - Weryfikacja kodu HS (wymaga tokena)',
          'GET /api/user/history - Historia wyszukiwań (wymaga tokena)',
          'GET /api/user/profile - Profil użytkownika (wymaga tokena)',
          'GET /health - Status systemu',
          'GET /stats - Statystyki'
        ]
      },
      { status: 404, headers: corsHeaders }
    );
  },
  
  async scheduled(event, env, ctx) {
    console.log('⏰ Wywołanie zaplanowanej synchronizacji CRON');
    try {
      await handleCron(env, ctx);
    } catch (error) {
      console.error('❌ Błąd CRON:', error);
    }
  }
};