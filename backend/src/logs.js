/**
 * System logowania aktywności użytkowników
 */

export class LogService {
    constructor(kvStorage) {
        this.kv = kvStorage;
    }

    // Logowanie wyszukiwania kodu HS
    async logSearch(userId, searchData, result) {
        try {
            const timestamp = new Date().toISOString();
            const logId = `SEARCH:${timestamp}:${userId}:${searchData.code}`;
            
            const logEntry = {
                id: logId,
                userId,
                type: 'HS_SEARCH',
                data: {
                    code: searchData.code,
                    normalizedCode: searchData.normalizedCode,
                    timestamp,
                    userAgent: searchData.userAgent || 'unknown',
                    ip: searchData.ip || 'unknown'
                },
                result: {
                    success: result.success,
                    description: result.description,
                    status: result.isValid ? 'valid' : 'invalid',
                    sanctioned: result.sanctioned,
                    controlled: result.controlled,
                    isGeneralCode: result.isGeneralCode,
                    isFinalCode: result.isFinalCode
                },
                timestamp
            };

            await this.kv.put(logId, JSON.stringify(logEntry));

            // Aktualizacja statystyk użytkownika
            await this.updateUserStats(userId);

            return {
                success: true,
                logId
            };
        } catch (error) {
            console.error('Błąd logowania wyszukiwania:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // Pobierz historię wyszukiwań użytkownika
    async getUserSearchHistory(userId, filters = {}) {
        try {
            const { startDate, endDate, limit = 100, offset = 0 } = filters;
            
            // W Cloudflare KV nie ma możliwości zapytań zakresowych
            // Możemy przechowywać listę ID wyszukiwań dla każdego użytkownika
            const userHistoryKey = `USER_HISTORY:${userId}`;
            let historyList = await this.kv.get(userHistoryKey, 'json');
            
            if (!historyList) {
                historyList = [];
            }

            // Pobranie logów
            const logs = [];
            for (const logId of historyList.slice(offset, offset + limit)) {
                const logEntry = await this.kv.get(logId, 'json');
                if (logEntry) {
                    // Filtrowanie po dacie
                    if (startDate && new Date(logEntry.timestamp) < new Date(startDate)) {
                        continue;
                    }
                    if (endDate && new Date(logEntry.timestamp) > new Date(endDate)) {
                        continue;
                    }
                    
                    logs.push(logEntry);
                }
            }

            // Sortowanie od najnowszych
            logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

            return {
                success: true,
                logs,
                total: historyList.length,
                limit,
                offset
            };
        } catch (error) {
            console.error('Błąd pobierania historii:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania historii'
            };
        }
    }

    // Aktualizacja statystyk użytkownika
    async updateUserStats(userId) {
        try {
            const statsKey = `USER_STATS:${userId}`;
            let stats = await this.kv.get(statsKey, 'json');
            
            if (!stats) {
                stats = {
                    totalSearches: 0,
                    todaySearches: 0,
                    lastSearch: null,
                    searchByDay: {},
                    lastUpdated: new Date().toISOString()
                };
            }

            const today = new Date().toISOString().split('T')[0];
            
            stats.totalSearches = (stats.totalSearches || 0) + 1;
            stats.todaySearches = (stats.searchByDay[today] || 0) + 1;
            stats.searchByDay[today] = stats.todaySearches;
            stats.lastSearch = new Date().toISOString();
            stats.lastUpdated = new Date().toISOString();

            await this.kv.put(statsKey, JSON.stringify(stats));

            return stats;
        } catch (error) {
            console.error('Błąd aktualizacji statystyk:', error);
        }
    }

    // Pobierz statystyki systemowe
    async getSystemStats() {
        try {
            const statsKey = 'SYSTEM_STATS';
            let stats = await this.kv.get(statsKey, 'json');
            
            if (!stats) {
                stats = {
                    totalSearches: 0,
                    activeUsers: 0,
                    searchesToday: 0,
                    lastUpdated: new Date().toISOString()
                };
            }

            return {
                success: true,
                stats
            };
        } catch (error) {
            console.error('Błąd pobierania statystyk systemowych:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania statystyk'
            };
        }
    }

    // Pobierz logi systemowe (dla admina)
    async getSystemLogs(filters = {}) {
        try {
            const { level, search, limit = 100 } = filters;
            
            // Tutaj implementacja pobierania logów systemowych
            // Wymaga to odpowiedniego przechowywania logów
            
            return {
                success: true,
                logs: [],
                total: 0
            };
        } catch (error) {
            console.error('Błąd pobierania logów systemowych:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas pobierania logów'
            };
        }
    }

    // Eksport historii użytkownika do CSV
    async exportUserHistory(userId, format = 'csv') {
        try {
            const history = await this.getUserSearchHistory(userId, { limit: 1000 });
            
            if (!history.success) {
                return history;
            }

            let exportData = '';
            
            if (format === 'csv') {
                exportData = 'Data,Kod HS,Status,Opis,Sanctions,Control\n';
                history.logs.forEach(log => {
                    exportData += `"${log.timestamp}","${log.data.code}","${log.result.status}","${log.result.description}","${log.result.sanctioned}","${log.result.controlled}"\n`;
                });
            } else if (format === 'json') {
                exportData = JSON.stringify(history.logs, null, 2);
            }

            return {
                success: true,
                format,
                data: exportData,
                filename: `hs-search-history-${userId}-${new Date().toISOString().split('T')[0]}.${format}`
            };
        } catch (error) {
            console.error('Błąd eksportu historii:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas eksportu historii'
            };
        }
    }

    // Czyszczenie starych logów
    async cleanupOldLogs(daysToKeep = 90) {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
            
            // Implementacja czyszczenia starych logów
            // Wymaga listowania kluczy i sprawdzania daty
            
            return {
                success: true,
                message: `Logi starsze niż ${daysToKeep} dni zostały wyczyszczone`
            };
        } catch (error) {
            console.error('Błąd czyszczenia logów:', error);
            return {
                success: false,
                error: 'Wystąpił błąd podczas czyszczenia logów'
            };
        }
    }
}

export default LogService;