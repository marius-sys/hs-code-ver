/**
 * Zarządzanie użytkownikami
 */

export class UserService {
    constructor(kvStorage) {
        this.kv = kvStorage;
    }

    // Pobierz wszystkich użytkowników (z listy)
    async getAllUsers() {
        try {
            console.log('📋 Pobieranie listy użytkowników...');
            
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                console.log('ℹ️  Brak listy użytkowników - zwracam pustą tablicę');
                return {
                    success: true,
                    users: []
                };
            }

            console.log(`✅ Znaleziono ${usersList.length} użytkowników w liście`);
            
            // Pobierz dane każdego użytkownika
            const users = [];
            for (const userListItem of usersList) {
                const userKey = `USER_BY_ID:${userListItem.id}`;
                const userData = await this.kv.get(userKey, 'json');
                
                if (userData) {
                    users.push({
                        id: userData.id,
                        username: userData.username,
                        role: userData.role,
                        email: userData.email,
                        active: userData.active,
                        createdAt: userData.createdAt,
                        createdBy: userData.createdBy,
                        lastLogin: userData.lastLogin,
                        loginCount: userData.loginCount
                    });
                } else {
                    // Jeśli nie ma danych użytkownika, użyj podstawowych z listy
                    console.log(`⚠️  Brak pełnych danych dla użytkownika ID: ${userListItem.id}`);
                    users.push({
                        id: userListItem.id,
                        username: userListItem.username,
                        role: userListItem.role,
                        email: '',
                        active: true,
                        createdAt: userListItem.createdAt,
                        createdBy: 'unknown',
                        lastLogin: null,
                        loginCount: 0
                    });
                }
            }

            return {
                success: true,
                users: users
            };
        } catch (error) {
            console.error('❌ Błąd pobierania użytkowników:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania użytkowników'
            };
        }
    }

    // Pobierz dane użytkownika po ID
    async getUser(userId) {
        try {
            console.log(`🔍 Pobieranie użytkownika ID: ${userId}`);
            
            const userKey = `USER_BY_ID:${userId}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                console.log(`❌ Nie znaleziono użytkownika ID: ${userId}`);
                return {
                    success: false,
                    error: 'Użytkownik nie znaleziony'
                };
            }

            console.log(`✅ Znaleziono użytkownika: ${userData.username}`);
            
            return {
                success: true,
                user: {
                    id: userData.id,
                    username: userData.username,
                    role: userData.role,
                    email: userData.email,
                    active: userData.active,
                    createdAt: userData.createdAt,
                    createdBy: userData.createdBy,
                    lastLogin: userData.lastLogin,
                    loginCount: userData.loginCount
                }
            };
        } catch (error) {
            console.error('❌ Błąd pobierania użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania danych użytkownika'
            };
        }
    }

    // Pobierz użytkownika po nazwie (case-insensitive)
    async getUserByUsername(username) {
        try {
            const normalizedUsername = username.toLowerCase();
            console.log(`🔍 Szukanie użytkownika: ${username} (znormalizowane: ${normalizedUsername})`);
            
            const userMappingKey = `USER_BY_NAME:${normalizedUsername}`;
            const userMapping = await this.kv.get(userMappingKey, 'json');
            
            if (!userMapping || !userMapping.id) {
                console.log(`❌ Nie znaleziono mapowania dla: ${normalizedUsername}`);
                return {
                    success: false,
                    error: 'Użytkownik nie znaleziony'
                };
            }

            console.log(`✅ Znaleziono mapowanie -> ID: ${userMapping.id}`);
            
            // Pobierz pełne dane użytkownika
            return await this.getUser(userMapping.id);
        } catch (error) {
            console.error('❌ Błąd pobierania użytkownika po nazwie:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania danych użytkownika'
            };
        }
    }

    // Aktualizacja użytkownika
    async updateUser(userId, updates, updatedBy) {
        try {
            const userKey = `USER_BY_ID:${userId}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Użytkownik nie znaleziony'
                };
            }

            // Aktualizacja danych
            const updatedUser = {
                ...userData,
                ...updates,
                updatedAt: new Date().toISOString(),
                updatedBy: updatedBy
            };

            await this.kv.put(userKey, JSON.stringify(updatedUser));

            // Jeśli zmieniono nazwę użytkownika, zaktualizuj mapowanie
            if (updates.username && updates.username !== userData.username) {
                console.log(`🔄 Aktualizacja nazwy użytkownika: ${userData.username} -> ${updates.username}`);
                
                // Usuń stare mapowanie
                const oldNormalizedUsername = userData.username.toLowerCase();
                const oldMappingKey = `USER_BY_NAME:${oldNormalizedUsername}`;
                await this.kv.delete(oldMappingKey);
                console.log(`   ✅ Usunięto stare mapowanie: ${oldMappingKey}`);
                
                // Dodaj nowe mapowanie
                const newNormalizedUsername = updates.username.toLowerCase();
                const newMappingKey = `USER_BY_NAME:${newNormalizedUsername}`;
                await this.kv.put(newMappingKey, JSON.stringify({
                    id: userId,
                    username: newNormalizedUsername
                }));
                console.log(`   ✅ Dodano nowe mapowanie: ${newMappingKey}`);
                
                // Zaktualizuj listę użytkowników
                await this.updateUserInList(userId, { username: updates.username });
            }

            return {
                success: true,
                user: updatedUser
            };
        } catch (error) {
            console.error('❌ Błąd aktualizacji użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas aktualizacji użytkownika'
            };
        }
    }

    // Usuń użytkownika
    async deleteUser(userId, deletedBy) {
        try {
            const userKey = `USER_BY_ID:${userId}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Użytkownik nie znaleziony'
                };
            }

            // Nie pozwól usunąć samego siebie
            if (userId === deletedBy) {
                return {
                    success: false,
                    error: 'Nie możesz usunąć własnego konta'
                };
            }

            console.log(`🗑️  Usuwanie użytkownika: ${userData.username} (ID: ${userId})`);
            
            // 1. Usuń mapowanie nazwa -> ID
            const normalizedUsername = userData.username.toLowerCase();
            const userMappingKey = `USER_BY_NAME:${normalizedUsername}`;
            await this.kv.delete(userMappingKey);
            console.log(`   ✅ Usunięto mapowanie: ${userMappingKey}`);
            
            // 2. Usuń dane użytkownika
            await this.kv.delete(userKey);
            console.log(`   ✅ Usunięto dane użytkownika: ${userKey}`);
            
            // 3. Usuń z listy użytkowników
            await this.removeFromUserList(userId);
            console.log(`   ✅ Usunięto z listy użytkowników`);

            return {
                success: true,
                message: `Użytkownik ${userData.username} został usunięty`
            };
        } catch (error) {
            console.error('❌ Błąd usuwania użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas usuwania użytkownika'
            };
        }
    }

    // Aktualizuj użytkownika w liście
    async updateUserInList(userId, updates) {
        try {
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                return;
            }
            
            const userIndex = usersList.findIndex(u => u.id === userId);
            if (userIndex !== -1) {
                usersList[userIndex] = {
                    ...usersList[userIndex],
                    ...updates
                };
                
                await this.kv.put(usersListKey, JSON.stringify(usersList));
                console.log(`✅ Zaktualizowano użytkownika w liście`);
            }
        } catch (error) {
            console.error('⚠️  Błąd aktualizacji listy użytkowników:', error);
        }
    }

    // Usuń użytkownika z listy
    async removeFromUserList(userId) {
        try {
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                return;
            }
            
            const initialLength = usersList.length;
            usersList = usersList.filter(u => u.id !== userId);
            
            if (usersList.length < initialLength) {
                await this.kv.put(usersListKey, JSON.stringify(usersList));
                console.log(`✅ Usunięto użytkownika z listy (teraz ${usersList.length})`);
            }
        } catch (error) {
            console.error('⚠️  Błąd usuwania z listy użytkowników:', error);
        }
    }

    // Pobierz statystyki użytkownika
    async getUserStats(userId) {
        try {
            // W przyszłości można dodać zliczanie wyszukiwań itp.
            return {
                success: true,
                stats: {
                    totalSearches: 0,
                    todaySearches: 0,
                    lastSearch: null
                }
            };
        } catch (error) {
            console.error('Błąd pobierania statystyk użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania statystyk'
            };
        }
    }

    // Logowanie aktywności
    async logActivity(userId, action, details) {
        try {
            const timestamp = new Date().toISOString();
            const logKey = `ACTIVITY:${timestamp}:${userId}`;
            
            await this.kv.put(logKey, JSON.stringify({
                userId,
                action,
                details,
                timestamp
            }));
        } catch (error) {
            console.error('Błąd logowania aktywności:', error);
        }
    }
}

export default UserService;