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

async function checkIfSanepid(code, env) {
  try {
    if (!env.HS_DATABASE) return false;
    
    const sanepidData = await env.HS_DATABASE.get('HS_SANEPID_CODES', 'json');
    if (!sanepidData || !sanepidData.codes) return false;
    
    for (const sanepidCode of sanepidData.codes) {
      if (code.startsWith(sanepidCode)) {
        return true;
      }
    }
    
    return false;
  } catch (error) {
    console.error('Błąd sprawdzania kodów SANEPID:', error);
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
    
    // Sprawdź czy kod podlega sankcjom lub SANEPID
    const isSanctioned = await checkIfSanctioned(cleanedCode, env);
    const isSanepid = await checkIfSanepid(cleanedCode, env);
    
    let specialStatus = null;
    let specialMessage = null;
    let isValidForStatus = true;
    
    if (isSanepid) {
      specialStatus = 'sanepid';
      specialMessage = 'UWAGA: Towar podlega kontroli SANEPID - wymagane dokumenty sanitarne! Wymagane dokumenty sanitarne: świadectwo weterynaryjne, certyfikat fitosanitarny.';
      isValidForStatus = false; // Kod SANEPID nie może mieć statusu "POPRAWNY"
    } else if (isSanctioned) {
      specialStatus = 'sanction';
      specialMessage = 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
      isValidForStatus = false; // Kod sankcyjny nie może mieć statusu "POPRAWNY"
    }
    
    // 1. Sprawdź dokładne dopasowanie
    const exactMatch = database[cleanedCode];
    if (exactMatch) {
      return {
        success: true,
        code: cleanedCode,
        description: exactMatch,
        source: 'isztar_delta_database',
        isValid: true,
        lastUpdated: await getLastSyncDate(env),
        cached: (Date.now() - cacheTimestamp) < CACHE_TTL,
        specialStatus: specialStatus,
        specialMessage: specialMessage,
        isValidForStatus: isValidForStatus
      };
    }
    
    // 2. Znajdź kody, które zaczynają się od cleanedCode (kody szczegółowe)
    const detailedCodes = Object.keys(database)
      .filter(k => k.startsWith(cleanedCode))
      .sort();
    
    // 3. Znajdź kody, które są prefiksami cleanedCode (kody ogólne)
    const generalCodes = Object.keys(database)
      .filter(k => cleanedCode.startsWith(k))
      .sort((a, b) => b.length - a.length);
    
    // 4. Jeśli znaleziono dokładnie jeden kod szczegółowy
    if (detailedCodes.length === 1) {
      const singleCode = detailedCodes[0];
      const paddedCode = singleCode.padEnd(10, '0');
      
      return {
        success: true,
        code: paddedCode,
        originalCode: cleanedCode,
        description: database[singleCode],
        source: 'isztar_delta_database',
        isValid: true,
        isSingleSubcode: true,
        specialStatus: specialStatus,
        specialMessage: specialMessage,
        isValidForStatus: isValidForStatus
      };
    }
    
    // 5. Jeśli znaleziono wiele kodów szczegółowych
    if (detailedCodes.length > 1) {
      return {
        success: true,
        code: cleanedCode,
        description: `Kod ogólny, zawiera ${detailedCodes.length} podkodów`,
        details: detailedCodes.slice(0, 10),
        totalSubcodes: detailedCodes.length,
        source: 'isztar_delta_database',
        isValid: true,
        isGeneralCode: true,
        specialStatus: specialStatus,
        specialMessage: specialMessage,
        isValidForStatus: isValidForStatus
      };
    }
    
    // 6. Jeśli znaleziono kody ogólne (prefiksy) - NIE ustawiamy isGeneralCode!
    if (generalCodes.length > 0) {
      const longestPrefix = generalCodes[0];
      
      // Znajdź WSZYSTKIE kody zaczynające się od tego prefiksu
      const allCodesWithPrefix = Object.keys(database)
        .filter(k => k.startsWith(longestPrefix))
        .sort();
      
      // Znajdź tylko te kody, które zaczynają się od cleanedCode
      const codesStartingWithCleaned = Object.keys(database)
        .filter(k => k.startsWith(cleanedCode))
        .sort();
      
      // Jeśli cleanedCode jest prefiksem jakichś kodów, to to jest kod ogólny
      if (codesStartingWithCleaned.length > 0) {
        return {
          success: true,
          code: cleanedCode,
          description: `Kod ogólny, zawiera ${codesStartingWithCleaned.length} podkodów`,
          details: codesStartingWithCleaned.slice(0, 10),
          totalSubcodes: codesStartingWithCleaned.length,
          source: 'isztar_delta_database',
          isValid: true,
          isGeneralCode: true,
          specialStatus: specialStatus,
          specialMessage: specialMessage,
          isValidForStatus: isValidForStatus
        };
      }
      
      // cleanedCode NIE jest prefiksem żadnego kodu - to znaczy, że jest rozszerzeniem prefiksu
      const paddedCode = cleanedCode.padEnd(10, '0');
      
      // Jeśli prefiks ma tylko jeden kod, to cleanedCode jest jego rozszerzeniem
      if (allCodesWithPrefix.length === 1) {
        return {
          success: true,
          code: paddedCode,
          originalCode: cleanedCode,
          description: database[longestPrefix],
          source: 'isztar_delta_database',
          isValid: true,
          isExtendedFromPrefix: true,
          matchedPrefix: longestPrefix,
          specialStatus: specialStatus,
          specialMessage: specialMessage,
          isValidForStatus: isValidForStatus
        };
      }
      
      // Prefiks ma wiele kodów, ale cleanedCode nie jest prefiksem żadnego z nich
      // To znaczy, że cleanedCode jest "nieznanym" rozszerzeniem
      return {
        success: true,
        code: paddedCode,
        originalCode: cleanedCode,
        description: database[longestPrefix],
        source: 'isztar_delta_database',
        isValid: true,
        isExtendedFromPrefix: true,
        matchedPrefix: longestPrefix,
        specialStatus: specialStatus,
        specialMessage: specialMessage,
        isValidForStatus: isValidForStatus
      };
    }
    
    // 7. Jeśli nie znaleziono żadnego pasującego kodu
    return {
      success: false,
      code: cleanedCode,
      description: 'Kod nieznany w systemie ISZTAR',
      source: 'isztar_delta_database',
      isValid: false,
      specialStatus: specialStatus,
      specialMessage: specialMessage,
      isValidForStatus: false
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
      'Access-Control-Allow-Origin': 'https://hs-code.q4rail.com',
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
        let sanepidCount = 0;
        
        if (hasDatabase) {
          try {
            metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
            const database = await getDatabase(env);
            databaseSize = Object.keys(database).length;
            
            const sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            if (sanctionedData && sanctionedData.codes) {
              sanctionedCount = sanctionedData.codes.length;
            }
            
            const sanepidData = await env.HS_DATABASE.get('HS_SANEPID_CODES', 'json');
            if (sanepidData && sanepidData.codes) {
              sanepidCount = sanepidData.codes.length;
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
          sanepid: {
            totalCodes: sanepidCount
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
        let sanepidCount = 0;
        let sanctionsLastUpdated = null;
        let sanepidLastUpdated = null;
        
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
            
            const sanepidData = await env.HS_DATABASE.get('HS_SANEPID_CODES', 'json');
            if (sanepidData) {
              sanepidCount = sanepidData.codes ? sanepidData.codes.length : 0;
              sanepidLastUpdated = sanepidData.lastUpdated || null;
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
          sanepid: {
            totalCodes: sanepidCount,
            lastUpdated: sanepidLastUpdated
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
        let sanepidData = null;
        
        if (hasDatabase) {
          try {
            sanctionedData = await env.HS_DATABASE.get('HS_SANCTIONED_CODES', 'json');
            sanepidData = await env.HS_DATABASE.get('HS_SANEPID_CODES', 'json');
          } catch (error) {
            console.log('Błąd odczytu kodów:', error.message);
          }
        }
        
        return Response.json({
          success: true,
          sanctions: sanctionedData ? sanctionedData.codes || [] : [],
          sanepid: sanepidData ? sanepidData.codes || [] : [],
          sanctionsLastUpdated: sanctionedData ? sanctionedData.lastUpdated : null,
          sanepidLastUpdated: sanepidData ? sanepidData.lastUpdated : null,
          totalSanctions: sanctionedData && sanctionedData.codes ? sanctionedData.codes.length : 0,
          totalSanepid: sanepidData && sanepidData.codes ? sanepidData.codes.length : 0
        }, { headers: corsHeaders });
      } catch (error) {
        return Response.json(
          { success: false, error: 'Błąd pobierania kodów' },
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
        const { codes, type = 'sanctions' } = body;
        
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
        
        const key = type === 'sanepid' ? 'HS_SANEPID_CODES' : 'HS_SANCTIONED_CODES';
        const data = {
          codes: validCodes,
          lastUpdated: new Date().toISOString(),
          totalCodes: validCodes.length,
          version: '1.0'
        };
        
        await env.HS_DATABASE.put(key, JSON.stringify(data));
        
        return Response.json({
          success: true,
          message: `Zaktualizowano ${validCodes.length} kodów ${type === 'sanepid' ? 'SANEPID' : 'sankcyjnych'}`,
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
      name: 'HS Code Verifier API v1.4.3',
      version: env.VERSION,
      description: 'System weryfikacji kodów celnych HS z bazą ISZTAR',
      worker: 'hs-code-verifier-api',
      url: 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev',
      endpoints: [
        'GET /health - Status zdrowia systemu',
        'POST /verify - Weryfikacja kodu HS (akceptuje formaty: 1234, 1234 56, 1234-56-78)',
        'GET /stats - Statystyki bazy danych',
        'GET /sanctions - Lista kodów sankcyjnych i SANEPID',
        'POST /sanctions/update - Aktualizacja listy sankcji/SANEPID (wymaga tokenu)'
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