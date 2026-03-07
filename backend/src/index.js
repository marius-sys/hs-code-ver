import bcrypt from 'bcryptjs';
import { syncIsztarData } from './sync.js';

// Stałe
const RATE_LIMIT = {
  maxRequests: 20000,
  windowMs: 24 * 60 * 60 * 1000,
  message: 'Dzienny limit 20,000 zapytań został przekroczony.'
};

const SESSION_TTL = 60 * 60 * 24; // 24 godziny (w sekundach)

// Cache i trackery
const dailyTracker = new Map();
let hsDatabaseCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ------------------------------------------------------------
// Funkcje pomocnicze (bez zmian)
// ------------------------------------------------------------
function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
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
  
  const isLastRemaining = parts[lastIndex].includes('Pozostałe');
  
  const formattedParts = parts.map((part, index) => {
    let formattedPart = part;
    
    if (isLastRemaining) {
      if (index >= lastIndex - 1) {
        formattedPart = `<strong>${part}</strong>`;
      }
    } else {
      if (index === lastIndex) {
        formattedPart = `<strong>${part}</strong>`;
      }
    }
    
    return formattedPart;
  });
  
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
  let cleaned = code.replace(/\D/g, '');
  
  if (cleaned.length === 10 && cleaned.endsWith('0')) {
    let normalized = cleaned.replace(/0+$/, '');
    if (normalized.length < 4) {
      normalized = cleaned.substring(0, 4);
    }
    return normalized;
  }
  
  if (cleaned.length > 4 && cleaned.endsWith('0')) {
    let normalized = cleaned.replace(/0+$/, '');
    if (normalized.length < 4) {
      normalized = cleaned.substring(0, 4);
    }
    return normalized;
  }
  
  return cleaned;
}

async function verifyHSCode(code, env) {
  try {
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
    
    const isSanctioned = await checkIfSanctioned(cleanedCode, env);
    const isControlled = await checkIfControlled(cleanedCode, env);
    
    const allMatchingCodes = Object.keys(database)
      .filter(k => k.startsWith(cleanedCode))
      .sort();
    
    console.log(`📊 Znaleziono ${allMatchingCodes.length} pasujących kodów dla ${cleanedCode}`);
    
    const exactMatch = allMatchingCodes.find(k => k === cleanedCode);
    const subCodes = allMatchingCodes.filter(k => k !== cleanedCode);
    
    if (allMatchingCodes.length === 0) {
      const result = {
        success: false,
        code: cleanedCode,
        description: 'Kod nieznany w systemie ISZTAR',
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

// ------------------------------------------------------------
// NOWE FUNKCJE AUTORYZACJI
// ------------------------------------------------------------

/**
 * Pobiera dane użytkownika z tokena (sprawdza ważność sesji)
 */
async function getUserFromToken(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  
  const token = auth.slice(7);
  const sessionKey = `session:${token}`;
  const sessionData = await env.SESSIONS.get(sessionKey, 'json');
  
  if (!sessionData) return null;
  if (sessionData.expires < Date.now()) {
    // Sesja wygasła – usuń ją
    await env.SESSIONS.delete(sessionKey);
    return null;
  }
  
  return {
    username: sessionData.username,
    role: sessionData.role
  };
}

/**
 * Loguje wyszukiwanie kodu do KV LOGS
 */
async function logSearch(env, username, code, ip) {
  try {
    const logEntry = {
      timestamp: new Date().toISOString(),
      username,
      code,
      ip
    };
    // Klucz: log:timestamp:username:code – timestamp malejąco
    const key = `log:${Date.now()}:${username}:${code}`;
    await env.LOGS.put(key, JSON.stringify(logEntry), {
      expirationTtl: 60 * 60 * 24 * 30 // 30 dni
    });
  } catch (error) {
    console.error('Błąd zapisu logu:', error);
  }
}

/**
 * Endpoint logowania
 */
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    
    // Pobierz listę użytkowników z sekretu USERS (JSON)
    const usersJson = env.USERS;
    if (!usersJson) {
      console.error('Brak sekretu USERS');
      return new Response('Internal server error', { status: 500 });
    }
    
    let users;
    try {
      users = JSON.parse(usersJson);
    } catch (e) {
      console.error('Nieprawidłowy JSON w sekrecie USERS');
      return new Response('Internal server error', { status: 500 });
    }
    
    const user = users[username];
    if (!user) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    const valid = await bcrypt.compare(password, user.hash);
    if (!valid) {
      return new Response('Unauthorized', { status: 401 });
    }
    
    // Generuj token sesji
    const token = crypto.randomUUID();
    const sessionData = {
      username,
      role: user.role || 'user',
      expires: Date.now() + SESSION_TTL * 1000
    };
    
    await env.SESSIONS.put(`session:${token}`, JSON.stringify(sessionData), {
      expirationTtl: SESSION_TTL
    });
    
    return Response.json({
      token,
      username,
      role: user.role || 'user'
    });
    
  } catch (error) {
    console.error('Błąd logowania:', error);
    return new Response('Bad request', { status: 400 });
  }
}

/**
 * Endpoint wylogowania
 */
async function handleLogout(request, env) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    await env.SESSIONS.delete(`session:${token}`);
  }
  return new Response('OK');
}

/**
 * Endpoint weryfikacji sesji – zwraca dane użytkownika jeśli token ważny
 */
