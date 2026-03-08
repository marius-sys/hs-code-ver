import { sign, verify } from 'jsonwebtoken';
import { syncIsztarData } from './sync.js';

const RATE_LIMIT = {
  maxRequests: 20000,
  windowMs: 24 * 60 * 60 * 1000,
  message: 'Dzienny limit 20,000 zapytań został przekroczony.'
};

const dailyTracker = new Map();
let hsDatabaseCache = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000;

// ------------------------------------------------------------
// Funkcje pomocnicze JWT
// ------------------------------------------------------------
function generateToken(payload, secret, expiresIn = '7d') {
  return sign(payload, secret, { expiresIn });
}

function verifyToken(token, secret) {
  try {
    return verify(token, secret);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// Hashowanie hasła
// ------------------------------------------------------------
async function hashPassword(password, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(password));
  return btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// ------------------------------------------------------------
// Logowanie zapytań do KV
// ------------------------------------------------------------
async function logQuery(env, userId, code, ip) {
  try {
    const timestamp = Date.now();
    const key = `log:${timestamp}:${userId}`;
    const logEntry = {
      userId,
      code,
      ip,
      timestamp: new Date().toISOString()
    };
    await env.HS_DATABASE.put(key, JSON.stringify(logEntry));
  } catch (error) {
    console.error('Błąd logowania:', error);
  }
}

// ------------------------------------------------------------
// Funkcje pomocnicze (bez zmian z wersji 1.4.3)
// ------------------------------------------------------------
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
// Endpointy logowania i admina
// ------------------------------------------------------------
async function handleLogin(request, env) {
  try {
    const { username, password } = await request.json();
    if (!username || !password) {
      return Response.json({ error: 'Brak nazwy użytkownika lub hasła' }, { status: 400 });
    }

    const userData = await env.HS_DATABASE.get(`user:${username}`, 'json');
    if (!userData) {
      return Response.json({ error: 'Nieprawidłowe dane logowania' }, { status: 401 });
    }

    const hash = await hashPassword(password, env.JWT_SECRET + username);
    if (hash !== userData.passwordHash) {
      return Response.json({ error: 'Nieprawidłowe dane logowania' }, { status: 401 });
    }

    const token = generateToken(
      { username, role: userData.role },
      env.JWT_SECRET
    );

    return Response.json({ success: true, token, role: userData.role });
  } catch (error) {
    return Response.json({ error: 'Błąd serwera' }, { status: 500 });
  }
}

async function handleAdminLogs(request, env, user) {
  if (user.role !== 'admin') {
    return Response.json({ error: 'Brak uprawnień' }, { status: 403 });
  }

  try {
    const list = await env.HS_DATABASE.list({ prefix: 'log:', limit: 200 });
    const logs = [];
    for (const key of list.keys) {
      const value = await env.HS_DATABASE.get(key.name, 'json');
      if (value) logs.push(value);
    }
    logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return Response.json({ success: true, logs: logs.slice(0, 100) });
  } catch (error) {
    return Response.json({ error: 'Błąd pobierania logów' }, { status: 500 });
  }
}

async function handleAdminUsers(request, env, user) {
  if (user.role !== 'admin') {
    return Response.json({ error: 'Brak uprawnień' }, { status: 403 });
  }
  try {
    const list = await env.HS_DATABASE.list({ prefix: 'user:' });
    const users = [];
    for (const key of list.keys) {
      const value = await env.HS_DATABASE.get(key.name, 'json');
      if (value) {
        users.push({
          username: key.name.replace('user:', ''),
          role: value.role,
          createdAt: value.createdAt
        });
      }
    }
    return Response.json({ success: true, users });
  } catch (error) {
    return Response.json({ error: 'Błąd pobierania użytkowników' }, { status: 500 });
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
    // Endpointy publiczne
    // --------------------------------------------------------
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
          worker: 'hs-code-verifier-api-auth',
          url: 'https://hs-code-verifier-api-auth.konto-dla-m-w-q4r.workers.dev',
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
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({
          status: 'degraded',
          error: error.message,
          timestamp: new Date().toISOString()
        }, { status: 500, headers: corsHeaders });
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

    // --------------------------------------------------------
    // Endpoint logowania
    // --------------------------------------------------------
    if (url.pathname === '/login' && request.method === 'POST') {
      const result = await handleLogin(request, env);
      return Response.json(result, { headers: corsHeaders });
    }

    // --------------------------------------------------------
    // Autoryzacja JWT
    // --------------------------------------------------------
    const authHeader = request.headers.get('Authorization');
    let user = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      user = verifyToken(token, env.JWT_SECRET);
    }

    // --------------------------------------------------------
    // /verify – wymaga tokena
    // --------------------------------------------------------
    if (url.pathname === '/verify' && request.method === 'POST') {
      if (!user) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
      
      const clientIP = getClientIP(request);
      if (!checkRateLimit(clientIP)) {
        return Response.json({ error: RATE_LIMIT.message }, { status: 429, headers: corsHeaders });
      }

      try {
        const body = await request.json();
        const { code } = body;
        if (!code) {
          return Response.json({ error: 'Brak kodu HS' }, { status: 400, headers: corsHeaders });
        }

        const result = await verifyHSCode(code, env);
        ctx.waitUntil(logQuery(env, user.username, code, clientIP));
        return Response.json(result, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ error: 'Nieprawidłowy format danych' }, { status: 400, headers: corsHeaders });
      }
    }

    // --------------------------------------------------------
    // Endpointy admina
    // --------------------------------------------------------
    if (user) {
      if (url.pathname === '/admin/logs' && request.method === 'GET') {
        const result = await handleAdminLogs(request, env, user);
        return Response.json(result, { headers: corsHeaders });
      }
      if (url.pathname === '/admin/users' && request.method === 'GET') {
        const result = await handleAdminUsers(request, env, user);
        return Response.json(result, { headers: corsHeaders });
      }
    } else {
      if (url.pathname.startsWith('/admin/')) {
        return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
      }
    }

    // --------------------------------------------------------
    // Endpointy synchronizacji
    // --------------------------------------------------------
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

    if (url.pathname === '/api/sync' && request.method === 'POST') {
      const authToken = request.headers.get('Authorization');
      const expectedToken = env.SYNC_TOKEN;
      if (!expectedToken || authToken !== `Bearer ${expectedToken}`) {
        return Response.json({ error: 'Brak autoryzacji' }, { status: 401, headers: corsHeaders });
      }
      ctx.waitUntil(syncIsztarData(env, ctx));
      return Response.json({ 
        success: true,
        message: 'Synchronizacja delta rozpoczęta w tle',
        timestamp: new Date().toISOString()
      }, { headers: corsHeaders });
    }

    if (url.pathname === '/api/sync/status' && request.method === 'GET') {
      try {
        const metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
        return Response.json({
          status: 'ok',
          lastSync: metadata ? metadata.lastSync : 'Nigdy',
          syncType: metadata ? metadata.syncType : 'unknown',
          totalRecords: metadata ? metadata.totalRecords : 0,
          timestamp: new Date().toISOString()
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json({ 
          status: 'error',
          message: error.message 
        }, { status: 500, headers: corsHeaders });
      }
    }

    return Response.json({
      name: 'HS Code Verifier API with Auth',
      version: env.VERSION,
      endpoints: [
        'POST /login',
        'POST /verify',
        'GET /health',
        'GET /stats',
        'GET /admin/logs (wymaga tokena admin)',
        'GET /admin/users (wymaga tokena admin)'
      ]
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