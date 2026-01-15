#!/usr/bin/env node
import fetch from 'node-fetch';

async function testIsztarAPI() {
    console.log('🧪 TEST API ISZTAR\n');
    
    try {
        console.log('1. Test połączenia z API...');
        const response = await fetch(
            'https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=1',
            {
                headers: {
                    'Accept': 'application/json, text/plain, */*',
                    'User-Agent': 'Mozilla/5.0 (compatible; HS-Code-Verifier/1.0)',
                    'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8'
                },
                timeout: 30000
            }
        );
        
        console.log(`   Status: ${response.status} ${response.statusText}`);
        
        if (response.ok) {
            const data = await response.json();
            console.log(`   ✅ Połączenie OK`);
            console.log(`   • Struktura odpowiedzi:`, Object.keys(data));
            
            function analyzeStructure(obj, depth = 0, maxDepth = 2) {
                if (depth > maxDepth) return;
                
                const indent = '  '.repeat(depth);
                console.log(`${indent}• ${obj.description ? obj.description.substring(0, 50) : 'NO DESCRIPTION'}`);
                
                if (obj.code) {
                    console.log(`${indent}  📍 Kod: ${obj.code}`);
                }
                
                if (obj.subgroup && Array.isArray(obj.subgroup)) {
                    console.log(`${indent}  📂 Podgrupy: ${obj.subgroup.length}`);
                    if (depth < maxDepth && obj.subgroup.length > 0) {
                        analyzeStructure(obj.subgroup[0], depth + 1, maxDepth);
                    }
                }
            }
            
            console.log('\n2. Analiza struktury danych:');
            analyzeStructure(data);
            
        } else {
            console.log(`   ❌ Błąd API`);
        }
        
    } catch (error) {
        console.log(`   ❌ Błąd: ${error.message}`);
    }
    
    console.log('\n3. Test dostępności stron (1-3):');
    let availablePages = 0;
    
    for (let i = 1; i <= 3; i++) {
        try {
            const response = await fetch(
                `https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=${i}`,
                {
                    headers: {
                        'Accept': 'application/json, text/plain, */*',
                        'User-Agent': 'Mozilla/5.0 (compatible; HS-Code-Verifier/1.0)'
                    },
                    timeout: 10000
                }
            );
            
            if (response.ok) {
                availablePages++;
                console.log(`   📄 Strona ${i}: ✅ Dostępna`);
            } else {
                console.log(`   📄 Strona ${i}: ❌ ${response.status}`);
            }
            
            await new Promise(resolve => setTimeout(resolve, 500));
            
        } catch (error) {
            console.log(`   📄 Strona ${i}: ❌ ${error.message}`);
        }
    }
    
    console.log(`\n📊 Podsumowanie: ${availablePages}/3 stron dostępnych`);
}

testIsztarAPI().catch(console.error);