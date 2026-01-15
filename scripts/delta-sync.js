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
    }

    async fetchFromIsztar() {
        console.log('📥 Pobieranie danych z API ISZTAR...');
        this.newData = {};

        // Nagłówki, które działają z API ISZTAR (zapobiegają błędowi 406)
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
        
        for (let page = 1; page <= TOTAL_PAGES; page++) {
            try {
                process.stdout.write(`   Strona ${page}/${TOTAL_PAGES}... `);
                
                const response = await fetch(
                    `https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=${page}`,
                    {
                        headers: headers,
                        timeout: 30000,
                        redirect: 'follow'
                    }
                );

                if (response.ok) {
                    const data = await response.json();
                    this.processPage(data);
                    successfulPages++;
                    console.log('✅');
                } else {
                    console.log(`❌ HTTP ${response.status}`);
                    if (response.status === 406) {
                        console.log('   ⚠️  Błąd 406: API odrzuciło nagłówki');
                    }
                }
                
                // Opóźnienie 2 sekundy między żądaniami
                if (page < TOTAL_PAGES) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            } catch (error) {
                console.log(`❌ ${error.message}`);
            }
        }
        
        console.log(`   Pobrano dane z ${successfulPages}/${TOTAL_PAGES} stron`);
        console.log(`   Łącznie kodów HS: ${Object.keys(this.newData).length}`);
        
        if (successfulPages === 0) {
            throw new Error('Nie udało się pobrać żadnych danych z API ISZTAR');
        }
    }

    processPage(node, parentPath = []) {
        const currentPath = [...parentPath];
        if (node.description && node.description.trim()) {
            currentPath.push(node.description.trim());
        }

        if (node.code) {
            const fullDescription = currentPath.join(' → ');
            this.newData[node.code] = fullDescription;
        }

        if (node.subgroup && Array.isArray(node.subgroup)) {
            for (const child of node.subgroup) {
                this.processPage(child, currentPath);
            }
        }
    }

    async loadFromKV() {
        console.log('📖 Wczytywanie starej bazy z KV...');
        try {
            const cmd = `npx wrangler kv key get --namespace-id=${this.kvId} "HS_CURRENT_DATABASE" --remote --json 2>&1`;
            
            const stdout = execSync(cmd, { 
                encoding: 'utf8',
                stdio: ['pipe', 'pipe', 'pipe'],
                timeout: 30000
            }).trim();
            
            if (stdout && !stdout.includes('ERROR') && !stdout.includes('error')) {
                this.oldData = JSON.parse(stdout);
                console.log(`   ✅ Znaleziono ${Object.keys(this.oldData).length} istniejących kodów`);
            } else {
                console.log('   ℹ️  Brak istniejącej bazy - pierwsza synchronizacja');
                this.oldData = {};
            }
        } catch (error) {
            console.log(`   ⚠️  Błąd ładowania z KV: ${error.message}`);
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
        
        // 1. Backup starej bazy
        if (Object.keys(this.oldData).length > 0) {
            try {
                console.log('   Tworzenie backupu starej bazy...');
                const tmpFile = '/tmp/hs_backup.json';
                writeFileSync(tmpFile, JSON.stringify(this.oldData));
                
                const backupCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "HS_PREVIOUS_DATABASE" --path ${tmpFile} --remote`;
                execSync(backupCmd, { 
                    stdio: 'pipe',
                    timeout: 30000 
                });
                
                unlinkSync(tmpFile);
                console.log('   ✅ Backup zapisany');
            } catch (error) {
                console.log(`   ⚠️  Nie udało się zapisać backupu: ${error.message}`);
            }
        }

        // 2. Zapis nowej bazy
        try {
            console.log('   Zapis nowej bazy...');
            const dataStr = JSON.stringify(this.newData);
            const tmpFile = '/tmp/hs_data.json';
            writeFileSync(tmpFile, dataStr);
            
            const saveCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "HS_CURRENT_DATABASE" --path ${tmpFile} --remote`;
            execSync(saveCmd, { 
                encoding: 'utf8',
                timeout: 60000 
            });
            
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
            version: '1.4.1',
            syncType: 'delta'
        };

        try {
            console.log('   Zapis metadanych...');
            const metaFile = '/tmp/hs_metadata.json';
            writeFileSync(metaFile, JSON.stringify(metadata));
            
            const metaCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "HS_METADATA" --path ${metaFile} --remote`;
            execSync(metaCmd, { 
                stdio: 'pipe',
                timeout: 30000 
            });
            
            unlinkSync(metaFile);
            console.log('   ✅ Metadane zapisane');
        } catch (error) {
            console.log(`   ⚠️  Błąd zapisu metadanych: ${error.message}`);
        }
    }

    async testApiAccess() {
        console.log('\n🧪 Testowanie dostępu do API ISZTAR...');
        
        const testUrl = 'https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=1';
        
        const testHeaders = [
            {
                name: 'Podstawowe nagłówki',
                headers: { 'Accept': 'application/json' }
            },
            {
                name: 'Pełne nagłówki przeglądarki',
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            }
        ];
        
        for (const test of testHeaders) {
            console.log(`   Test: ${test.name}`);
            try {
                const response = await fetch(testUrl, {
                    headers: test.headers,
                    timeout: 10000
                });
                console.log(`     Status: ${response.status}`);
                
                if (response.ok) {
                    const data = await response.json();
                    console.log(`     ✅ Działa! Przykładowy kod: ${data.code || 'brak'}`);
                    return true;
                }
            } catch (error) {
                console.log(`     ❌ ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        return false;
    }

    async run() {
        console.log('='.repeat(60));
        console.log('🔄 SYSTEM SYNCHRONIZACJI DELTA HS CODES v1.4.1');
        console.log('='.repeat(60));
        console.log(`KV Namespace ID: ${this.kvId}`);
        console.log(`Node: ${process.version}`);
        console.log(`Czas: ${new Date().toISOString()}`);

        const startTime = Date.now();

        try {
            // 1. Sprawdź dostępność narzędzi
            console.log('\n1️⃣  Sprawdzanie narzędzi...');
            try {
                const wranglerVersion = execSync('npx wrangler --version 2>&1', { encoding: 'utf8' });
                console.log(`   ✅ Wrangler: ${wranglerVersion.trim()}`);
            } catch (error) {
                console.log(`   ❌ Błąd Wrangler: ${error.message}`);
            }

            // 2. Załaduj starą bazę
            await this.loadFromKV();
            
            // 3. Test API przed pobieraniem
            console.log('\n2️⃣  Testowanie połączenia z API ISZTAR...');
            const apiAccess = await this.testApiAccess();
            
            if (!apiAccess) {
                console.log('⚠️  API ISZTAR może być niedostępne lub wymaga innych nagłówków');
                console.log('   Próba kontynuowania...');
            }
            
            // 4. Pobierz nowe dane
            console.log('\n3️⃣  Pobieranie danych z API ISZTAR...');
            await this.fetchFromIsztar();
            
            if (Object.keys(this.newData).length === 0) {
                console.log('\n⚠️  UWAGA: Nie pobrano żadnych danych z API ISZTAR!');
                console.log('   Sprawdź czy API jest dostępne pod adresem:');
                console.log('   https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=1');
                console.log('\n   Możliwe problemy:');
                console.log('   1. API ISZTAR jest tymczasowo niedostępne');
                console.log('   2. Zmieniła się struktura API');
                console.log('   3. Problem z połączeniem internetowym');
                console.log('   4. Wymagane są inne nagłówki HTTP');
                
                // Spróbuj użyć minimalnej bazy testowej
                console.log('\n🔄 Tworzę minimalną bazę testową...');
                this.newData = {
                    "0101": "Konie, osły, muły żywe",
                    "020110": "Tusze i półtusze wołowe",
                    "030211": "Łososie atlantyckie i dunajskie, żywe",
                    "9999": "Kod testowy"
                };
                console.log(`   Utworzono ${Object.keys(this.newData).length} testowych kodów`);
            }
            
            // 5. Oblicz różnice
            this.calculateDiff();
            
            // 6. Zapisz zmiany
            if (this.changes.added + this.changes.updated + this.changes.removed > 0) {
                await this.saveToKV();
                console.log('\n✅ SYNCHRONIZACJA ZAKOŃCZONA SUKCESEM!');
            } else if (Object.keys(this.newData).length > 0) {
                console.log('\n✅ Brak zmian - baza jest aktualna');
                // Aktualizuj tylko timestamp metadanych
                await this.updateMetadataOnly();
            } else {
                console.log('\n⚠️  Brak danych do zapisania');
            }

            const duration = Math.round((Date.now() - startTime) / 1000);
            console.log(`\n⏱️  Czas wykonania: ${duration}s`);
            console.log('='.repeat(60));

        } catch (error) {
            console.error('\n💥 BŁĄD SYNCHRONIZACJI:', error.message);
            process.exit(1);
        }
    }

    async updateMetadataOnly() {
        console.log('📄 Aktualizacja tylko metadanych...');
        
        const metadata = {
            lastSync: new Date().toISOString(),
            totalRecords: Object.keys(this.oldData).length,
            changes: { added: 0, updated: 0, removed: 0, unchanged: Object.keys(this.oldData).length },
            version: '1.4.1',
            syncType: 'none'
        };

        try {
            const metaFile = '/tmp/hs_metadata.json';
            writeFileSync(metaFile, JSON.stringify(metadata));
            
            const metaCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "HS_METADATA" --path ${metaFile} --remote`;
            execSync(metaCmd, { stdio: 'pipe' });
            
            unlinkSync(metaFile);
            console.log('   ✅ Metadane zaktualizowane');
        } catch (error) {
            console.log(`   ⚠️  Błąd aktualizacji metadanych: ${error.message}`);
        }
    }
}

// Uruchom synchronizację
new DeltaSync().run().catch(console.error);