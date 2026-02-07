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

        // Używamy Buffer zamiast btoa dla kompatybilności Node.js
        const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
        const encodedData = Buffer.from(JSON.stringify(data)).toString('base64url');
        
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

            const data = JSON.parse(Buffer.from(encodedData, 'base64url').toString());
            
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

    // Logowanie użytkownika (case-insensitive)
    async login(username, password) {
        try {
            // Konwertuj nazwę użytkownika na małe litery dla wyszukiwania
            const normalizedUsername = username.toLowerCase();
            
            console.log(`🔑 Próba logowania: ${username} (znormalizowane: ${normalizedUsername})`);
            
            // 1. Znajdź mapowanie nazwa -> ID
            const userMappingKey = `USER_BY_NAME:${normalizedUsername}`;
            console.log(`   Szukam klucza: ${userMappingKey}`);
            
            const userMapping = await this.kv.get(userMappingKey, 'json');
            
            if (!userMapping || !userMapping.id) {
                console.log(`   ❌ Brak mapowania dla użytkownika: ${normalizedUsername}`);
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }
            
            console.log(`   ✅ Znaleziono ID użytkownika: ${userMapping.id}`);

            // 2. Pobierz dane użytkownika po ID
            const userDataKey = `USER_BY_ID:${userMapping.id}`;
            const userData = await this.kv.get(userDataKey, 'json');
            
            if (!userData) {
                console.log(`   ❌ Brak danych użytkownika dla ID: ${userMapping.id}`);
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            console.log(`   ✅ Znaleziono dane użytkownika: ${userData.username}`);

            // 3. Weryfikacja hasła
            const isValid = this.verifyPassword(
                password,
                userData.passwordHash,
                userData.salt
            );

            if (!isValid) {
                console.log(`   ❌ Nieprawidłowe hasło dla użytkownika: ${userData.username}`);
                return {
                    success: false,
                    error: 'Nieprawidłowa nazwa użytkownika lub hasło'
                };
            }

            // 4. Sprawdzenie czy konto jest aktywne
            if (!userData.active) {
                console.log(`   ❌ Konto nieaktywne: ${userData.username}`);
                return {
                    success: false,
                    error: 'Konto jest nieaktywne'
                };
            }

            // 5. Aktualizacja ostatniego logowania
            userData.lastLogin = new Date().toISOString();
            userData.loginCount = (userData.loginCount || 0) + 1;
            
            await this.kv.put(userDataKey, JSON.stringify(userData));
            console.log(`   ✅ Zaktualizowano dane logowania dla: ${userData.username}`);

            // 6. Generowanie tokena
            const token = this.generateToken({
                userId: userData.id,
                username: userData.username,
                role: userData.role,
                email: userData.email
            });

            console.log(`   ✅ Wygenerowano token JWT`);

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
        const payload = this.verifyToken(token);
        
        if (!payload) {
            return null;
        }

        // Sprawdzenie czy użytkownik nadal istnieje
        const userDataKey = `USER_BY_ID:${payload.userId}`;
        const userData = await this.kv.get(userDataKey, 'json');
        
        if (!userData || !userData.active) {
            return null;
        }

        return {
            ...payload,
            userData
        };
    }

    // Rejestracja nowego użytkownika (tylko admin) - case-insensitive
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

            // Normalizacja nazwy użytkownika
            const normalizedUsername = username.toLowerCase();
            
            // Sprawdzenie czy użytkownik już istnieje (po znormalizowanej nazwie)
            const existingMappingKey = `USER_BY_NAME:${normalizedUsername}`;
            const existingMapping = await this.kv.get(existingMappingKey, 'json');
            
            if (existingMapping && existingMapping.id) {
                console.log(`ℹ️  Użytkownik ${normalizedUsername} już istnieje w mapowaniu`);
                
                // Sprawdź czy użytkownik faktycznie istnieje
                const userDataKey = `USER_BY_ID:${existingMapping.id}`;
                const existingUser = await this.kv.get(userDataKey, 'json');
                
                if (existingUser) {
                    return {
                        success: false,
                        error: 'Użytkownik o tej nazwie już istnieje'
                    };
                }
            }

            console.log(`✅ Nazwa użytkownika ${username} jest dostępna`);

            // Hashowanie hasła
            const { hash, salt } = this.hashPassword(password);
            
            // Generowanie ID użytkownika
            const userId = randomBytes(16).toString('hex');
            
            // Tworzenie nowego użytkownika
            const newUser = {
                id: userId,
                username: username, // Zachowujemy oryginalną wielkość liter w danych
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

            console.log(`📦 Tworzę użytkownika: ${username} (ID: ${userId})`);

            // Zapis użytkownika
            // 1. Zapis danych użytkownika
            const userDataKey = `USER_BY_ID:${userId}`;
            await this.kv.put(userDataKey, JSON.stringify(newUser));
            console.log(`   ✅ Zapisano dane użytkownika pod kluczem: ${userDataKey}`);
            
            // 2. Zapis mapowania nazwa -> ID (zawsze małe litery)
            await this.kv.put(existingMappingKey, JSON.stringify({
                id: userId,
                username: normalizedUsername
            }));
            console.log(`   ✅ Zapisano mapowanie pod kluczem: ${existingMappingKey}`);

            // 3. Dodanie do listy użytkowników
            await this.addToUserList(userId, username, role);
            console.log(`   ✅ Dodano użytkownika do listy`);

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

    // Dodanie użytkownika do listy
    async addToUserList(userId, username, role) {
        try {
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                usersList = [];
            }

            // Sprawdź czy użytkownik już jest na liście
            const userExists = usersList.some(u => u.id === userId);
            if (!userExists) {
                usersList.push({
                    id: userId,
                    username: username,
                    role: role,
                    createdAt: new Date().toISOString()
                });
                
                await this.kv.put(usersListKey, JSON.stringify(usersList));
                console.log(`   ✅ Zaktualizowano listę użytkowników (teraz ${usersList.length})`);
            }
        } catch (error) {
            console.error('⚠️  Błąd dodawania do listy użytkowników:', error);
        }
    }

    // Zmiana hasła
    async changePassword(userId, currentPassword, newPassword) {
        try {
            // Pobierz użytkownika
            const userDataKey = `USER_BY_ID:${userId}`;
            const userData = await this.kv.get(userDataKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Użytkownik nie istnieje'
                };
            }

            // Weryfikacja obecnego hasła
            const isCurrentValid = this.verifyPassword(
                currentPassword,
                userData.passwordHash,
                userData.salt
            );

            if (!isCurrentValid) {
                return {
                    success: false,
                    error: 'Nieprawidłowe obecne hasło'
                };
            }

            // Hashowanie nowego hasła
            const { hash, salt } = this.hashPassword(newPassword);
            
            // Aktualizacja danych użytkownika
            userData.passwordHash = hash;
            userData.salt = salt;
            userData.updatedAt = new Date().toISOString();
            
            await this.kv.put(userDataKey, JSON.stringify(userData));

            return {
                success: true,
                message: 'Hasło zostało zmienione'
            };
        } catch (error) {
            console.error('Błąd zmiany hasła:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas zmiany hasła'
            };
        }
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
        } catch (error) {
            console.error('Błąd logowania aktywności:', error);
        }
    }
}

export default AuthService;