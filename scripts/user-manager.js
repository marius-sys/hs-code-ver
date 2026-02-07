#!/usr/bin/env node
/**
 * Skrypt do zarządzania użytkownikami (CLI)
 */

import { createHash, randomBytes } from 'crypto';
import { execSync } from 'child_process';
import readline from 'readline';
import fs from 'fs';

class UserManager {
    constructor() {
        this.kvId = null;
    }

    async getKVId() {
        if (this.kvId) return this.kvId;
        
        // Spróbuj pobrać ID z wrangler.toml
        try {
            const tomlContent = fs.readFileSync('../backend/wrangler.toml', 'utf8');
            
            // Szukaj binding dla USERS_DB
            const lines = tomlContent.split('\n');
            let foundUsersDb = false;
            
            for (const line of lines) {
                if (line.includes('USERS_DB')) {
                    foundUsersDb = true;
                }
                if (foundUsersDb && line.includes('id =')) {
                    const match = line.match(/id\s*=\s*"([^"]+)"/);
                    if (match && match[1]) {
                        return match[1];
                    }
                }
            }
        } catch (error) {
            console.log('⚠️  Nie można odczytać wrangler.toml:', error.message);
        }
        
        // Zapytaj użytkownika
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('Podaj KV Namespace ID dla USERS_DB: ', (answer) => {
                rl.close();
                resolve(answer.trim());
            });
        });
    }

    async promptUser(question) {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question(question, (answer) => {
                rl.close();
                resolve(answer);
            });
        });
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
        
        // Pobierz KV ID
        this.kvId = await this.getKVId();
        if (!this.kvId) {
            console.log('❌ Brak KV Namespace ID');
            return;
        }
        
        try {
            // 1. Pobierz listę użytkowników
            const listKey = 'USERS:LIST';
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${listKey}" --remote 2>&1`;
            
            let result;
            try {
                result = execSync(getCmd, { encoding: 'utf8' });
                console.log('📄 Odczytano listę użytkowników');
            } catch (error) {
                console.log('❌ Brak zarejestrowanych użytkowników');
                console.log('Szczegóły:', error.message);
                return;
            }
            
            let userList;
            try {
                userList = JSON.parse(result.trim());
                console.log(`Znaleziono ${userList.length} użytkowników`);
            } catch (e) {
                console.log('❌ Błąd parsowania listy użytkowników:', e.message);
                console.log('Odpowiedź:', result.substring(0, 200));
                return;
            }
            
            if (!userList || userList.length === 0) {
                console.log('❌ Brak zarejestrowanych użytkowników');
                return;
            }
            
            // 2. Pobierz szczegóły każdego użytkownika
            for (const user of userList) {
                const userKey = `USER_BY_ID:${user.id}`;
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
                    console.log(`❌ Błąd pobierania użytkownika ${user.id}: ${error.message}`);
                    // Wyświetl przynajmniej podstawowe dane z listy
                    console.log(`👤 ${user.username} (${user.role})`);
                    console.log(`   ID: ${user.id}`);
                    console.log(`   Utworzono: ${user.createdAt}`);
                    console.log('---');
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
        
        // Pobierz KV ID
        this.kvId = await this.getKVId();
        if (!this.kvId) {
            console.log('❌ Brak KV Namespace ID');
            return;
        }
        
        // Hashowanie hasła
        const { hash, salt } = this.hashPassword(password);
        
        // Generuj ID użytkownika
        const userId = randomBytes(16).toString('hex');
        
        // Dane użytkownika
        const newUser = {
            id: userId,
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
        
        try {
            console.log(`📦 Używam KV ID: ${this.kvId}`);
            
            // 1. Sprawdź czy użytkownik już istnieje (po nazwie)
            const userByNameKey = `USER_BY_NAME:${username.toLowerCase()}`;
            const checkCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userByNameKey}" --remote 2>&1`;
            
            try {
                execSync(checkCmd, { stdio: 'pipe' });
                console.log('❌ Użytkownik o tej nazwie już istnieje');
                return;
            } catch {
                // Użytkownik nie istnieje - OK
            }
            
            // 2. Zapisz użytkownika pod kluczem USER_BY_ID
            const userByIdKey = `USER_BY_ID:${userId}`;
            const createByIdCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${userByIdKey}" --value '${JSON.stringify(newUser)}' --remote`;
            execSync(createByIdCmd, { stdio: 'pipe' });
            
            // 3. Zapisz mapowanie nazwa -> ID
            const createByNameCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${userByNameKey}" --value '${JSON.stringify({ id: userId })}' --remote`;
            execSync(createByNameCmd, { stdio: 'pipe' });
            
            // 4. Dodaj do listy użytkowników
            await this.addToUserList(userId, username, role);
            
            console.log('✅ Użytkownik utworzony pomyślnie!');
            console.log(`   ID: ${userId}`);
            console.log(`   Rola: ${role}`);
            
        } catch (error) {
            console.error('❌ Błąd tworzenia użytkownika:', error.message);
            if (error.stderr) {
                console.error('Szczegóły:', error.stderr.toString().substring(0, 200));
            }
        }
    }

    async deleteUser(username) {
        console.log(`🗑️  Usuwanie użytkownika: ${username}`);
        
        // Pobierz KV ID
        this.kvId = await this.getKVId();
        if (!this.kvId) {
            console.log('❌ Brak KV Namespace ID');
            return;
        }
        
        try {
            // 1. Znajdź użytkownika po nazwie
            const userByNameKey = `USER_BY_NAME:${username.toLowerCase()}`;
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userByNameKey}" --remote 2>&1`;
            
            let userId;
            try {
                const result = execSync(getCmd, { encoding: 'utf8' });
                const mapping = JSON.parse(result.trim());
                userId = mapping.id;
            } catch (error) {
                console.log('❌ Użytkownik nie istnieje');
                return;
            }
            
            if (!userId) {
                console.log('❌ Nie można znaleźć ID użytkownika');
                return;
            }
            
            // 2. Pobierz dane użytkownika do wyświetlenia
            const userByIdKey = `USER_BY_ID:${userId}`;
            const getUserCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${userByIdKey}" --remote 2>&1`;
            
            let userData;
            try {
                const result = execSync(getUserCmd, { encoding: 'utf8' });
                userData = JSON.parse(result.trim());
            } catch (error) {
                userData = { username: username, role: 'unknown' };
            }
            
            // 3. Potwierdzenie
            const confirm = await this.promptUser(`Czy na pewno chcesz usunąć użytkownika "${username}" (${userData.role})? (tak/nie): `);
            
            if (confirm.toLowerCase() !== 'tak') {
                console.log('❌ Anulowano');
                return;
            }
            
            // 4. Usuń użytkownika z wszystkich miejsc
            console.log('🗑️  Usuwam użytkownika...');
            
            // a) Usuń mapowanie nazwa -> ID
            const deleteByNameCmd = `npx wrangler kv key delete --namespace-id=${this.kvId} "${userByNameKey}" --remote`;
            execSync(deleteByNameCmd, { stdio: 'pipe' });
            
            // b) Usuń dane użytkownika
            const deleteByIdCmd = `npx wrangler kv key delete --namespace-id=${this.kvId} "${userByIdKey}" --remote`;
            execSync(deleteByIdCmd, { stdio: 'pipe' });
            
            // c) Usuń z listy użytkowników
            await this.removeFromUserList(userId);
            
            console.log('✅ Użytkownik usunięty pomyślnie');
            
        } catch (error) {
            console.log('❌ Błąd usuwania użytkownika:', error.message);
        }
    }

    async addToUserList(userId, username, role = 'user') {
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
            
            // Dodaj nowego użytkownika jeśli nie istnieje
            const userExists = userList.some(u => u.id === userId);
            if (!userExists) {
                userList.push({
                    id: userId,
                    username: username,
                    role: role,
                    createdAt: new Date().toISOString()
                });
                
                // Zapisz z powrotem
                const putCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${listKey}" --value '${JSON.stringify(userList)}' --remote`;
                execSync(putCmd, { stdio: 'pipe' });
            }
            
        } catch (error) {
            console.error('⚠️  Błąd aktualizacji listy użytkowników:', error.message);
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
            
            // Usuń użytkownika
            userList = userList.filter(u => u.id !== userId);
            
            // Zapisz z powrotem
            const putCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${listKey}" --value '${JSON.stringify(userList)}' --remote`;
            execSync(putCmd, { stdio: 'pipe' });
            
        } catch (error) {
            console.error('⚠️  Błąd aktualizacji listy użytkowników:', error.message);
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
  node scripts/user-manager.js create admin2 "Admin456!" admin admin2@q4rail.com
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