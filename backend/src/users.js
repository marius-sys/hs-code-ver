/**
 * Zarządzanie użytkownikami
 */

export class UserService {
    constructor(kvStorage) {
        this.kv = kvStorage;
    }

    // Pobierz wszystkich użytkowników
    async getAllUsers() {
        try {
            // Listowanie wszystkich kluczy użytkowników
            // Uwaga: W Cloudflare KV nie ma natywnego listowania wszystkich kluczy
            // Możemy użyć prefiksu lub przechowywać listę użytkowników w oddzielnym kluczu
            
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                usersList = [];
            }

            // Pobranie danych każdego użytkownika
            const users = [];
            for (const userId of usersList) {
                const userKey = `USER:${userId}`;
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
                }
            }

            return {
                success: true,
                users: users
            };
        } catch (error) {
            console.error('Błąd pobierania użytkowników:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania użytkowników'
            };
        }
    }

    // Pobierz dane użytkownika
    async getUser(userId) {
        try {
            const userKey = `USER:${userId}`;
            const userData = await this.kv.get(userKey, 'json');
            
            if (!userData) {
                return {
                    success: false,
                    error: 'Użytkownik nie znaleziony'
                };
            }

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
            console.error('Błąd pobierania użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania danych użytkownika'
            };
        }
    }

    // Aktualizacja użytkownika
    async updateUser(userId, updates, updatedBy) {
        try {
            const userKey = `USER:${userId}`;
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

            // Logowanie akcji
            await this.logActivity(updatedBy, 'UPDATE_USER', {
                userId: userId,
                updates: updates
            });

            return {
                success: true,
                user: updatedUser
            };
        } catch (error) {
            console.error('Błąd aktualizacji użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas aktualizacji użytkownika'
            };
        }
    }

    // Usuń użytkownika
    async deleteUser(userId, deletedBy) {
        try {
            const userKey = `USER:${userId}`;
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

            // Usunięcie użytkownika
            await this.kv.delete(userKey);

            // Aktualizacja listy użytkowników
            await this.removeFromUserList(userId);

            // Logowanie akcji
            await this.logActivity(deletedBy, 'DELETE_USER', {
                userId: userId,
                username: userData.username
            });

            return {
                success: true,
                message: `Użytkownik ${userData.username} został usunięty`
            };
        } catch (error) {
            console.error('Błąd usuwania użytkownika:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas usuwania użytkownika'
            };
        }
    }

    // Dodaj użytkownika do listy
    async addToUserList(userId) {
        try {
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (!usersList) {
                usersList = [];
            }

            if (!usersList.includes(userId)) {
                usersList.push(userId);
                await this.kv.put(usersListKey, JSON.stringify(usersList));
            }
        } catch (error) {
            console.error('Błąd dodawania do listy użytkowników:', error);
        }
    }

    // Usuń użytkownika z listy
    async removeFromUserList(userId) {
        try {
            const usersListKey = 'USERS:LIST';
            let usersList = await this.kv.get(usersListKey, 'json');
            
            if (usersList) {
                usersList = usersList.filter(id => id !== userId);
                await this.kv.put(usersListKey, JSON.stringify(usersList));
            }
        } catch (error) {
            console.error('Błąd usuwania z listy użytkowników:', error);
        }
    }

    // Pobierz statystyki użytkownika
    async getUserStats(userId) {
        try {
            const searchLogsKey = `SEARCH:${userId}:*`;
            // Tutaj implementacja zliczania wyszukiwań
            // Wymagałoby to listowania kluczy z prefiksem
            
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

    // Pobierz historię aktywności użytkownika
    async getUserActivity(userId, limit = 50) {
        try {
            // Implementacja pobierania logów aktywności
            return {
                success: true,
                activities: []
            };
        } catch (error) {
            console.error('Błąd pobierania aktywności:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania historii'
            };
        }
    }
}

export default UserService;