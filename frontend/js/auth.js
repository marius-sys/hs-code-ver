// auth.js – obsługa logowania i zarządzanie tokenem
const API_BASE_URL = 'https://hs-code-verifier-api-auth.workers.dev'; // docelowo zmienić po deployu

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

    // Obsługa wylogowania
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.removeItem('token');
            localStorage.removeItem('role');
            window.location.href = 'login.html';
        });
    }

    // Sprawdzenie czy token istnieje (dla stron chronionych)
    const token = localStorage.getItem('token');
    const currentPath = window.location.pathname;
    if (currentPath.includes('admin.html') || currentPath.includes('index.html')) {
        if (!token) {
            window.location.href = 'login.html';
        } else {
            // Wyświetl nazwę użytkownika z tokena (można dekodować JWT)
            const payload = JSON.parse(atob(token.split('.')[1]));
            const userSpan = document.getElementById('loggedUser');
            if (userSpan) userSpan.textContent = payload.username;
        }
    }
});