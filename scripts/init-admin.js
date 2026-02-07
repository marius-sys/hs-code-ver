#!/usr/bin/env node
/**
 * Skrypt inicjalizacji administratora systemu
 */

import { createHash, randomBytes } from 'crypto';
import { execSync } from 'child_process';

class AdminInitializer {
    constructor() {
        this.kvId = "d4e909bdc6114613ab76635fadb855b2"; // ID namespace dla użytkowników
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
        
        // Hashowanie hasła
        const { hash, salt } = this.hashPassword(password);
        
        // Dane użytkownika
        const adminUser = {
            id: randomBytes(16).toString('hex'),
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

        // Zapis do KV
        const userKey = `USER:${username.toLowerCase()}`;
        const kvCommand = `npx wrangler kv key put --namespace-id=${this.kvId} "${userKey}" --value '${JSON.stringify(adminUser)}' --remote`;
        
        try {
            console.log('📦 Zapisuję użytkownika do KV...');
            execSync(kvCommand, { stdio: 'inherit' });
            
            // Dodaj do listy użytkowników
            await this.addToUserList(adminUser.id);
            
            console.log('\n✅ KONTO ADMINISTRATORA UTWORZONE!');
            console.log('='.repeat(50));
            console.log(`👤 Nazwa użytkownika: ${username}`);
            console.log(`🔑 Hasło: ${password}`);
            console.log(`🎯 Rola: Administrator`);
            console.log(`🆔 ID użytkownika: ${adminUser.id}`);
            console.log('='.repeat(50));
            console.log('\n⚠️  ZAPISZ TE DANE W BEZPIECZNYM MIEJSCU!');
            
        } catch (error) {
            console.error('❌ Błąd tworzenia konta administratora:', error.message);
            process.exit(1);
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
            } catch (error) {
                // Jeśli klucz nie istnieje, to OK
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

    async run() {
        console.log('='.repeat(60));
        console.log('👑 INICJALIZACJA SYSTEMU UWIERZYTELNIANIA');
        console.log('='.repeat(60));
        
        const readline = require('readline');
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        
        // Zapytaj o dane
        rl.question('Podaj nazwę użytkownika administratora: ', (username) => {
            rl.question('Podaj hasło (min. 8 znaków): ', (password) => {
                if (password.length < 8) {
                    console.log('❌ Hasło musi mieć co najmniej 8 znaków');
                    rl.close();
                    process.exit(1);
                }
                
                rl.question('Podaj adres e-mail (opcjonalnie): ', (email) => {
                    rl.close();
                    
                    // Potwierdzenie
                    console.log('\n📋 Podsumowanie:');
                    console.log(`   Nazwa użytkownika: ${username}`);
                    console.log(`   Hasło: ${'*'.repeat(password.length)}`);
                    console.log(`   E-mail: ${email || 'brak'}`);
                    console.log('');
                    
                    const confirm = require('readline-sync').question('Czy kontynuować? (tak/nie): ');
                    
                    if (confirm.toLowerCase() === 'tak') {
                        this.createAdminUser(username, password, email);
                    } else {
                        console.log('❌ Anulowano tworzenie konta');
                        process.exit(0);
                    }
                });
            });
        });
    }
}

// Uruchom skrypt
new AdminInitializer().run().catch(console.error);