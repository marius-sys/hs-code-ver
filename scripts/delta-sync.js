#!/usr/bin/env node
import fetch from 'node-fetch';
import { execSync } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOTAL_PAGES = 21;

class DeltaSync {
    constructor() {
        this.newData = {};
        this.oldData = {};
        this.changes = {
            added: 0,
            updated: 0,
            removed: 0,
            unchanged: 0
        };
        this.kvId = "d4e909bdc6114613ab76635fadb855b2";
        this.kvKey = "HS_CURRENT_DATABASE";
        this.debugMode = process.argv.includes('--debug');
        // Tylko do walidacji, nie używamy w komendach
        this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
        if (!this.accountId) {
            console.error('❌ Brak CLOUDFLARE_ACCOUNT_ID w środowisku!');
            process.exit(1);
        }
    }

    // 🔧 Uproszczona metoda – bez flagi --account-id, polegamy na zmiennych środowiskowych
    runWrangler(cmd, options = {}) {
        const fullCmd = `npx wrangler ${cmd}`;
        try {
            const stdout = execSync(fullCmd, {
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: options.timeout || 60000,
                env: { ...process.env } // przekazujemy wszystkie zmienne (w tym CLOUDFLARE_ACCOUNT_ID)
            });
            return { stdout, stderr: '' };
        } catch (error) {
            const stderr = error.stderr?.toString() || '';
            const stdout = error.stdout?.toString() || '';
            throw new Error(`Wrangler error (${error.status}): ${stderr || stdout || error.message}`);
        }
    }

