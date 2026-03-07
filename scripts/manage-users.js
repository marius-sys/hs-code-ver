#!/usr/bin/env node
import fetch from 'node-fetch';
import bcrypt from 'bcryptjs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

class UserManager {
  constructor() {
    this.kvId = "848ff6df2cb84046b48f1d64151f1cb7"; // zastąp rzeczywistym ID namespace USERS
    this.accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!this.accountId) {
      console.error('❌ Brak CLOUDFLARE_ACCOUNT_ID w środowisku!');
      process.exit(1);
    }
  }

  async runWrangler(cmd) {
    const fullCmd = `npx wrangler ${cmd}`;
    try {
      const { stdout, stderr } = await execAsync(fullCmd, {
        encoding: 'utf8',
        env: { ...process.env }
      });
      return { stdout, stderr, exitCode: 0 };
    } catch (error) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.code || 1
      };
    }
  }

  async addUser(username, password, role = 'user') {
    const hash = await bcrypt.hash(password, 10);
    const userData = { hash, role };
    const tmpFile = `/tmp/user_${username}.json`;
    writeFileSync(tmpFile, JSON.stringify(userData));

    console.log(`🆕 Dodawanie użytkownika: ${username} (rola: ${role})...`);
    const cmd = `kv key put --namespace-id=${this.kvId} "user:${username}" --path ${tmpFile} --remote`;
    const result = await this.runWrangler(cmd);
    
    if (result.exitCode === 0) {
      console.log(`✅ Użytkownik ${username} dodany pomyślnie.`);
    } else {
      console.error(`❌ Błąd: ${result.stderr}`);
    }
  }

  async removeUser(username) {
    console.log(`🗑️ Usuwanie użytkownika: ${username}...`);
    const cmd = `kv key delete --namespace-id=${this.kvId} "user:${username}" --remote`;
    const result = await this.runWrangler(cmd);
    
    if (result.exitCode === 0) {
      console.log(`✅ Użytkownik ${username} usunięty.`);
    } else {
      console.error(`❌ Błąd: ${result.stderr}`);
    }
  }

  async listUsers() {
    console.log('📋 Lista użytkowników:');
    const cmd = `kv key list --namespace-id=${this.kvId} --remote`;
    const result = await this.runWrangler(cmd);
    
    if (result.exitCode === 0 && result.stdout) {
      const keys = JSON.parse(result.stdout);
      const userKeys = keys.filter(k => k.name.startsWith('user:'));
      
      for (const key of userKeys) {
        const getCmd = `kv key get --namespace-id=${this.kvId} "${key.name}" --remote`;
        const getResult = await this.runWrangler(getCmd);
        if (getResult.exitCode === 0 && getResult.stdout) {
          try {
            const user = JSON.parse(getResult.stdout);
            console.log(`   • ${key.name.substring(5)} (rola: ${user.role})`);
          } catch {
            console.log(`   • ${key.name.substring(5)} (nie można odczytać roli)`);
          }
        }
      }
    } else {
      console.log('   Brak użytkowników w KV.');
    }
  }

  printHelp() {
    console.log(`
👥 Menedżer użytkowników HS Code Verifier

Użycie:
  node scripts/manage-users.js [polecenie] [opcje]

Polecenia:
  add <username> <password> [role]  - Dodaj nowego użytkownika (domyślna rola: user)
  remove <username>                  - Usuń użytkownika
  list                               - Wyświetl wszystkich użytkowników
  help                               - Wyświetl tę pomoc

Przykłady:
  node scripts/manage-users.js add jan "mojehaslo"
  node scripts/manage-users.js add admin "admin123" admin
  node scripts/manage-users.js remove jan
  node scripts/manage-users.js list
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
      case 'add':
        if (args.length < 3) {
          console.log('❌ Błąd: Podaj nazwę użytkownika i hasło');
          this.printHelp();
          return;
        }
        const username = args[1];
        const password = args[2];
        const role = args[3] || 'user';
        await this.addUser(username, password, role);
        break;
        
      case 'remove':
        if (args.length < 2) {
          console.log('❌ Błąd: Podaj nazwę użytkownika');
          this.printHelp();
          return;
        }
        await this.removeUser(args[1]);
        break;
        
      case 'list':
        await this.listUsers();
        break;
        
      default:
        console.log(`❌ Nieznane polecenie: ${command}`);
        this.printHelp();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const manager = new UserManager();
  manager.run().catch(console.error);
}