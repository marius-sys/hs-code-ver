import bcrypt from 'bcryptjs';

const RATE_LIMIT = {
  maxRequests: 20000,
  windowMs: 24 * 60 * 60 * 1000,
  message: 'Dzienny limit 20,000 zapytań został przekroczony.'
};

const dailyTracker = new Map();
let hsDatabaseCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 60 * 60 * 24; // 24h w sekundach

// ================== FUNKCJE POMOCNICZE ==================

function getClientIP(request) {
  return request.headers.get('CF-Connecting-IP') || 'unknown';
}

// Obsługa CORS – pozwala na wiele dozwolonych originów (oddzielonych spacją)
function getCorsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowedOrigins = (env.ALLOWED_ORIGINS || '').split(/\s+/).filter(Boolean);
  
  let allowedOrigin = '';
  if (allowedOrigins.includes('*') || !origin) {
    allowedOrigin = '*';
  } else if (allowedOrigins.includes(origin)) {
    allowedOrigin = origin;
  } else {
    // Jeśli origin nie jest dozwolony, nie zwracamy nagłówka CORS
    return {};
  }

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
  };
}

// Funkcja do tworzenia odpowiedzi z nagłówkami CORS
function respondWithCORS(data, status = 200, corsHeaders) {
  const headers = {
    'Content-Type': 'application/json',
    ...corsHeaders
  };
  return new Response(JSON.stringify(data), { status, headers });
}

// ================== FUNKCJE BAZY DANYCH HS ==================

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
  const { syncIsztarData } = await import('./sync.js');
  const result = await syncIsztarData(env, ctx);
  
  if (!result.success) {
    console.error('❌ Synchronizacja CRON nieudana:', result.message);
  }
  
  hsDatabaseCache = null;
  cacheTimestamp = 0;
  
  return result;
}

// ================== AUTORYZACJA (UŻYTKOWNICY W KV) ==================

async function getUserFromToken(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7);
  const data = await env.SESSIONS.get(`session:${token}`, 'json');
  if (!data || data.expires < Date.now()) return null;
  return data;
}

