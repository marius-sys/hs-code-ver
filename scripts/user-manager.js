#!/usr/bin/env node
/**
 * Skrypt do zarządzania użytkownikami (CLI)
 */

import { createHash, randomBytes } from 'crypto';
import { execSync } from 'child_process';

class UserManager {
    constructor() {
        this.kvId = "d4e909bdc6114613ab76635fadb855b2";
    }

    hashPassword(password, salt = randomBytes(16).toString('hex')) {
        const hash = createHash('sha256');
        hash.update(password + salt);
        return {
            hash: hash.digest('hex'),
            salt: salt
        };
    }

    async listUsers() {
        console.log('📋 Lista użytkowników:\n');
        
        try {
            const listKey = 'USERS:LIST';
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${listKey}" --remote 2>&1`;
            
            let result;
            try {
                result = execSync(getCmd, { encoding: 'utf8' });
            } catch (error) {
                console.log('❌ Brak zarejestrowanych użytkowników');
                return;
            }
            
            let userIds;
            try {
                userIds = JSON.parse(result.trim());
            } catch {
                console.log('❌ Błąd parsowania listy użytkowników');
                return;
            }
            
            if (!userIds || userIds.length === 0) {
                console.log('❌ Brak zarejestrowanych użytkowników');
                return;
            }
            
            // Pobierz dane każdego użytkownika
            for (const userId of userIds) {
                const userKey = `USER:${userId}`;
                const userCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userKey}" --remote 2>&1`;
                
                try {
                    const userResult = execSync(userCmd, { encoding: 'utf8' });
                    const userData = JSON.parse(userResult.trim());
                    
                    console.log(`👤 ${userData.username} (${userData.role})`);
                    console.log(`   ID: ${userData.id}`);
                    console.log(`   E-mail: ${userData.email || 'brak'}`);
                    console.log(`   Utworzono: ${userData.createdAt}`);
                    console.log(`   Ostatnie logowanie: ${userData.lastLogin || 'nigdy'}`);
                    console.log(`   Status: ${userData.active ? 'aktywny' : 'nieaktywny'}`);
                    console.log(`   Liczba logowań: ${userData.loginCount || 0}`);
                    console.log('---');
                } catch (error) {
                    console.log(`❌ Błąd pobierania użytkownika ${userId}`);
                }
            }
            
        } catch (error) {
            console.error('❌ Błąd:', error.message);
        }
    }

    async createUser(username, password, role = 'user', email = '') {
        console.log(`➕ Tworzenie użytkownika: ${username}`);
        
        // Walidacja
        if (!username || !password) {
            console.log('❌ Nazwa użytkownika i hasło są wymagane');
            return;
        }
        
        if (password.length < 8) {
            console.log('❌ Hasło musi mieć co najmniej 8 znaków');
            return;
        }
        
        // Hashowanie hasła
        const { hash, salt } = this.hashPassword(password);
        
        // Dane użytkownika
        const newUser = {
            id: randomBytes(16).toString('hex'),
            username: username,
            passwordHash: hash,
            salt: salt,
            role: role,
            email: email,
            active: true,
            createdAt: new Date().toISOString(),
            createdBy: 'cli',
            loginCount: 0,
            lastLogin: null
        };
        
        // Sprawdź czy użytkownik już istnieje
        const userKey = `USER:${username.toLowerCase()}`;
        const checkCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userKey}" --remote 2>&1`;
        
        try {
            execSync(checkCmd, { stdio: 'pipe' });
            console.log('❌ Użytkownik o tej nazwie już istnieje');
            return;
        } catch {
            // Użytkownik nie istnieje - OK
        }
        
        // Zapis do KV
        const createCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${userKey}" --value '${JSON.stringify(newUser)}' --remote`;
        
        try {
            execSync(createCmd, { stdio: 'pipe' });
            
            // Dodaj do listy użytkowników
            await this.addToUserList(newUser.id);
            
            console.log('✅ Użytkownik utworzony pomyślnie!');
            console.log(`   ID: ${newUser.id}`);
            console.log(`   Rola: ${role}`);
            
        } catch (error) {
            console.error('❌ Błąd tworzenia użytkownika:', error.message);
        }
    }

    async deleteUser(username) {
        console.log(`🗑️  Usuwanie użytkownika: ${username}`);
        
        // Znajdź użytkownika
        const userKey = `USER:${username.toLowerCase()}`;
        const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userKey}" --remote 2>&1`;
        
        try {
            const result = execSync(getCmd, { encoding: 'utf8' });
            const userData = JSON.parse(result.trim());
            
            // Potwierdzenie
            const readlineSync = require('readline-sync');
            const confirm = readlineSync.question(`Czy na pewno chcesz usunąć użytkownika "${username}"? (tak/nie): `);
            
            if (confirm.toLowerCase() !== 'tak') {
                console.log('❌ Anulowano');
                return;
            }
            
            // Usuń użytkownika
            const deleteCmd = `npx wrangler kv key delete --namespace-id=${this.kvId} "${userKey}" --remote`;
            execSync(deleteCmd, { stdio: 'pipe' });
            
            // Usuń z listy użytkowników
            await this.removeFromUserList(userData.id);
            
            console.log('✅ Użytkownik usunięty pomyślnie');
            
        } catch (error) {
            console.log('❌ Użytkownik nie istnieje lub błąd usuwania:', error.message);
        }
    }

    async addToUserList(userId) {
        const listKey = 'USERS:LIST';
        
        try {
            // Pobierz istniejącą listę
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${listKey}" --remote 2>&1`;
            let result;
            
            try {
                result = execSync(getCmd, { encoding: 'utf8' });
            } catch {
                result = '[]';
            }
            
            let userList;
            try {
                userList = JSON.parse(result.trim());
            } catch {
                userList = [];
            }
            
            // Dodaj nowe ID jeśli nie istnieje
            if (!userList.includes(userId)) {
                userList.push(userId);
                
                // Zapisz z powrotem
                const putCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${listKey}" --value '${JSON.stringify(userList)}' --remote`;
                execSync(putCmd, { stdio: 'pipe' });
            }
            
        } catch (error) {
            console.error('Błąd aktualizacji listy użytkowników:', error.message);
        }
    }

    async removeFromUserList(userId) {
        const listKey = 'USERS:LIST';
        
        try {
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${listKey}" --remote 2>&1`;
            let result;
            
            try {
                result = execSync(getCmd, { encoding: 'utf8' });
            } catch {
                return;
            }
            
            let userList;
            try {
                userList = JSON.parse(result.trim());
            } catch {
                return;
            }
            
            // Usuń ID
            userList = userList.filter(id => id !== userId);
            
            // Zapisz z powrotem
            const putCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${listKey}" --value '${JSON.stringify(userList)}' --remote`;
            execSync(putCmd, { stdio: 'pipe' });
            
        } catch (error) {
            console.error('Błąd aktualizacji listy użytkowników:', error.message);
        }
    }

    printHelp() {
        console.log(`
🎯 Menedżer użytkowników - HS Code Verifier

Użycie:
  node scripts/user-manager.js [polecenie] [argumenty]

Polecenia:
  list                          - Wyświetl listę wszystkich użytkowników
  create <username> <password> [role] [email]  - Utwórz nowego użytkownika
  delete <username>             - Usuń użytkownika
  help                          - Wyświetl tę pomoc

Przykłady:
  node scripts/user-manager.js list
  node scripts/user-manager.js create jan.kowalski "mojeHaslo123" user jan@firma.pl
  node scripts/user-manager.js create admin "Admin123!" admin admin@q4rail.com
  node scripts/user-manager.js delete test.user

Role: user, admin
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
                await this.listUsers();
                break;
                
            case 'create':
                if (args.length < 3) {
                    console.log('❌ Błąd: Brak nazwy użytkownika lub hasła');
                    this.printHelp();
                    return;
                }
                
                const username = args[1];
                const password = args[2];
                const role = args[3] || 'user';
                const email = args[4] || '';
                
                await this.createUser(username, password, role, email);
                break;
                
            case 'delete':
                if (args.length < 2) {
                    console.log('❌ Błąd: Brak nazwy użytkownika');
                    this.printHelp();
                    return;
                }
                
                await this.deleteUser(args[1]);
                break;
                
            default:
                console.log(`❌ Nieznane polecenie: ${command}`);
                this.printHelp();
        }
    }
}

// Uruchom skrypt
if (import.meta.url === `file://${process.argv[1]}`) {
    new UserManager().run().catch(console.error);
}