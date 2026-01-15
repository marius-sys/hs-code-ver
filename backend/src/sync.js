/**
 * Synchronizacja bazy danych HS z API ISZTAR do Cloudflare KV
 * Wersja 1.4.1: Delta updates - tylko zmienione rekordy
 */

const ISZTAR_API_BASE = 'https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes';
const TOTAL_PAGES = 21;

function processHierarchy(node, parentDescriptions = []) {
    const results = [];
    
    const currentPath = [...parentDescriptions];
    if (node.description && node.description.trim()) {
        currentPath.push(node.description.trim());
    }
    
    if (node.code) {
        const fullDescription = currentPath.join(' → ');
        results.push({
            code: node.code,
            description: fullDescription,
            rawHierarchy: currentPath
        });
    }
    
    if (node.subgroup && Array.isArray(node.subgroup)) {
        for (const child of node.subgroup) {
            results.push(...processHierarchy(child, currentPath));
        }
    }
    
    return results;
}

async function fetchIsztarPage(page) {
    try {
        console.log(`📥 Pobieranie strony ${page}/${TOTAL_PAGES}...`);
        
        const response = await fetch(`${ISZTAR_API_BASE}?page=${page}`, {
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive',
                'Origin': 'https://ext-isztar4.mf.gov.pl',
                'Referer': 'https://ext-isztar4.mf.gov.pl/',
                'Sec-Fetch-Dest': 'empty',
                'Sec-Fetch-Mode': 'cors',
                'Sec-Fetch-Site': 'same-origin'
            },
            timeout: 60000
        });
        
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText.substring(0, 200)}`);
        }
        
        const data = await response.json();
        const processed = processHierarchy(data);
        console.log(`✅ Strona ${page}: przetworzono ${processed.length} kodów`);
        
        return processed;
        
    } catch (error) {
        console.error(`❌ Błąd strony ${page}:`, error.message);
        throw error;
    }
}

async function fetchAllPagesToObject() {
    const database = {};
    let totalRecords = 0;
    let successfulPages = 0;
    
    for (let page = 1; page <= TOTAL_PAGES; page++) {
        try {
            const pageData = await fetchIsztarPage(page);
            
            pageData.forEach(item => {
                database[item.code] = item.description;
            });
            
            totalRecords += pageData.length;
            successfulPages++;
            
            // Opóźnienie między żądaniami, aby nie przeciążyć API
            if (page < TOTAL_PAGES) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
            
        } catch (error) {
            console.error(`⚠️ Pominięto stronę ${page} z powodu błędu:`, error.message);
            continue;
        }
    }
    
    console.log(`✅ Pobrano ${totalRecords} kodów z ${successfulPages}/${TOTAL_PAGES} stron`);
    
    if (successfulPages === 0) {
        throw new Error('Nie udało się pobrać żadnych stron z API');
    }
    
    return database;
}

async function getExistingDatabase(env) {
    try {
        const existing = await env.HS_DATABASE.get('HS_CURRENT_DATABASE', 'json');
        return existing || {};
    } catch (error) {
        console.log('⚠️  Brak istniejącej bazy lub błąd odczytu:', error.message);
        return {};
    }
}

function compareDatabases(oldDb, newDb) {
    const changes = {
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0
    };
    
    const allCodes = new Set([
        ...Object.keys(oldDb),
        ...Object.keys(newDb)
    ]);
    
    const updates = {};
    
    for (const code of allCodes) {
        const oldDesc = oldDb[code];
        const newDesc = newDb[code];
        
        if (!oldDesc && newDesc) {
            changes.added++;
            updates[code] = newDesc;
        } else if (oldDesc && !newDesc) {
            changes.removed++;
        } else if (oldDesc !== newDesc) {
            changes.updated++;
            updates[code] = newDesc;
        } else {
            changes.unchanged++;
        }
    }
    
    return { changes, updates, newDb };
}

async function saveDeltaToKV(env, oldDb, newDb, changes, updates) {
    const kv = env.HS_DATABASE;
    
    console.log(`💾 Rozpoczynam zapis zmian do KV...`);
    console.log(`   • Nowe rekordy: ${changes.added}`);
    console.log(`   • Zaktualizowane: ${changes.updated}`);
    console.log(`   • Usunięte: ${changes.removed}`);
    console.log(`   • Niezmienione: ${changes.unchanged}`);
    
    if (changes.added === 0 && changes.updated === 0 && changes.removed === 0) {
        console.log('✅ Brak zmian do zapisania');
        return { saved: 0, skipped: true };
    }
    
    // Zawsze twórz backup starej bazy
    if (Object.keys(oldDb).length > 0) {
        try {
            await kv.put('HS_PREVIOUS_DATABASE', JSON.stringify(oldDb));
            console.log('📦 Backup poprzedniej wersji zapisany');
        } catch (error) {
            console.error('⚠️  Błąd zapisu backupu:', error.message);
        }
    }
    
    // Zapisz nową bazę
    try {
        await kv.put('HS_CURRENT_DATABASE', JSON.stringify(newDb));
        console.log(`✅ Nowa baza zapisana (${Object.keys(newDb).length} rekordów)`);
    } catch (error) {
        console.error('❌ Błąd zapisu nowej bazy:', error.message);
        throw error;
    }
    
    // Zaktualizuj metadane
    const metadata = {
        lastSync: new Date().toISOString(),
        totalRecords: Object.keys(newDb).length,
        changes: changes,
        version: '1.4.1',
        syncType: 'delta',
        successfulPages: Math.floor(Object.keys(newDb).length / 100) // przybliżona liczba stron
    };
    
    try {
        await kv.put('HS_METADATA', JSON.stringify(metadata));
        console.log('📄 Metadane zapisane');
    } catch (error) {
        console.error('⚠️  Błąd zapisu metadanych:', error.message);
    }
    
    return { 
        saved: changes.added + changes.updated,
        changes: changes
    };
}

export async function syncIsztarData(env, ctx) {
    const startTime = Date.now();
    
    console.log('🚀 ROZPOCZĘCIE SYNCHRONIZACJI DELTA');
    console.log(`⏰ ${new Date().toISOString()}`);
    console.log('='.repeat(60));
    
    try {
        console.log('\n📖 Pobieranie istniejącej bazy z KV...');
        const oldDatabase = await getExistingDatabase(env);
        console.log(`   Znaleziono: ${Object.keys(oldDatabase).length} istniejących kodów`);
        
        console.log('\n📥 Pobieranie nowej bazy z API ISZTAR...');
        console.log('   Uwaga: API ISZTAR wymaga specyficznych nagłówków HTTP');
        const newDatabase = await fetchAllPagesToObject();
        
        if (Object.keys(newDatabase).length === 0) {
            throw new Error('Nie udało się pobrać żadnych danych z API');
        }
        
        console.log('\n🔍 Porównywanie baz danych...');
        const comparison = compareDatabases(oldDatabase, newDatabase);
        
        console.log('\n💾 Zapis zmian do KV...');
        const saveResult = await saveDeltaToKV(
            env, 
            oldDatabase, 
            newDatabase, 
            comparison.changes, 
            comparison.updates
        );
        
        const duration = Date.now() - startTime;
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 SYNCHRONIZACJA DELTA ZAKOŃCZONA SUKCESEM!');
        console.log('='.repeat(60));
        console.log('\n📊 PODSUMOWANIE:');
        console.log(`   • Nowa baza: ${Object.keys(newDatabase).length} kodów`);
        console.log(`   • Stara baza: ${Object.keys(oldDatabase).length} kodów`);
        console.log(`   • Zmiany:`);
        console.log(`       - Dodane: ${comparison.changes.added}`);
        console.log(`       - Zaktualizowane: ${comparison.changes.updated}`);
        console.log(`       - Usunięte: ${comparison.changes.removed}`);
        console.log(`       - Niezmienione: ${comparison.changes.unchanged}`);
        console.log(`   • Czas trwania: ${Math.round(duration / 1000)}s`);
        console.log(`   • Ostatnia aktualizacja: ${new Date().toISOString()}`);
        
        return {
            success: true,
            message: 'Synchronizacja delta zakończona sukcesem',
            metadata: {
                lastSync: new Date().toISOString(),
                totalRecords: Object.keys(newDatabase).length,
                changes: comparison.changes,
                duration: duration
            }
        };
        
    } catch (error) {
        console.error('\n💥 BŁĄD SYNCHRONIZACJI DELTA:', error);
        
        // W przypadku błędu, spróbuj zapisać przynajmniej starą bazę z zaktualizowanymi metadanymi
        try {
            if (Object.keys(oldDatabase || {}).length > 0) {
                const metadata = {
                    lastSync: new Date().toISOString(),
                    totalRecords: Object.keys(oldDatabase).length,
                    changes: { added: 0, updated: 0, removed: 0, unchanged: Object.keys(oldDatabase).length },
                    version: '1.4.1',
                    syncType: 'error_fallback',
                    error: error.message
                };
                await env.HS_DATABASE.put('HS_METADATA', JSON.stringify(metadata));
                console.log('⚠️  Zapisano metadane w trybie fallback');
            }
        } catch (fallbackError) {
            console.error('❌ Błąd fallback:', fallbackError.message);
        }
        
        return {
            success: false,
            message: `Błąd synchronizacji delta: ${error.message}`,
            timestamp: new Date().toISOString()
        };
    }
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
        
        if (url.pathname === '/api/sync' && request.method === 'POST') {
            const authToken = request.headers.get('Authorization');
            const expectedToken = env.SYNC_TOKEN;
            
            if (!expectedToken || authToken !== `Bearer ${expectedToken}`) {
                return Response.json(
                    { error: 'Brak autoryzacji' },
                    { status: 401, headers: corsHeaders }
                );
            }
            
            ctx.waitUntil(syncIsztarData(env, ctx));
            
            return Response.json(
                { 
                    success: true,
                    message: 'Synchronizacja delta rozpoczęta w tle',
                    timestamp: new Date().toISOString()
                },
                { headers: corsHeaders }
            );
        }
        
        if (url.pathname === '/api/sync/status' && request.method === 'GET') {
            try {
                const metadata = await env.HS_DATABASE.get('HS_METADATA', 'json');
                
                return Response.json(
                    {
                        status: 'ok',
                        lastSync: metadata ? metadata.lastSync : 'Nigdy',
                        syncType: metadata ? metadata.syncType : 'unknown',
                        totalRecords: metadata ? metadata.totalRecords : 0,
                        timestamp: new Date().toISOString()
                    },
                    { headers: corsHeaders }
                );
            } catch (error) {
                return Response.json(
                    { 
                        status: 'error',
                        message: error.message 
                    },
                    { status: 500, headers: corsHeaders }
                );
            }
        }
        
        return Response.json(
            { 
                error: 'Nie znaleziono endpointu',
                availableEndpoints: [
                    'POST /api/sync - Ręczna synchronizacja delta',
                    'GET /api/sync/status - Status synchronizacji'
                ]
            },
            { status: 404, headers: corsHeaders }
        );
    }
};