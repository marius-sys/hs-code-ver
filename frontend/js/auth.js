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
                    window.location.href = 'index.html';
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

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('role');
            window.location.href = 'login.html';
        });
    }

    // Przekierowanie, jeśli brak tokena i nie jesteśmy na stronie logowania
    const token = localStorage.getItem('token');
    const currentPath = window.location.pathname;
    
    if (!token && !currentPath.includes('login.html')) {
        window.location.href = 'login.html';
    } else if (token) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const userSpan = document.getElementById('loggedUser');
            if (userSpan) userSpan.textContent = payload.username;
        } catch (e) {
            console.error('Błąd dekodowania tokena', e);
        }
    }
});