    async fetchFromIsztar() {
        console.log('📥 Pobieranie danych z API ISZTAR...');
        this.newData = {};

        const headers = {
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
        };

        let successfulPages = 0;
        let failedPages = 0;
        
        for (let page = 1; page <= TOTAL_PAGES; page++) {
            try {
                console.log(`\n📄 Strona ${page}/${TOTAL_PAGES}:`);
                
                const response = await fetch(
                    `https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=${page}`,
                    {
                        headers: headers,
                        timeout: 45000,
                        redirect: 'follow',
                        method: 'GET'
                    }
                );

                console.log(`   Status: ${response.status} ${response.statusText}`);
                
                if (response.ok) {
                    const data = await response.json();
                    const processedCount = this.processHierarchy(data);
                    successfulPages++;
                    console.log(`   ✅ Przetworzono: ${processedCount} kodów`);
                } else {
                    console.log(`   ❌ Błąd: ${response.status}`);
                    failedPages++;
                    
                    if (response.status === 406) {
                        const errorText = await response.text();
                        console.log(`   Szczegóły: ${errorText.substring(0, 200)}...`);
                    }
                }
                
                if (page < TOTAL_PAGES) {
                    console.log(`   ⏳ Oczekiwanie 2s przed następną stroną...`);
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.log(`   ❌ Błąd sieci: ${error.message}`);
                failedPages++;
            }
        }
        
        console.log(`\n📊 PODSUMOWANIE POBRANIA:`);
        console.log(`   ✅ Udane strony: ${successfulPages}/${TOTAL_PAGES}`);
        console.log(`   ❌ Nieudane strony: ${failedPages}`);
        console.log(`   📦 Łącznie kodów HS: ${Object.keys(this.newData).length}`);
        
        if (successfulPages === 0) {
            console.log('\n⚠️  UWAGA: Nie udało się pobrać żadnych danych!');
            console.log('   Sprawdź:');
            console.log('   1. Połączenie internetowe');
            console.log('   2. Czy API ISZTAR jest dostępne');
            console.log('   3. Użyj: npm run test-isztar');
            
            console.log('\n🔄 Tworzę minimalną bazę testową...');
            this.newData = this.createTestDatabase();
            console.log(`   Utworzono ${Object.keys(this.newData).length} testowych kodów`);
        }
    }

    processHierarchy(node, parentPath = []) {
        let processedCount = 0;
        
        const processNode = (currentNode, currentPath = []) => {
            const newPath = [...currentPath];
            
            if (currentNode.description && currentNode.description.trim()) {
                newPath.push(currentNode.description.trim());
            }
            
            if (currentNode.code) {
                const fullDescription = newPath.join(' → ');
                this.newData[currentNode.code] = fullDescription;
                processedCount++;
            }
            
            if (currentNode.subgroup && Array.isArray(currentNode.subgroup)) {
                for (const child of currentNode.subgroup) {
                    processNode(child, newPath);
                }
            }
        };
        
        processNode(node, parentPath);
        return processedCount;
    }

    createTestDatabase() {
        return {
            "0101": "Sekcja I → Rozdział 1 → 0101 - Konie, osły, muły i hinny żywe",
            "0102": "Sekcja I → Rozdział 1 → 0102 - Bydło żywe",
            "0103": "Sekcja I → Rozdział 1 → 0103 - Świnie żywe",
            "0104": "Sekcja I → Rozdział 1 → 0104 - Owce i kozy żywe",
            "0105": "Sekcja I → Rozdział 1 → 0105 - Drób żywy",
            "0201": "Sekcja I → Rozdział 2 → 0201 - Mięso bydlęce",
            "0202": "Sekcja I → Rozdział 2 → 0202 - Mięso cielęce",
            "0203": "Sekcja I → Rozdział 2 → 0203 - Mięso wieprzowe",
            "9999": "KOD TESTOWY - do weryfikacji systemu"
        };
    }

    async loadFromKV() {
        console.log(`\n📖 Wczytywanie starej bazy z KV (klucz: ${this.kvKey})...`);
        try {
            const cmd = `kv key get --namespace-id=${this.kvId} "${this.kvKey}" --remote --json`;
            const { stdout } = this.runWrangler(cmd, { timeout: 60000 });
            
            if (stdout && stdout !== 'null' && !stdout.includes('ERROR') && !stdout.includes('NotFound')) {
                try {
                    this.oldData = JSON.parse(stdout);
                    console.log(`   ✅ Znaleziono ${Object.keys(this.oldData).length} istniejących kodów`);
                } catch (parseError) {
                    console.log(`   ⚠️  Błąd parsowania JSON: ${parseError.message}`);
                    this.oldData = {};
                }
            } else {
                console.log('   ℹ️  Brak istniejącej bazy lub klucz nie istnieje – pierwsza synchronizacja');
                this.oldData = {};
            }
        } catch (error) {
            console.log(`   ❌ Błąd odczytu z KV: ${error.message}`);
            if (error.message.includes('Unauthorized') || error.message.includes('Authentication')) {
                console.error('   ⚠️  Błąd autoryzacji – sprawdź token i account ID!');
                process.exit(1);
            }
            this.oldData = {};
        }
    }

    calculateDiff() {
        console.log('\n🔍 Obliczanie różnic...');
        
        const allCodes = new Set([
            ...Object.keys(this.oldData),
            ...Object.keys(this.newData)
        ]);

        for (const code of allCodes) {
            const oldDesc = this.oldData[code];
            const newDesc = this.newData[code];

            if (!oldDesc && newDesc) {
                this.changes.added++;
            } else if (oldDesc && !newDesc) {
                this.changes.removed++;
            } else if (oldDesc !== newDesc) {
                this.changes.updated++;
            } else {
                this.changes.unchanged++;
            }
        }

        console.log(`
📊 ZMIANY:
   • Dodane: ${this.changes.added}
   • Zaktualizowane: ${this.changes.updated}
   • Usunięte: ${this.changes.removed}
   • Niezmienione: ${this.changes.unchanged}
        `);
    }

    async saveToKV() {
        console.log('\n💾 Zapis zmian do KV...');
        
        if (Object.keys(this.newData).length === 0) {
            console.log('   ⚠️  Brak danych do zapisania!');
            throw new Error('Brak danych do zapisania');
        }
        
        // 1. Backup starej bazy (jeśli istnieje)
        if (Object.keys(this.oldData).length > 0) {
            try {
                console.log('   Tworzenie backupu starej bazy...');
                const backupData = JSON.stringify(this.oldData);
                const tmpFile = '/tmp/hs_backup.json';
                writeFileSync(tmpFile, backupData);
                
                const cmd = `kv key put --namespace-id=${this.kvId} "HS_PREVIOUS_DATABASE" --path ${tmpFile} --remote`;
                this.runWrangler(cmd, { timeout: 30000 });
                
                unlinkSync(tmpFile);
                console.log('   ✅ Backup zapisany');
            } catch (error) {
                console.log(`   ⚠️  Nie udało się zapisać backupu: ${error.message}`);
            }
        }

        // 2. Zapis nowej bazy
        try {
            console.log(`   Zapis nowej bazy pod klucz: ${this.kvKey}...`);
            const dataStr = JSON.stringify(this.newData);
            const tmpFile = '/tmp/hs_data.json';
            writeFileSync(tmpFile, dataStr);
            
            const cmd = `kv key put --namespace-id=${this.kvId} "${this.kvKey}" --path ${tmpFile} --remote`;
            this.runWrangler(cmd, { timeout: 60000 });
            
            unlinkSync(tmpFile);
            console.log(`   ✅ Nowa baza zapisana (${Object.keys(this.newData).length} rekordów)`);
            
        } catch (error) {
            console.error(`   ❌ Błąd zapisu nowej bazy: ${error.message}`);
            throw error;
        }

        // 3. Zapis metadanych
        const metadata = {
            lastSync: new Date().toISOString(),
            totalRecords: Object.keys(this.newData).length,
            changes: this.changes,
            version: '1.4.3',
            syncType: 'delta'
        };

        try {
            console.log('   Zapis metadanych...');
            const metaFile = '/tmp/hs_metadata.json';
            writeFileSync(metaFile, JSON.stringify(metadata));
            
            const cmd = `kv key put --namespace-id=${this.kvId} "HS_METADATA" --path ${metaFile} --remote`;
            this.runWrangler(cmd, { timeout: 30000 });
            
            unlinkSync(metaFile);
            console.log('   ✅ Metadane zapisane');
        } catch (error) {
            console.log(`   ⚠️  Błąd zapisu metadanych: ${error.message}`);
        }
    }

    async updateMetadataOnly() {
        console.log('📄 Aktualizacja tylko metadanych...');
        
        const metadata = {
            lastSync: new Date().toISOString(),
            totalRecords: Object.keys(this.oldData).length,
            changes: { added: 0, updated: 0, removed: 0, unchanged: Object.keys(this.oldData).length },
            version: '1.4.3',
            syncType: 'none'
        };

        try {
            const metaFile = '/tmp/hs_metadata.json';
            writeFileSync(metaFile, JSON.stringify(metadata));
            
            const cmd = `kv key put --namespace-id=${this.kvId} "HS_METADATA" --path ${metaFile} --remote`;
            this.runWrangler(cmd);
            
            unlinkSync(metaFile);
            console.log('   ✅ Metadane zaktualizowane');
        } catch (error) {
            console.log(`   ⚠️  Błąd aktualizacji metadanych: ${error.message}`);
        }
    }

    async run() {
        console.log('='.repeat(60));
        console.log('🔄 SYSTEM SYNCHRONIZACJI DELTA HS CODES v1.4.3');
        console.log('='.repeat(60));
        console.log(`KV Namespace ID: ${this.kvId}`);
        console.log(`Klucz bazy: ${this.kvKey}`);
        console.log(`Node: ${process.version}`);
        console.log(`Czas: ${new Date().toISOString()}`);
        console.log(`Debug mode: ${this.debugMode}`);

        const startTime = Date.now();

        try {
            // 🔧 Test połączenia z KV – bez flagi --account-id
            console.log('\n1️⃣  Test połączenia z Cloudflare KV...');
            try {
                const testCmd = `kv key list --namespace-id=${this.kvId} --remote --limit 1`;
                this.runWrangler(testCmd, { timeout: 10000 });
                console.log('   ✅ Połączenie z KV działa');
            } catch (error) {
                console.error('   ❌ Błąd połączenia z KV:', error.message);
                console.error('   Sprawdź: CLOUDFLARE_API_TOKEN i uprawnienia (KV:Edit)');
                process.exit(1);
            }

            await this.loadFromKV();
            
            console.log('\n2️⃣  Pobieranie danych z API ISZTAR...');
            await this.fetchFromIsztar();
            
            this.calculateDiff();
            
            if (this.changes.added + this.changes.updated + this.changes.removed > 0) {
                await this.saveToKV();
                console.log('\n✅ SYNCHRONIZACJA ZAKOŃCZONA SUKCESEM!');
            } else if (Object.keys(this.newData).length > 0) {
                console.log('\n✅ Brak zmian – baza jest aktualna');
                await this.updateMetadataOnly();
            } else {
                console.log('\n⚠️  Brak danych do zapisania');
            }

            const duration = Math.round((Date.now() - startTime) / 1000);
            console.log(`\n⏱️  Czas wykonania: ${duration}s`);
            console.log('='.repeat(60));

        } catch (error) {
            console.error('\n💥 BŁĄD SYNCHRONIZACJI:', error.message);
            console.error('Stack:', error.stack);
            process.exit(1);
        }
    }
}

new DeltaSync().run().catch(console.error);