/**
 * Moduł uwierzytelniania użytkowników
 */

import { createHash, createHmac, randomBytes } from 'crypto';

// Konfiguracja JWT
const JWT_SECRET = process.env.JWT_SECRET || 'default-secret-change-in-production';
const JWT_EXPIRY = '24h'; // Token ważny 24 godziny

export class AuthService {
    constructor(kvStorage) {
        this.kv = kvStorage;
    }

    // Hashowanie hasła z solą
    hashPassword(password, salt = randomBytes(16).toString('hex')) {
        const hash = createHash('sha256');
        hash.update(password + salt);
        return {
            hash: hash.digest('hex'),
            salt: salt
        };
    }

    // Weryfikacja hasła
    verifyPassword(password, storedHash, salt) {
        const { hash } = this.hashPassword(password, salt);
        return hash === storedHash;
    }

    // Generowanie JWT tokena
    generateToken(payload) {
        const header = {
            alg: 'HS256',
            typ: 'JWT'
        };

        const expires = new Date();
        expires.setHours(expires.getHours() + 24);
        
        const data = {
            ...payload,
            exp: Math.floor(expires.getTime() / 1000),
            iat: Math.floor(Date.now() / 1000)
        };

        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64').replace(/=/g, '');
        const encodedData = Buffer.from(JSON.stringify(data)).toString('base64').replace(/=/g, '');
        
        const signature = createHmac('sha256', JWT_SECRET)
            .update(`${encodedHeader}.${encodedData}`)
            .digest('hex');

        return `${encodedHeader}.${encodedData}.${signature}`;
    }

