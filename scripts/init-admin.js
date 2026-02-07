#!/usr/bin/env node
/**
 * Skrypt inicjalizacji administratora systemu
 */

import { createHash, randomBytes } from 'crypto';
import { execSync } from 'child_process';
import readline from 'readline';

class AdminInitializer {
    constructor() {
        // Ustaw odpowiednie KV ID - sprawdź w backend/wrangler.toml
        // Domyślnie: d4e909bdc6114613ab76635fadb855b2 to ID dla HS_DATABASE
        // Potrzebujesz ID dla USERS_DB - sprawdź w Cloudflare Dashboard
        this.kvId = ""; // PUSTE - trzeba ustawić prawidłowe ID
    }

    async getKVId() {
        // Spróbuj pobrać ID z wrangler.toml lub zmiennych środowiskowych
        try {
            const fs = await import('fs');
            const tomlContent = fs.readFileSync('../backend/wrangler.toml', 'utf8');
            
            // Szukaj binding dla USERS_DB
            const usersDbMatch = tomlContent.match(/id\s*=\s*"([^"]+)"/g);
            if (usersDbMatch && usersDbMatch[1]) {
                // Drugie match to USERS_DB (po HS_DATABASE)
                const idMatch = usersDbMatch[1].match(/id\s*=\s*"([^"]+)"/);
                if (idMatch && idMatch[1]) {
                    return idMatch[1];
                }
            }
        } catch (error) {
            console.log('⚠️  Nie można odczytać wrangler.toml:', error.message);
        }
        
        // Zapytaj użytkownika o ID
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        return new Promise((resolve) => {
            rl.question('Podaj KV Namespace ID dla USERS_DB (z Cloudflare Dashboard): ', (answer) => {
                rl.close();
                resolve(answer.trim());
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

    async createAdminUser(username, password, email = '') {
        console.log('👑 Tworzenie konta administratora...');
        
        // Jeśli nie ma KV ID, pobierz je
        if (!this.kvId) {
            this.kvId = await this.getKVId();
            if (!this.kvId) {
                console.error('❌ Brak KV Namespace ID. Konfiguruj plik backend/wrangler.toml');
                process.exit(1);
            }
        }
        
        // Hashowanie hasła
        const { hash, salt } = this.hashPassword(password);
        
        // Generuj ID użytkownika
        const userId = randomBytes(16).toString('hex');
        
        // Dane użytkownika
        const adminUser = {
            id: userId,
            username: username,
            passwordHash: hash,
            salt: salt,
            role: 'admin',
            email: email,
            active: true,
            createdAt: new Date().toISOString(),
            createdBy: 'system',
            loginCount: 0,
            lastLogin: null
        };

        try {
            console.log(`📦 Zapisuję użytkownika do KV (ID: ${this.kvId})...`);
            
            // 1. Zapis użytkownika pod kluczem USER_BY_ID:userId
            const userByIdKey = `USER_BY_ID:${userId}`;
            const userByIdCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${userByIdKey}" --value '${JSON.stringify(adminUser)}' --remote`;
            execSync(userByIdCmd, { stdio: 'pipe' });
            
            // 2. Zapis użytkownika pod kluczem USER_BY_NAME:username (dla szybkiego wyszukiwania)
            const userByNameKey = `USER_BY_NAME:${username.toLowerCase()}`;
            const userByNameCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${userByNameKey}" --value '${JSON.stringify({ id: userId })}' --remote`;
            execSync(userByNameCmd, { stdio: 'pipe' });
            
            // 3. Dodaj do listy użytkowników
            await this.addToUserList(userId, username);
            
            console.log('\n✅ KONTO ADMINISTRATORA UTWORZONE!');
            console.log('='.repeat(50));
            console.log(`👤 Nazwa użytkownika: ${username}`);
            console.log(`🔑 Hasło: ${password}`);
            console.log(`🎯 Rola: Administrator`);
            console.log(`🆔 ID użytkownika: ${userId}`);
            console.log('='.repeat(50));
            console.log('\n⚠️  ZAPISZ TE DANE W BEZPIECZNYM MIEJSCU!');
            console.log('\n📋 Następne kroki:');
            console.log('1. Zaloguj się na: https://marius-sys.github.io/hs-code-ver/login.html');
            console.log('2. Sprawdź listę użytkowników: node scripts/user-manager.js list');
            
        } catch (error) {
            console.error('❌ Błąd tworzenia konta administratora:', error.message);
            if (error.stderr) {
                console.error('Szczegóły:', error.stderr.toString().substring(0, 200));
            }
            process.exit(1);
        }
    }

    async addToUserList(userId, username) {
        const listKey = 'USERS:LIST';
        
        try {
            // Pobierz istniejącą listę
            const getCmd = `npx wrangler kv key get --namespace-id=${this.kvId} "${listKey}" --remote 2>&1`;
            let result;
            
            try {
                result = execSync(getCmd, { encoding: 'utf8' });
                console.log(`📄 Lista użytkowników: ${result.substring(0, 100)}...`);
            } catch (error) {
                // Jeśli klucz nie istnieje, to OK
                console.log('ℹ️  Tworzę nową listę użytkowników...');
                result = '[]';
            }
            
            let userList;
            try {
                userList = JSON.parse(result.trim());
            } catch (e) {
                console.log('⚠️  Błąd parsowania listy, tworzę nową...');
                userList = [];
            }
            
            // Dodaj nowego użytkownika jeśli nie istnieje
            const userExists = userList.some(u => u.id === userId);
            if (!userExists) {
                userList.push({
                    id: userId,
                    username: username,
                    role: 'admin',
                    createdAt: new Date().toISOString()
                });
                
                // Zapisz z powrotem
                const putCmd = `npx wrangler kv key put --namespace-id=${this.kvId} "${listKey}" --value '${JSON.stringify(userList)}' --remote`;
                execSync(putCmd, { stdio: 'pipe' });
                console.log(`✅ Dodano użytkownika ${username} do listy`);
            } else {
                console.log(`ℹ️  Użytkownik ${username} już istnieje na liście`);
            }
            
        } catch (error) {
            console.error('⚠️  Błąd aktualizacji listy użytkowników:', error.message);
        }
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

    async run() {
        console.log('='.repeat(60));
        console.log('👑 INICJALIZACJA SYSTEMU UWIERZYTELNIANIA');
        console.log('='.repeat(60));
        
        // Najpierw pobierz KV ID
        this.kvId = await this.getKVId();
        if (!this.kvId) {
            console.log('❌ Musisz podać KV Namespace ID dla USERS_DB');
            console.log('\nJak uzyskać KV ID:');
            console.log('1. Wejdź na: https://dash.cloudflare.com');
            console.log('2. Workers & Pages → KV');
            console.log('3. Znajdź namespace "HS_USERS" (utworzony wcześniej)');
            console.log('4. Skopiuj Namespace ID');
            process.exit(1);
        }
        
        console.log(`✅ Używam KV Namespace ID: ${this.kvId}`);
        
        // Zapytaj o dane
        const username = await this.promptUser('Podaj nazwę użytkownika administratora: ');
        const password = await this.promptUser('Podaj hasło (min. 8 znaków): ');
        
        if (password.length < 8) {
            console.log('❌ Hasło musi mieć co najmniej 8 znaków');
            process.exit(1);
        }
        
        const email = await this.promptUser('Podaj adres e-mail (opcjonalnie): ');
        
        // Potwierdzenie
        console.log('\n📋 Podsumowanie:');
        console.log(`   Nazwa użytkownika: ${username}`);
        console.log(`   Hasło: ${'*'.repeat(password.length)}`);
        console.log(`   E-mail: ${email || 'brak'}`);
        console.log(`   KV Namespace ID: ${this.kvId}`);
        console.log('');
        
        const confirm = await this.promptUser('Czy kontynuować? (tak/nie): ');
        
        if (confirm.toLowerCase() === 'tak') {
            await this.createAdminUser(username, password, email);
        } else {
            console.log('❌ Anulowano tworzenie konta');
            process.exit(0);
        }
    }
}

// Uruchom skrypt
new AdminInitializer().run().catch(console.error);