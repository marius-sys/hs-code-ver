const API_BASE_URL = 'https://hs-code-verifier-api-auth.konto-dla-m-w-q4r.workers.dev';

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorDiv = document.getElementById('loginError');

            try {
                const response = await fetch(`${API_BASE_URL}/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await response.json();
                if (data.success) {
                    localStorage.setItem('token', data.token);
                    localStorage.setItem('role', data.role);
                    window.location.href = '/';
                } else {
                    errorDiv.textContent = data.error || 'Błąd logowania';
                    errorDiv.classList.remove('hidden');
                }
            } catch (err) {
                errorDiv.textContent = 'Błąd połączenia z serwerem';
                errorDiv.classList.remove('hidden');
            }
        });
    }

    // Sprawdzenie tokena – jeśli brak i nie jesteśmy na stronie logowania, przekieruj
    const token = localStorage.getItem('token');
    const currentPath = window.location.pathname;
    
    if (!token && currentPath !== '/login') {
        window.location.href = '/login';
    } else if (token) {
        // Wyświetl elementy userInfo na stronach, gdzie istnieją
        const userInfo = document.getElementById('userInfo');
        const loggedUserSpan = document.getElementById('loggedUser');
        const logoutBtn = document.getElementById('logoutBtn');
        const adminPanelBtn = document.getElementById('adminPanelBtn');

        if (userInfo) userInfo.style.display = 'flex';
        
        if (loggedUserSpan) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                loggedUserSpan.textContent = payload.username;
                
                // Pokaż przycisk panelu admina tylko dla roli admin
                if (adminPanelBtn && payload.role === 'admin') {
                    adminPanelBtn.style.display = 'inline-flex';
                    adminPanelBtn.addEventListener('click', () => {
                        window.location.href = '/admin';
                    });
                }
            } catch (e) {
                console.error('Błąd dekodowania tokena', e);
            }
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('token');
                localStorage.removeItem('role');
                window.location.href = '/login';
            });
        }
    }
});