    // Weryfikacja JWT tokena
    verifyToken(token) {
        try {
            const [encodedHeader, encodedData, signature] = token.split('.');
            
            if (!encodedHeader || !encodedData || !signature) {
                return null;
            }

            // Sprawdzenie sygnatury
            const expectedSignature = createHmac('sha256', JWT_SECRET)
                .update(`${encodedHeader}.${encodedData}`)
                .digest('hex');

            if (signature !== expectedSignature) {
                return null;
            }

            const data = JSON.parse(Buffer.from(encodedData, 'base64').toString());
            
            // Sprawdzenie wygaśnięcia
            if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
                return null;
            }

            return data;
        } catch (error) {
            console.error('Błąd weryfikacji tokena:', error);
            return null;
        }
    }

    // Logowanie użytkownika
    async login(username, password) {
        try {
            console.log(`🔐 Próba logowania użytkownika: ${username}`);
            
            // 1. Znajdź mapowanie nazwa -> ID
            const nameKey = `USER_BY_NAME:${username.toLowerCase()}`;
            const mapping = await this.kv.get(nameKey, 'json');
            
            console.log(`📄 Mapowanie dla ${username}:`, mapping);
            
            if (!mapping || !mapping.id) {
                console.log(`❌ Brak mapowania dla użytkownika: ${username}`);
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // 2. Pobierz dane użytkownika
            const userKey = `USER_BY_ID:${mapping.id}`;
            const userData = await this.kv.get(userKey, 'json');
            
            console.log(`📄 Dane użytkownika ${username}:`, userData ? 'znalezione' : 'brak');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // 3. Weryfikacja hasła
            const isValid = this.verifyPassword(
                password,
                userData.passwordHash,
                userData.salt
            );

            if (!isValid) {
                console.log(`❌ Nieprawidłowe hasło dla użytkownika: ${username}`);
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // 4. Sprawdź czy konto jest aktywne
            if (!userData.active) {
                console.log(`❌ Konto nieaktywne: ${username}`);
                return {
                    success: false,
                    error: 'Konto jest nieaktywne'
                };
            }

            // 5. Aktualizacja ostatniego logowania
            userData.lastLogin = new Date().toISOString();
            userData.loginCount = (userData.loginCount || 0) + 1;
            
            await this.kv.put(userKey, JSON.stringify(userData));
            console.log(`✅ Zaktualizowano dane logowania dla: ${username}`);

            // 6. Generowanie tokena
            const token = this.generateToken({
                userId: userData.id,
                username: userData.username,
                role: userData.role,
                email: userData.email
            });

            console.log(`✅ Wygenerowano token dla: ${username}`);

            return {
                success: true,
                token,
                user: {
                    id: userData.id,
                    username: userData.username,
                    role: userData.role,
                    email: userData.email,
                    lastLogin: userData.lastLogin
                }
            };
            
        } catch (error) {
            console.error('❌ Błąd logowania:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas logowania'
            };
        }
    }

    // Weryfikacja tokena
    async authenticate(token) {
        console.log('🔍 Weryfikacja tokena...');
        const payload = this.verifyToken(token);
        
        if (!payload) {
            console.log('❌ Token nieprawidłowy lub wygasły');
            return null;
        }

        console.log(`✅ Token poprawny dla użytkownika: ${payload.username}`);
        
        // Sprawdzenie czy użytkownik nadal istnieje
        const userKey = `USER_BY_ID:${payload.userId}`;
        const userData = await this.kv.get(userKey, 'json');
        
        if (!userData || !userData.active) {
            console.log(`❌ Użytkownik nieaktywny lub nie istnieje: ${payload.userId}`);
            return null;
        }

        console.log(`✅ Użytkownik aktywny: ${userData.username}`);
        
        return {
            ...payload,
            userData
        };
    }

    // Rejestracja nowego użytkownika (tylko admin)
    async registerUser(userData, createdBy) {
        try {
            const { username, password, role = 'user', email } = userData;
            
            console.log(`📝 Rejestracja nowego użytkownika: ${username}`);
            
            // Walidacja
            if (!username || !password) {
                return {
                    success: false,
                    error: 'Nazwa użytkownika i hasło są wymagane'
                };
            }

            // Sprawdzenie czy użytkownik już istnieje
            const existingKey = `USER_BY_NAME:${username.toLowerCase()}`;
            const existingUser = await this.kv.get(existingKey, 'json');
            
            if (existingUser) {
                return {
                    success: false,
                    error: 'Użytkownik o tej nazwie już istnieje'
                };
            }

            // Hashowanie hasła
            const { hash, salt } = this.hashPassword(password);
            
            // Generuj ID użytkownika
            const userId = randomBytes(16).toString('hex');
            
            // Tworzenie nowego użytkownika
            const newUser = {
                id: userId,
                username: username,
                passwordHash: hash,
                salt: salt,
                role: role,
                email: email || '',
                active: true,
                createdAt: new Date().toISOString(),
                createdBy: createdBy,
                loginCount: 0,
                lastLogin: null
            };

            // Zapis użytkownika
            await this.kv.put(`USER_BY_ID:${userId}`, JSON.stringify(newUser));
            await this.kv.put(`USER_BY_NAME:${username.toLowerCase()}`, JSON.stringify({ id: userId }));
            
            console.log(`✅ Zarejestrowano użytkownika: ${username} (ID: ${userId})`);

            return {
                success: true,
                user: {
                    id: newUser.id,
                    username: newUser.username,
                    role: newUser.role,
                    email: newUser.email,
                    createdAt: newUser.createdAt
                }
            };
        } catch (error) {
            console.error('❌ Błąd rejestracji użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas tworzenia użytkownika'
            };
        }
    }

    // Zmiana hasła
    async changePassword(userId, currentPassword, newPassword) {
        try {
            console.log(`🔑 Próba zmiany hasła dla użytkownika: ${userId}`);
            
            // Pobierz użytkownika
            const userKey = `USER_BY_ID:${userId}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Użytkownik nie istnieje'
                };
            }

            // Sprawdź aktualne hasło
            const isValid = this.verifyPassword(
                currentPassword,
                userData.passwordHash,
                userData.salt
            );

            if (!isValid) {
                return {
                    success: false,
                    error: 'Nieprawidłowe aktualne hasło'
                };
            }

            // Hashuj nowe hasło
            const { hash, salt } = this.hashPassword(newPassword);
            
            // Zaktualizuj użytkownika
            userData.passwordHash = hash;
            userData.salt = salt;
            userData.updatedAt = new Date().toISOString();
            
            await this.kv.put(userKey, JSON.stringify(userData));
            
            console.log(`✅ Hasło zmienione dla użytkownika: ${userId}`);
            
            return {
                success: true,
                message: 'Hasło zostało zmienione'
            };
        } catch (error) {
            console.error('❌ Błąd zmiany hasła:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas zmiany hasła'
            };
        }
    }

    // Logowanie aktywności
    async logActivity(activity) {
        try {
            if (!this.kv) {
                console.warn('⚠️ Brak KV dla logów');
                return;
            }
            
            const timestamp = new Date().toISOString();
            const logKey = `LOG:${timestamp}:${activity.userId}:${activity.action}`;
            
            await this.kv.put(logKey, JSON.stringify({
                ...activity,
                timestamp
            }));
            
            console.log(`📝 Zapisano log: ${activity.action} dla użytkownika ${activity.userId}`);
        } catch (error) {
            console.error('❌ Błąd logowania aktywności:', error);
        }
    }
}

export default AuthService;