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

  async getCurrentSanctions() {
    console.log('📋 Pobieranie aktualnej listy sankcji...\n');
    
    try {
      const response = await fetch(`${this.workerUrl}/sanctions`);
      const data = await response.json();
      
      if (data.success) {
        console.log(`✅ Aktualne kody sankcyjne (${data.codes.length}):`);
        data.codes.forEach((code, index) => {
          console.log(`   ${index + 1}. ${code}`);
        });
        
        if (data.lastUpdated) {
          console.log(`\n📅 Ostatnia aktualizacja: ${data.lastUpdated}`);
        }
        
        return data.codes;
      } else {
        console.log('❌ Błąd:', data.error);
        return [];
      }
    } catch (error) {
      console.log('❌ Błąd połączenia:', error.message);
      return [];
    }
  }

  async updateSanctions(codes, token) {
    console.log(`🔄 Aktualizowanie listy sankcji (${codes.length} kodów)...\n`);
    
    try {
      const response = await fetch(`${this.workerUrl}/sanctions/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          codes: codes,
          metadata: {
            updatedBy: 'sanctions-manager',
            timestamp: new Date().toISOString()
          }
        })
      });
      
      const data = await response.json();
      
      if (data.success) {
        console.log('✅ Lista sankcji zaktualizowana pomyślnie!');
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
🎯 Menedżer kodów sankcyjnych HS Code Verifier

Użycie:
  node scripts/manage-sanctions.js [polecenie] [opcje]

Polecenia:
  list                    - Wyświetl aktualną listę kodów sankcyjnych
  update <token> <pliki>  - Zaktualizuj listę sankcji
  help                    - Wyświetl tę pomoc

Przykłady:
  node scripts/manage-sanctions.js list
  node scripts/manage-sanctions.js update "TWÓJ_TOKEN" sanctions-list.txt
  node scripts/manage-sanctions.js update "TWÓJ_TOKEN" list1.txt list2.txt

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
        await this.getCurrentSanctions();
        break;
        
      case 'update':
        if (args.length < 3) {
          console.log('❌ Błąd: Brak tokenu lub plików');
          console.log('   Użyj: node scripts/manage-sanctions.js update <token> <pliki...>');
          process.exit(1);
        }
        
        const token = args[1];
        const files = args.slice(2);
        let allCodes = [];
        
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
        console.log(`   • Pliki: ${files.join(', ')}`);
        console.log(`   • Unikalnych kodów: ${allCodes.length}`);
        console.log(`   • Przykłady: ${allCodes.slice(0, 5).join(', ')}${allCodes.length > 5 ? '...' : ''}`);
        
        const confirm = await this.prompt('Czy chcesz kontynuować? (tak/nie): ');
        
        if (confirm.toLowerCase() === 'tak') {
          await this.updateSanctions(allCodes, token);
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