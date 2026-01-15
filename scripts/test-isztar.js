#!/usr/bin/env node
import fetch from 'node-fetch';

async function testIsztarAPI() {
    console.log('🧪 SZCZEGÓŁOWY TEST API ISZTAR\n');
    
    const testCases = [
        {
            name: 'Podstawowe żądanie z domyślnymi nagłówkami',
            headers: {
                'Accept': 'application/json'
            }
        },
        {
            name: 'Żądanie z pełnymi nagłówkami przeglądarki',
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Accept-Encoding': 'gzip, deflate, br',
                'Connection': 'keep-alive'
            }
        },
        {
            name: 'Żądanie z nagłówkami CORS',
            headers: {
                'Accept': 'application/json',
                'Origin': 'https://ext-isztar4.mf.gov.pl',
                'Referer': 'https://ext-isztar4.mf.gov.pl/'
            }
        }
    ];
    
    const url = 'https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes?page=1';
    
    for (const testCase of testCases) {
        console.log(`\n🔍 Test: ${testCase.name}`);
        console.log(`   Nagłówki:`, testCase.headers);
        
        try {
            const response = await fetch(url, {
                headers: testCase.headers,
                timeout: 10000
            });
            
            console.log(`   Status: ${response.status} ${response.statusText}`);
            console.log(`   Content-Type: ${response.headers.get('content-type')}`);
            
            if (response.ok) {
                const data = await response.json();
                console.log(`   ✅ SUKCES! Struktura danych:`);
                console.log(`      - code: ${data.code || 'brak'}`);
                console.log(`      - description: ${data.description ? data.description.substring(0, 50) + '...' : 'brak'}`);
                console.log(`      - subgroup: ${data.subgroup ? data.subgroup.length + ' elementów' : 'brak'}`);
                break;
            } else {
                const errorText = await response.text();
                console.log(`   ❌ BŁĄD: ${errorText.substring(0, 200)}`);
            }
            
        } catch (error) {
            console.log(`   ❌ EXCEPTION: ${error.message}`);
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Test dostępności różnych endpointów
    console.log('\n🌐 Test dostępności różnych endpointów:');
    
    const endpoints = [
        'https://ext-isztar4.mf.gov.pl/tariff/rest/goods-nomenclature/codes',
        'https://ext-isztar4.mf.gov.pl/tariff/',
        'https://ext-isztar4.mf.gov.pl/',
        'https://ext-isztar4.mf.gov.pl/tariff/rest/'
    ];
    
    for (const endpoint of endpoints) {
        try {
            const response = await fetch(endpoint, { 
                method: 'HEAD',
                timeout: 5000 
            });
            console.log(`   ${endpoint}: ${response.status} ${response.statusText}`);
        } catch (error) {
            console.log(`   ${endpoint}: ❌ ${error.message}`);
        }
    }
}

testIsztarAPI().catch(console.error);