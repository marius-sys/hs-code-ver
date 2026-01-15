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

// Funkcja do sprawdzania czy kod jest sankcyjny
async function checkIfSanctioned(code, env) {
  try {
    if (!env.HS_DATABASE) return false;
    
    const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
    if (!sanctionedData || !sanctionedData.codes) return false;
    
    // Sprawdź czy którykolwiek z kodów sankcyjnych pasuje
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

async function verifyHSCode(code, env) {
  try {
    const cleanedCode = code.replace(/\D/g, '');
    
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
    const description = database[cleanedCode];
    
    if (description) {
      // Sprawdź czy kod jest sankcyjny
      const isSanctioned = await checkIfSanctioned(cleanedCode, env);
      
      return {
        success: true,
        code: cleanedCode,
        description: description,
        source: 'isztar_delta_database',
        isValid: true,
        lastUpdated: await getLastSyncDate(env),
        cached: (Date.now() - cacheTimestamp) < CACHE_TTL,
        sanctioned: isSanctioned,
        sanctionMessage: isSanctioned ? 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!' : null
      };
    }
    
    const matchingCodes = Object.keys(database)
      .filter(k => k.startsWith(cleanedCode))
      .sort();
    
    if (matchingCodes.length > 0) {
      // Rozszerzanie kodów ogólnych z jednym podkodem
      if (matchingCodes.length === 1 && cleanedCode.length < 10) {
        const singleSubcode = matchingCodes[0];
        // Dopisz zera do pełnych 10 cyfr
        const paddedCode = singleSubcode.padEnd(10, '0');
        
        // Sprawdź czy kod jest sankcyjny
        const isSanctioned = await checkIfSanctioned(paddedCode, env);
        
        return {
          success: true,
          code: paddedCode,
          originalCode: cleanedCode,
          description: database[singleSubcode],
          source: 'isztar_delta_database',
          isValid: true,
          isGeneralCode: true,
          isSingleSubcode: true,
          sanctioned: isSanctioned,
          sanctionMessage: isSanctioned ? 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!' : null
        };
      }
      
      // Sprawdź czy kod ogólny jest sankcyjny
      const isSanctioned = await checkIfSanctioned(cleanedCode, env);
      
      return {
        success: true,
        code: cleanedCode,
        description: `Kod ogólny, zawiera ${matchingCodes.length} podkodów`,
        details: matchingCodes.slice(0, 10),
        totalSubcodes: matchingCodes.length,
        source: 'isztar_delta_database',
        isValid: true,
        isGeneralCode: true,
        sanctioned: isSanctioned,
        sanctionMessage: isSanctioned ? 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!' : null
      };
    }
    
    return {
      success: false,
      code: cleanedCode,
      description: 'Kod nieznany w systemie ISZTAR',
      source: 'isztar_delta_database',
      isValid: false
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
    
    if (url.pathname === '/health' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let metadata = null;
        let databaseSize = 0;
        let sanctionedCount = 0;
        
        if (hasDatabase) {
          try {
            metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
            const database = await getDatabase(env);
            databaseSize = Object.keys(database).length;
            
            // Pobierz liczbę kodów sankcyjnych
            const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            if (sanctionedData && sanctionedData.codes) {
              sanctionedCount = sanctionedData.codes.length;
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
          sanctions: {
            totalCodes: sanctionedCount
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
    
    if (url.pathname === '/verify' && request.method === 'POST') {
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
        return Response.json(result, { headers: corsHeaders });
        
      } catch (error) {
        return Response.json(
          { error: 'Nieprawidłowy format danych' },
          { status: 400, headers: corsHeaders }
        );
      }
    }
    
    if (url.pathname === '/stats' && request.method === 'GET') {
      try {
        const hasDatabase = !!env.HS_DATABASE;
        let metadata = null;
        let databaseSize = 0;
        let sanctionedCount = 0;
        let sanctionsLastUpdated = null;
        
        if (hasDatabase) {
          try {
            metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
            const database = await getDatabase(env);
            databaseSize = Object.keys(database).length;
            
            // Pobierz dane sankcyjne
            const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            if (sanctionedData) {
              sanctionedCount = sanctionedData.codes ? sanctionedData.codes.length : 0;
              sanctionsLastUpdated = sanctionedData.lastUpdated || null;
            }
          } catch (error) {
            console.log('Błąd odczytu statystyk:', error.message);
          }
        }
        
        return Response.json({
          name: 'HS Code Verifier API v1.4.2',
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
        
        // Sprawdź czy wszystkie kody są 4-cyfrowe
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
    
    return Response.json({
      name: 'HS Code Verifier API v1.4.2',
      version: env.VERSION,
      description: 'System weryfikacji kodów celnych HS z bazą ISZTAR',
      worker: 'hs-code-verifier-api',
      url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
      endpoints: [
        'GET /health - Status zdrowia systemu',
        'POST /verify - Weryfikacja kodu HS',
        'GET /stats - Statystyki bazy danych',
        'GET /sanctions - Lista kodów sankcyjnych',
        'POST /sanctions/update - Aktualizacja listy sankcji (wymaga tokenu)'
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