async function handleVerifySession(request, env) {
  const user = await getUserFromToken(request, env);
  if (!user) {
    return new Response('Unauthorized', { status: 401 });
  }
  return Response.json(user);
}

/**
 * Endpoint pobierania logów (tylko dla administratora)
 */
async function handleLogs(request, env) {
  const user = await getUserFromToken(request, env);
  if (!user || user.role !== 'admin') {
    return new Response('Forbidden', { status: 403 });
  }
  
  try {
    // Pobierz ostatnie 100 logów (klucze zaczynające się od "log:")
    const { keys } = await env.LOGS.list({ prefix: 'log:', limit: 100 });
    
    const logs = [];
    for (const key of keys) {
      const entry = await env.LOGS.get(key.name, 'json');
      if (entry) logs.push(entry);
    }
    
    // Sortuj malejąco po timestamp (który jest w kluczu, ale lepiej po polu timestamp)
    logs.sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
    
    return Response.json(logs);
  } catch (error) {
    console.error('Błąd pobierania logów:', error);
    return new Response('Internal server error', { status: 500 });
  }
}

// ------------------------------------------------------------
// Główny fetch
// ------------------------------------------------------------
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGINS || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    };
    
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // --------------------------------------------------------
    // Endpointy publiczne (nie wymagają tokena)
    // --------------------------------------------------------
    
    // CRON sync (zabezpieczony własnym sekretem)
    if (url.pathname === '/cron/sync' && request.method === 'POST') {
      const cronSecret = request.headers.get('X-Cron-Secret');
      if (!env.CRON_SECRET || cronSecret !== env.CRON_SECRET) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      
      ctx.waitUntil(handleCron(env, ctx));
      
      return Response.json({
        success: true,
        message: 'Synchronizacja CRON uruchomiona',
        timestamp: new Date().toISOString()
      }, { headers: corsHeaders });
    }
    
    // Health check
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let metadata = null;
        let databaseSize = 0;
        let sanctionedCount = 0;
        let controlledCount = 0;
        
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
          sanctions: { totalCodes: sanctionedCount },
          controlled: { totalCodes: controlledCount },
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
    
    // Statystyki (publiczne)
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
        
        return Response.json({
          name: 'HS Code Verifier API v1.4.3',
          version: env.VERSION,
          worker: 'hs-code-verifier-api',
          url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
          database: {
            hasBinding: hasDatabase,
            lastSync: metadata ? metadata.lastSync : 'Nigdy',
            totalRecords: databaseSize,
            changes: metadata ? metadata.changes : null
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
    
    // Lista sankcji (publiczna – tylko odczyt)
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
    
    // Aktualizacja sankcji (wymaga SYNC_TOKEN)
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
    
    // Lista kontroli SANEPID (publiczna – tylko odczyt)
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
    
    // Aktualizacja kontroli SANEPID (wymaga SYNC_TOKEN)
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
    
    // --------------------------------------------------------
    // Endpointy związane z autoryzacją użytkowników
    // --------------------------------------------------------
    
    // Logowanie
    if (url.pathname === '/login' && request.method === 'POST') {
      return handleLogin(request, env);
    }
    
    // Wylogowanie
    if (url.pathname === '/logout' && request.method === 'POST') {
      return handleLogout(request, env);
    }
    
    // Weryfikacja sesji
    if (url.pathname === '/verify-session' && request.method === 'GET') {
      return handleVerifySession(request, env);
    }
    
    // Logi (tylko admin)
    if (url.pathname === '/logs' && request.method === 'GET') {
      return handleLogs(request, env);
    }
    
    // --------------------------------------------------------
    // Endpointy chronione (wymagają tokena użytkownika)
    // --------------------------------------------------------
    
    // Weryfikacja kodu HS
    if (url.pathname === '/verify' && request.method === 'POST') {
      // Sprawdź autoryzację
      const user = await getUserFromToken(request, env);
      if (!user) {
        return new Response('Unauthorized', { status: 401, headers: corsHeaders });
      }
      
      // Rate limiting
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
        
        // Zapisz log w tle
        ctx.waitUntil(logSearch(env, user.username, code, clientIP));
        
        return Response.json(result, { headers: corsHeaders });
        
      } catch (error) {
        return Response.json(
          { error: 'Nieprawidłowy format danych' },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    // --------------------------------------------------------
    // Endpoint domyślny – informacje o API
    // --------------------------------------------------------
    return Response.json({
      name: 'HS Code Verifier API v1.4.3',
      version: env.VERSION,
      description: 'System weryfikacji kodów celnych HS z bazą ISZTAR',
      worker: 'hs-code-verifier-api',
      url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
      endpoints: [
        'GET  /health            - Status zdrowia systemu',
        'POST /login             - Logowanie użytkownika',
        'GET  /verify-session    - Sprawdza ważność sesji',
        'POST /logout            - Wylogowanie',
        'POST /verify            - Weryfikacja kodu HS (wymaga tokena)',
        'GET  /stats             - Statystyki bazy danych',
        'GET  /sanctions         - Lista kodów sankcyjnych',
        'POST /sanctions/update  - Aktualizacja listy sankcji (wymaga SYNC_TOKEN)',
        'GET  /controlled        - Lista kodów pod kontrolą SANEPID',
        'POST /controlled/update - Aktualizacja listy kontroli SANEPID (wymaga SYNC_TOKEN)',
        'GET  /logs              - Logi wyszukiwań (tylko admin)'
      ],
      timestamp: new Date().toISOString()
    }, { headers: corsHeaders });
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