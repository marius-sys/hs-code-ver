/**
 * Logika strony logowania
 */

class LoginManager {
    constructor() {
        this.apiBaseUrl = 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev';
        this.init();
    }

    init() {
        this.bindEvents();
        this.checkRememberedUser();
    }

    bindEvents() {
        const loginForm = document.getElementById('loginForm');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => this.handleLogin(e));
        }
    }

    checkRememberedUser() {
        const rememberedUser = localStorage.getItem('hs_remembered_user');
        if (remembernedUser) {
            try {
                const user = JSON.parse(rememberedUser);
                document.getElementById('username').value = user.username;
                document.getElementById('remember').checked = true;
            } catch (error) {
                console.error('Błąd parsowania zapamiętanego użytkownika:', error);
            }
        }
    }

    async handleLogin(event) {
        event.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const remember = document.getElementById('remember').checked;
        
        // Walidacja
        if (!username || !password) {
            this.showError('Wprowadź nazwę użytkownika i hasło');
            return;
        }

        this.showLoading(true);

        try {
            const response = await fetch(`${this.apiBaseUrl}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    username,
                    password
                })
            });

            const data = await response.json();

            if (data.success && data.token) {
                // Zapamiętaj użytkownika jeśli wybrano opcję
                if (remember) {
                    localStorage.setItem('hs_remembered_user', JSON.stringify({
                        username,
                        timestamp: new Date().toISOString()
                    }));
                } else {
                    localStorage.removeItem('hs_remembered_user');
                }

                // Zapisz token i dane użytkownika
                localStorage.setItem('hs_auth_token', data.token);
                localStorage.setItem('hs_user_data', JSON.stringify(data.user));
                
                // Zapisz czas logowania
                sessionStorage.setItem('hs_login_time', new Date().toISOString());
                
                // Przekieruj do dashboardu
                window.location.href = 'dashboard.html';
            } else {
                this.showError(data.error || 'Logowanie nie powiodło się');
            }
        } catch (error) {
            console.error('Błąd logowania:', error);
            this.showError('Błąd połączenia z serwerem');
        } finally {
            this.showLoading(false);
        }
    }

    showError(message) {
        const errorDiv = document.getElementById('error-message');
        const errorText = document.getElementById('error-text');
        
        errorText.textContent = message;
        errorDiv.classList.remove('hidden');
        
        // Automatyczne ukrycie błędu po 5 sekundach
        setTimeout(() => {
            errorDiv.classList.add('hidden');
        }, 5000);
    }

    showLoading(show) {
        const loginForm = document.getElementById('login-form');
        const loadingDiv = document.getElementById('loading');
        const loginBtn = document.getElementById('loginBtn');
        
        if (show) {
            loginForm.classList.add('hidden');
            loadingDiv.classList.remove('hidden');
            loginBtn.disabled = true;
        } else {
            loginForm.classList.remove('hidden');
            loadingDiv.classList.add('hidden');
            loginBtn.disabled = false;
        }
    }
}

// Inicjalizacja po załadowaniu strony
document.addEventListener('DOMContentLoaded', () => {
    new LoginManager();
    
    // Sprawdź czy użytkownik jest już zalogowany
    const token = localStorage.getItem('hs_auth_token');
    if (token) {
        window.location.href = 'dashboard.html';
    }
});