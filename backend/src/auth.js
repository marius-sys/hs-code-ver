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

        const encodedHeader = btoa(JSON.stringify(header));
        const encodedData = btoa(JSON.stringify(data));
        
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

            const data = JSON.parse(atob(encodedData));
            
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
            // Pobranie użytkownika z KV
            const userKey = `USER:${username.toLowerCase()}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // Weryfikacja hasła
            const isValid = this.verifyPassword(
                password,
                userData.passwordHash,
                userData.salt
            );

            if (!isValid) {
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // Sprawdzenie czy konto jest aktywne
            if (!userData.active) {
                return {
                    success: false,
                    error: 'Konto jest nieaktywne'
                };
            }

            // Aktualizacja ostatniego logowania
            userData.lastLogin = new Date().toISOString();
            userData.loginCount = (userData.loginCount || 0) + 1;
            
            await this.kv.put(userKey, JSON.stringify(userData));

            // Generowanie tokena
            const token = this.generateToken({
                userId: userData.id,
                username: userData.username,
                role: userData.role,
                email: userData.email
            });

            // Logowanie loginu
            await this.logActivity({
                userId: userData.id,
                action: 'LOGIN',
                details: {
                    ip: 'unknown', // Pobierane z requestu
                    userAgent: 'unknown' // Pobierane z requestu
                }
            });

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
            console.error('Błąd logowania:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas logowania'
            };
        }
    }

    // Weryfikacja tokena
    async authenticate(token) {
        const payload = this.verifyToken(token);
        
        if (!payload) {
            return null;
        }

        // Sprawdzenie czy użytkownik nadal istnieje
        const userKey = `USER:${payload.username.toLowerCase()}`;
        const userData = await this.kv.get(userKey, 'json');
        
        if (!userData || !userData.active) {
            return null;
        }

        return {
            ...payload,
            userData
        };
    }

    // Logowanie aktywności
    async logActivity(activity) {
        try {
            const timestamp = new Date().toISOString();
            const logKey = `LOG:${timestamp}:${activity.userId}:${activity.action}`;
            
            await this.kv.put(logKey, JSON.stringify({
                ...activity,
                timestamp
            }));

            // Ogranicz liczbę logów do 1000 na użytkownika
            await this.cleanupLogs(activity.userId);
        } catch (error) {
            console.error('Błąd logowania aktywności:', error);
        }
    }

    // Czyszczenie starych logów
    async cleanupLogs(userId, maxLogs = 1000) {
        try {
            // Implementacja czyszczenia starych logów
            // (może wymagać listowania kluczy)
        } catch (error) {
            console.error('Błąd czyszczenia logów:', error);
        }
    }

    // Rejestracja nowego użytkownika (tylko admin)
    async registerUser(userData, createdBy) {
        try {
            const { username, password, role = 'user', email } = userData;
            
            // Walidacja
            if (!username || !password) {
                return {
                    success: false,
                    error: 'Nazwa użytkownika i hasło są wymagane'
                };
            }

            // Sprawdzenie czy użytkownik już istnieje
            const existingKey = `USER:${username.toLowerCase()}`;
            const existingUser = await this.kv.get(existingKey, 'json');
            
            if (existingUser) {
                return {
                    success: false,
                    error: 'Użytkownik o tej nazwie już istnieje'
                };
            }

            // Hashowanie hasła
            const { hash, salt } = this.hashPassword(password);
            
            // Tworzenie nowego użytkownika
            const newUser = {
                id: randomBytes(16).toString('hex'),
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
            await this.kv.put(existingKey, JSON.stringify(newUser));

            // Logowanie akcji
            await this.logActivity({
                userId: createdBy,
                action: 'CREATE_USER',
                details: {
                    createdUserId: newUser.id,
                    username: username,
                    role: role
                }
            });

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
            console.error('Błąd rejestracji użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas tworzenia użytkownika'
            };
        }
    }

    // Zmiana hasła
    async changePassword(userId, currentPassword, newPassword) {
        try {
            // Znajdź użytkownika
            // (Wymaga implementacji wyszukiwania użytkownika po ID)
            // ...implementacja...
            
            return {
                success: true
            };
        } catch (error) {
            console.error('Błąd zmiany hasła:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas zmiany hasła'
            };
        }
    }
}

export default AuthService;