#!/usr/bin/env node
import fetch from 'node-fetch';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

class SanctionsManager {
  constructor() {
    this.workerUrl = "https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev";
  }

  async getCurrentLists() {
    console.log('📋 Pobieranie aktualnych list...\n');
    
    try {
      const response = await fetch(`${this.workerUrl}/sanctions`);
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Aktualne kody sankcyjne (${data.totalSanctions}):`);
        data.sanctions.forEach((code, index) => {
          console.log(`   ${index + 1}. ${code}`);
        });
        
        console.log(`\n✅ Aktualne kody SANEPID (${data.totalSanepid}):`);
        data.sanepid.forEach((code, index) => {
          console.log(`   ${index + 1}. ${code}`);
        });
        
        if (data.sanctionsLastUpdated) {
          console.log(`\n📅 Sankcje ostatnio zaktualizowane: ${data.sanctionsLastUpdated}`);
        }
        if (data.sanepidLastUpdated) {
          console.log(`📅 SANEPID ostatnio zaktualizowany: ${data.sanepidLastUpdated}`);
        }
        
        return { sanctions: data.sanctions, sanepid: data.sanepid };
      } else {
        console.log('❌ Błąd:', data.error);
        return { sanctions: [], sanepid: [] };
      }
    } catch (error) {
      console.log('❌ Błąd połączenia:', error.message);
      return { sanctions: [], sanepid: [] };
    }
  }

  async updateList(codes, token, type = 'sanctions') {
    const listName = type === 'sanepid' ? 'SANEPID' : 'sankcyjnych';
    console.log(`🔄 Aktualizowanie listy ${listName} (${codes.length} kodów)...\n`);
    
    try {
      const response = await fetch(`${this.workerUrl}/sanctions/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          codes: codes,
          type: type,
          metadata: {
            updatedBy: 'sanctions-manager',
            timestamp: new Date().toISOString()
          }
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Lista ${listName} zaktualizowana pomyślnie!`);
        console.log(`   • Ilość kodów: ${data.data.totalCodes}`);
        console.log(`   • Data: ${data.data.lastUpdated}`);
        console.log(`   • Wersja: ${data.data.version}`);
      } else {
        console.log('❌ Błąd:', data.error);
      }
      
      return data;
    } catch (error) {
      console.log('❌ Błąd aktualizacji:', error.message);
      return { success: false, error: error.message };
    }
  }

  loadFromFile(filePath) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#') && /^\d{4}$/.test(line));
      
      console.log(`📄 Załadowano ${lines.length} kodów z pliku: ${filePath}`);
      return [...new Set(lines)];
    } catch (error) {
      console.log(`❌ Błąd odczytu pliku ${filePath}:`, error.message);
      return [];
    }
  }

  printHelp() {
    console.log(`
🎯 Menedżer kodów specjalnych HS Code Verifier v1.4.3

Użycie:
  node scripts/manage-sanctions.js [polecenie] [opcje]

Polecenia:
  list                    - Wyświetl aktualne listy kodów sankcyjnych i SANEPID
  update <typ> <token> <pliki> - Zaktualizuj listę
  help                    - Wyświetl tę pomoc

Typy:
  sanctions               - Kody sankcyjne
  sanepid                 - Kody podlegające kontroli SANEPID

Przykłady:
  node scripts/manage-sanctions.js list
  node scripts/manage-sanctions.js update sanctions "TWÓJ_TOKEN" sanctions-list.txt
  node scripts/manage-sanctions.js update sanepid "TWÓJ_TOKEN" sanepid-list.txt

Pliki z kodami powinny zawierać po jednym kodzie 4-cyfrowym w każdej linii.
Komentarze zaczynają się od #.
    `);
  }

  async run() {
    const args = process.argv.slice(2);
    
    if (args.length === 0 || args[0] === 'help') {
      this.printHelp();
      return;
    }
    
    const command = args[0];
    
    switch (command) {
      case 'list':
        await this.getCurrentLists();
        break;
        
      case 'update':
        if (args.length < 4) {
          console.log('❌ Błąd: Brak typu, tokenu lub plików');
          console.log('   Użyj: node scripts/manage-sanctions.js update <typ> <token> <pliki...>');
          process.exit(1);
        }
        
        const type = args[1];
        const token = args[2];
        const files = args.slice(3);
        let allCodes = [];
        
        if (type !== 'sanctions' && type !== 'sanepid') {
          console.log('❌ Błąd: Nieprawidłowy typ. Użyj: sanctions lub sanepid');
          process.exit(1);
        }
        
        for (const file of files) {
          const codes = this.loadFromFile(file);
          allCodes = [...allCodes, ...codes];
        }
        
        allCodes = [...new Set(allCodes)];
        
        if (allCodes.length === 0) {
          console.log('❌ Brak kodów do zaktualizowania');
          process.exit(1);
        }
        
        console.log(`\n📊 Podsumowanie:`);
        console.log(`   • Typ: ${type}`);
        console.log(`   • Pliki: ${files.join(', ')}`);
        console.log(`   • Unikalnych kodów: ${allCodes.length}`);
        console.log(`   • Przykłady: ${allCodes.slice(0, 5).join(', ')}${allCodes.length > 5 ? '...' : ''}`);
        
        const confirm = await this.prompt('Czy chcesz kontynuować? (tak/nie): ');
        
        if (confirm.toLowerCase() === 'tak') {
          await this.updateList(allCodes, token, type);
        } else {
          console.log('❌ Anulowano aktualizację');
        }
        break;
        
      default:
        console.log(`❌ Nieznane polecenie: ${command}`);
        this.printHelp();
    }
  }

  async prompt(question) {
    process.stdout.write(question);
    return new Promise(resolve => {
      process.stdin.once('data', data => {
        resolve(data.toString().trim());
      });
    });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new SanctionsManager();
  manager.run().catch(console.error);
}