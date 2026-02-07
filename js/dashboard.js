/**
 * Główna logika dashboardu
 */

class DashboardManager {
    constructor() {
        this.apiBaseUrl = 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev';
        this.currentUser = null;
        this.authToken = null;
        this.init();
    }

    async init() {
        // Sprawdź autoryzację
        if (!this.checkAuth()) {
            return;
        }

        this.bindEvents();
        await this.loadUserData();
        this.setupNavigation();
        this.checkAdminAccess();
    }

    checkAuth() {
        this.authToken = localStorage.getItem('hs_auth_token');
        const userData = localStorage.getItem('hs_user_data');
        
        if (!this.authToken || !userData) {
            // Przekieruj do logowania
            window.location.href = 'login.html';
            return false;
        }

        try {
            this.currentUser = JSON.parse(userData);
            return true;
        } catch (error) {
            console.error('Błąd parsowania danych użytkownika:', error);
            window.location.href = 'login.html';
            return false;
        }
    }

    bindEvents() {
        // Logout
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.logout());
        }

        // Weryfikacja kodu (przeniesione z app.js)
        const verifyBtn = document.getElementById('verifyBtn');
        if (verifyBtn) {
            verifyBtn.addEventListener('click', () => this.verifyCode());
        }

        const hsCodeInput = document.getElementById('hsCode');
        if (hsCodeInput) {
            hsCodeInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    this.verifyCode();
                }
            });

            // Auto-formatowanie
            hsCodeInput.addEventListener('input', (e) => {
                this.formatHSCodeInput(e.target);
            });
        }

        // Przykładowe kody
        document.querySelectorAll('.btn-example').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.target.getAttribute('data-code');
                document.getElementById('hsCode').value = code;
                this.verifyCode();
            });
        });

        // Nowy kod
        const newBtn = document.getElementById('newBtn');
        if (newBtn) {
            newBtn.addEventListener('click', () => this.resetForm());
        }

        // Zmiana hasła
        const changePassBtn = document.getElementById('change-password-btn');
        if (changePassBtn) {
            changePassBtn.addEventListener('click', () => this.showChangePasswordModal());
        }

        // Filtry historii
        const filterBtn = document.getElementById('filter-btn');
        if (filterBtn) {
            filterBtn.addEventListener('click', () => this.loadHistory());
        }

        // Eksport historii
        const exportBtn = document.getElementById('export-btn');
        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportHistory());
        }
    }

    async loadUserData() {
        try {
            // Aktualizuj UI z danymi użytkownika
            document.getElementById('username-display').textContent = this.currentUser.username;
            document.getElementById('user-role').textContent = this.currentUser.role === 'admin' ? 'Administrator' : 'Użytkownik';
            
            document.getElementById('profile-username').textContent = this.currentUser.username;
            document.getElementById('profile-role').textContent = this.currentUser.role === 'admin' ? 'Administrator' : 'Użytkownik';
            document.getElementById('profile-registration').textContent = this.formatDate(this.currentUser.createdAt);
            document.getElementById('profile-last-login').textContent = this.formatDate(this.currentUser.lastLogin);
            
            // Pobierz statystyki
            await this.loadUserStats();
            
            // Ustaw ostatnie logowanie
            const lastLogin = sessionStorage.getItem('hs_login_time') || this.currentUser.lastLogin;
            document.getElementById('last-login').textContent = `Ostatnie logowanie: ${this.formatDate(lastLogin)}`;
            
        } catch (error) {
            console.error('Błąd ładowania danych użytkownika:', error);
        }
    }

    checkAdminAccess() {
        if (this.currentUser.role === 'admin') {
            document.getElementById('admin-menu').classList.remove('hidden');
        }
    }

    setupNavigation() {
        const navLinks = document.querySelectorAll('.nav-link');
        const pages = document.querySelectorAll('.page');
        
        navLinks.forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                
                const pageName = link.getAttribute('data-page');
                
                // Aktualizuj aktywne linki
                navLinks.forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                
                // Ukryj wszystkie strony, pokaż wybraną
                pages.forEach(page => page.classList.add('hidden'));
                document.getElementById(`${pageName}-page`).classList.remove('hidden');
                
                // Aktualizuj tytuł
                document.getElementById('page-title').textContent = 
                    this.getPageTitle(pageName);
                
                // Załaduj dane dla strony jeśli to konieczne
                if (pageName === 'history') {
                    this.loadHistory();
                } else if (pageName === 'admin') {
                    // Załaduj dane admina
                    this.loadAdminData();
                }
            });
        });
    }

    getPageTitle(pageName) {
        const titles = {
            'verify': 'Weryfikacja kodów HS',
            'history': 'Historia wyszukiwań',
            'profile': 'Mój profil',
            'admin': 'Panel administratora'
        };
        return titles[pageName] || 'Dashboard';
    }

    formatHSCodeInput(input) {
        let value = input.value.replace(/\D/g, '');
        
        if (value.length > 10) {
            value = value.substring(0, 10);
        }
        
        // Auto-dodawanie spacji
        if (value.length > 4) {
            value = value.substring(0, 4) + ' ' + value.substring(4);
        }
        if (value.length > 7) {
            value = value.substring(0, 7) + ' ' + value.substring(7);
        }
        
        input.value = value;
    }

    async verifyCode() {
        const codeInput = document.getElementById('hsCode');
        const code = codeInput.value.trim();
        
        if (!code) {
            this.showResultError('Wprowadź kod HS do weryfikacji');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiBaseUrl}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ code })
            });

            const data = await response.json();
            this.displayResult(data);
            
        } catch (error) {
            console.error('Błąd weryfikacji:', error);
            this.showResultError('Błąd połączenia z serwerem');
        } finally {
            this.showLoading(false);
        }
    }

    displayResult(result) {
        const resultDiv = document.getElementById('result');
        const loadingDiv = document.getElementById('loading');
        
        // Ukryj loading, pokaż wynik
        loadingDiv.classList.add('hidden');
        resultDiv.classList.remove('hidden');
        
        // Ustaw podstawowe dane
        document.getElementById('result-code').textContent = result.code;
        document.getElementById('result-desc').innerHTML = result.formattedDescription || result.description;
        
        // Status weryfikacji
        const statusSpan = document.getElementById('result-status');
        statusSpan.textContent = result.success ? 'Znaleziono w bazie' : 'Nie znaleziono';
        statusSpan.className = result.success ? 'valid' : 'invalid';
        
        // Dodatkowe informacje dla sankcji/kontroli
        const sanctionWarning = document.getElementById('sanction-warning-top');
        const controlledWarning = document.getElementById('controlled-warning-top');
        
        sanctionWarning.classList.add('hidden');
        controlledWarning.classList.add('hidden');
        
        if (result.sanctioned) {
            sanctionWarning.classList.remove('hidden');
            statusSpan.className = 'sanctioned';
            statusSpan.textContent = 'KOD SANKCYJNY';
        } else if (result.controlled) {
            controlledWarning.classList.remove('hidden');
            statusSpan.className = 'controlled-status';
            statusSpan.textContent = 'KONTROLA SANEPID';
        }
        
        // Informacja o rozszerzeniu kodu
        const extendedInfo = document.getElementById('extended-code-info');
        const extendedCodeSpan = document.getElementById('extended-code');
        
        if (result.isSingleSubcode && result.code !== result.originalCode) {
            extendedInfo.classList.remove('hidden');
            extendedCodeSpan.textContent = result.code.padEnd(10, '0');
        } else {
            extendedInfo.classList.add('hidden');
        }
    }

    async loadHistory() {
        try {
            const startDate = document.getElementById('date-from').value;
            const endDate = document.getElementById('date-to').value;
            
            let url = `${this.apiBaseUrl}/api/user/history?limit=50`;
            
            if (startDate) url += `&startDate=${startDate}`;
            if (endDate) url += `&endDate=${endDate}`;
            
            const response = await fetch(url, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                this.displayHistory(data.logs);
                this.setupPagination(data.total, data.limit);
            } else {
                this.showError('Błąd ładowania historii');
            }
        } catch (error) {
            console.error('Błąd ładowania historii:', error);
            this.showError('Błąd połączenia z serwerem');
        }
    }

    displayHistory(logs) {
        const tbody = document.getElementById('history-body');
        tbody.innerHTML = '';
        
        if (logs.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="5" class="empty-history">
                        <i class="fas fa-search"></i>
                        <p>Brak zapisanych wyszukiwań</p>
                    </td>
                </tr>
            `;
            return;
        }
        
        logs.forEach(log => {
            const row = document.createElement('tr');
            
            const statusClass = log.result.status === 'valid' ? 'status-valid' : 
                               log.result.sanctioned ? 'status-sanctioned' :
                               log.result.controlled ? 'status-controlled' : 'status-invalid';
            
            const statusText = log.result.status === 'valid' ? 'Poprawny' :
                              log.result.sanctioned ? 'Sankcyjny' :
                              log.result.controlled ? 'Kontrola' : 'Nieznany';
            
            row.innerHTML = `
                <td>${this.formatDateTime(log.timestamp)}</td>
                <td><code>${log.data.code}</code></td>
                <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                <td>${log.result.description.substring(0, 50)}${log.result.description.length > 50 ? '...' : ''}</td>
                <td>
                    <button class="btn-small" onclick="dashboard.verifyCodeAgain('${log.data.code}')">
                        <i class="fas fa-redo"></i>
                    </button>
                </td>
            `;
            
            tbody.appendChild(row);
        });
    }

    async loadUserStats() {
        try {
            // Możemy załadować statystyki z localStorage lub API
            const searchCount = localStorage.getItem(`hs_search_count_${this.currentUser.id}`) || 0;
            document.getElementById('profile-search-count').textContent = searchCount;
        } catch (error) {
            console.error('Błąd ładowania statystyk:', error);
        }
    }

    async exportHistory() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/api/user/history/export?format=csv`, {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                // Pobierz plik
                const blob = new Blob([data.data], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                
                a.href = url;
                a.download = data.filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
            }
        } catch (error) {
            console.error('Błąd eksportu:', error);
            this.showError('Błąd eksportu historii');
        }
    }

    showChangePasswordModal() {
        // Implementacja modalnego okna zmiany hasła
        const modal = document.getElementById('change-password-modal');
        modal.classList.remove('hidden');
        
        // Obsługa zamknięcia
        modal.querySelector('.modal-close').addEventListener('click', () => {
            modal.classList.add('hidden');
        });
        
        modal.querySelector('.modal-cancel').addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    logout() {
        // Wyczyść dane sesji
        localStorage.removeItem('hs_auth_token');
        localStorage.removeItem('hs_user_data');
        sessionStorage.removeItem('hs_login_time');
        
        // Przekieruj do logowania
        window.location.href = 'login.html';
    }

    showLoading(show) {
        const loadingDiv = document.getElementById('loading');
        if (show) {
            loadingDiv.classList.remove('hidden');
        } else {
            loadingDiv.classList.add('hidden');
        }
    }

    showError(message) {
        // Można dodać notyfikację
        alert(message);
    }

    showResultError(message) {
        // Specjalna funkcja dla błędów wyników
        const resultDiv = document.getElementById('result');
        document.getElementById('result-desc').textContent = message;
        document.getElementById('result-status').textContent = 'Błąd';
        document.getElementById('result-status').className = 'invalid';
        
        resultDiv.classList.remove('hidden');
    }

    resetForm() {
        document.getElementById('hsCode').value = '';
        document.getElementById('result').classList.add('hidden');
    }

    formatDate(dateString) {
        if (!dateString) return 'Nigdy';
        
        const date = new Date(dateString);
        return date.toLocaleDateString('pl-PL', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatDateTime(dateString) {
        const date = new Date(dateString);
        return date.toLocaleString('pl-PL');
    }
}

// Globalna instancja
let dashboard;

// Inicjalizacja
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new DashboardManager();
});