async function handleLogin(request, env, corsHeaders) {
  try {
    const { username, password } = await request.json();
    
    const userKey = `user:${username}`;
    const userData = await env.USERS.get(userKey, 'json');
    
    if (!userData) {
      return respondWithCORS({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const valid = await bcrypt.compare(password, userData.hash);
    if (!valid) {
      return respondWithCORS({ error: 'Unauthorized' }, 401, corsHeaders);
    }

    const token = crypto.randomUUID();
    const sessionData = {
      username,
      role: userData.role,
      expires: Date.now() + SESSION_TTL * 1000
    };
    await env.SESSIONS.put(`session:${token}`, JSON.stringify(sessionData), {
      expirationTtl: SESSION_TTL
    });

    return respondWithCORS({ token, username, role: userData.role }, 200, corsHeaders);
  } catch (e) {
    console.error('Błąd logowania:', e);
    return respondWithCORS({ error: 'Bad request' }, 400, corsHeaders);
  }
}

async function handleVerifySession(request, env, corsHeaders) {
  const user = await getUserFromToken(request, env);
  if (!user) return respondWithCORS({ error: 'Unauthorized' }, 401, corsHeaders);
  return respondWithCORS({ username: user.username, role: user.role }, 200, corsHeaders);
}

async function handleLogout(request, env, corsHeaders) {
  const auth = request.headers.get('Authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const token = auth.slice(7);
    await env.SESSIONS.delete(`session:${token}`);
  }
  return respondWithCORS({ message: 'OK' }, 200, corsHeaders);
}

async function handleLogs(request, env, corsHeaders) {
  const user = await getUserFromToken(request, env);
  if (!user || user.role !== 'admin') {
    return respondWithCORS({ error: 'Forbidden' }, 403, corsHeaders);
  }

  try {
    const list = await env.LOGS.list({ prefix: 'log:', limit: 100 });
    const logPromises = list.keys.map(async (key) => {
      const entry = await env.LOGS.get(key.name, 'json');
      return entry;
    });
    const logs = await Promise.all(logPromises);
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return respondWithCORS(logs, 200, corsHeaders);
  } catch (error) {
    console.error('Błąd pobierania logów:', error);
    return respondWithCORS({ error: 'Internal Server Error' }, 500, corsHeaders);
  }
}

async function logSearch(env, username, code, ip) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    username,
    code,
    ip
  };
  const key = `log:${Date.now()}:${username}:${code}`;
  await env.LOGS.put(key, JSON.stringify(logEntry), { expirationTtl: 60 * 60 * 24 * 30 }); // 30 dni
}

// ================== GŁÓWNY HANDLER ==================

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const corsHeaders = getCorsHeaders(request, env);
    
    // Obsługa preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }
    
    // Endpointy publiczne (nie wymagają autoryzacji)
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
        
        return respondWithCORS({
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
          sanctions: {
            totalCodes: sanctionedCount
          },
          controlled: {
            totalCodes: controlledCount
          },
          timestamp: new Date().toISOString()
        }, 200, corsHeaders);
      } catch (error) {
        return respondWithCORS({
          status: 'degraded',
          error: error.message,
          timestamp: new Date().toISOString()
        }, 500, corsHeaders);
      }
    }
    
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
        
        return respondWithCORS({
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
        }, 200, corsHeaders);
      } catch (error) {
        return respondWithCORS({ error: 'Błąd pobierania statystyk' }, 500, corsHeaders);
      }
    }
    
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
        
        return respondWithCORS({
          success: true,
          codes: sanctionedData ? sanctionedData.codes || [] : [],
          lastUpdated: sanctionedData ? sanctionedData.lastUpdated : null,
          totalCodes: sanctionedData && sanctionedData.codes ? sanctionedData.codes.length : 0
        }, 200, corsHeaders);
      } catch (error) {
        return respondWithCORS({ success: false, error: 'Błąd pobierania kodów sankcyjnych' }, 500, corsHeaders);
      }
    }
    
    if (url.pathname === '/sanctions/update' && request.method === 'POST') {
      const authToken = request.headers.get('Authorization');
      if (!env.SYNC_TOKEN || authToken !== `Bearer ${env.SYNC_TOKEN}`) {
        return respondWithCORS({ error: 'Brak autoryzacji' }, 401, corsHeaders);
      }
      
      try {
        const body = await request.json();
        const { codes } = body;
        
        if (!codes || !Array.isArray(codes)) {
          return respondWithCORS({ error: 'Nieprawidłowy format danych. Oczekiwano tablicy "codes"' }, 400, corsHeaders);
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
        
        return respondWithCORS({
          success: true,
          message: `Zaktualizowano ${validCodes.length} kodów sankcyjnych`,
          data: data
        }, 200, corsHeaders);
        
      } catch (error) {
        return respondWithCORS({ error: 'Nieprawidłowy format danych', details: error.message }, 400, corsHeaders);
      }
    }
    
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
        
        return respondWithCORS({
          success: true,
          codes: controlledData ? controlledData.codes || [] : [],
          lastUpdated: controlledData ? controlledData.lastUpdated : null,
          totalCodes: controlledData && controlledData.codes ? controlledData.codes.length : 0,
          listType: 'sanepid_control'
        }, 200, corsHeaders);
      } catch (error) {
        return respondWithCORS({ success: false, error: 'Błąd pobierania kodów kontroli SANEPID' }, 500, corsHeaders);
      }
    }
    
    if (url.pathname === '/controlled/update' && request.method === 'POST') {
      const authToken = request.headers.get('Authorization');
      if (!env.SYNC_TOKEN || authToken !== `Bearer ${env.SYNC_TOKEN}`) {
        return respondWithCORS({ error: 'Brak autoryzacji' }, 401, corsHeaders);
      }
      
      try {
        const body = await request.json();
        const { codes } = body;
        
        if (!codes || !Array.isArray(codes)) {
          return respondWithCORS({ error: 'Nieprawidłowy format danych. Oczekiwano tablicy "codes"' }, 400, corsHeaders);
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
        
        return respondWithCORS({
          success: true,
          message: `Zaktualizowano ${validCodes.length} kodów pod kontrolą SANEPID`,
          data: data
        }, 200, corsHeaders);
        
      } catch (error) {
        return respondWithCORS({ error: 'Nieprawidłowy format danych', details: error.message }, 400, corsHeaders);
      }
    }
    
    // Endpointy autoryzacji (nie wymagają tokena)
    if (url.pathname === '/login' && request.method === 'POST') {
      return handleLogin(request, env, corsHeaders);
    }
    
    // Endpointy wymagające tokena
    const user = await getUserFromToken(request, env);
    
    if (url.pathname === '/verify-session' && request.method === 'GET') {
      return handleVerifySession(request, env, corsHeaders);
    }
    
    if (url.pathname === '/logout' && request.method === 'POST') {
      return handleLogout(request, env, corsHeaders);
    }
    
    if (url.pathname === '/logs' && request.method === 'GET') {
      return handleLogs(request, env, corsHeaders);
    }
    
    if (url.pathname === '/verify' && request.method === 'POST') {
      if (!user) {
        return respondWithCORS({ error: 'Unauthorized' }, 401, corsHeaders);
      }
      
      const clientIP = getClientIP(request);
      if (!checkRateLimit(clientIP)) {
        return respondWithCORS({ error: RATE_LIMIT.message }, 429, corsHeaders);
      }
      
      try {
        const body = await request.json();
        const { code } = body;
        
        if (!code) {
          return respondWithCORS({ error: 'Brak kodu HS' }, 400, corsHeaders);
        }
        
        if (!env.HS_DATABASE) {
          return respondWithCORS({
            success: false,
            code: code,
            description: 'Baza danych niedostępna',
            error: 'DATABASE_UNAVAILABLE'
          }, 503, corsHeaders);
        }
        
        const result = await verifyHSCode(code, env);
        ctx.waitUntil(logSearch(env, user.username, code, clientIP));
        return respondWithCORS(result, 200, corsHeaders);
        
      } catch (error) {
        return respondWithCORS({ error: 'Nieprawidłowy format danych' }, 400, corsHeaders);
      }
    }
    
    // Domyślna odpowiedź (root)
    return respondWithCORS({
      name: 'HS Code Verifier API v1.4.3',
      version: env.VERSION,
      description: 'System weryfikacji kodów celnych HS z bazą ISZTAR',
      worker: 'hs-code-verifier-api',
      url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
      endpoints: [
        'GET /health - Status zdrowia systemu',
        'POST /login - Logowanie',
        'GET /verify-session - Sprawdzenie sesji',
        'POST /logout - Wylogowanie',
        'GET /logs - Lista logów (admin)',
        'POST /verify - Weryfikacja kodu HS (wymaga tokena)',
        'GET /stats - Statystyki bazy danych',
        'GET /sanctions - Lista kodów sankcyjnych',
        'POST /sanctions/update - Aktualizacja listy sankcji (wymaga tokenu)',
        'GET /controlled - Lista kodów pod kontrolą SANEPID',
        'POST /controlled/update - Aktualizacja listy kontroli SANEPID (wymaga tokenu)'
      ],
      timestamp: new Date().toISOString()
    }, 200, corsHeaders);
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