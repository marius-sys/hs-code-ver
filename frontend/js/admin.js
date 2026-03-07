class AdminPanel {
    constructor() {
        this.apiBaseUrl = 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev';
        this.token = localStorage.getItem('token');
        this.username = localStorage.getItem('username');
        this.role = localStorage.getItem('role');
        
        this.init();
    }

    init() {
        if (!this.token || this.role !== 'admin') {
            window.location.href = 'login.html';
            return;
        }

        document.getElementById('username').textContent = this.username;
        
        document.getElementById('backToAppBtn').addEventListener('click', () => {
            window.location.href = 'index.html';
        });

        document.getElementById('logoutBtn').addEventListener('click', () => this.logout());
        document.getElementById('refreshLogsBtn').addEventListener('click', () => this.loadLogs());

        this.loadLogs();
    }

    async loadLogs() {
        this.showLoading(true);
        const tbody = document.getElementById('logsBody');
        tbody.innerHTML = '';

        try {
            const response = await fetch(`${this.apiBaseUrl}/logs`, {
                headers: {
                    'Authorization': `Bearer ${this.token}`
                }
            });

            if (response.status === 401 || response.status === 403) {
                window.location.href = 'login.html';
                return;
            }

            if (!response.ok) {
                throw new Error('Błąd pobierania logów');
            }

            const logs = await response.json();
            
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Brak zapisanych logów</td></tr>';
            } else {
                logs.forEach(log => {
                    const row = document.createElement('tr');
                    const date = new Date(log.timestamp).toLocaleString('pl-PL');
                    row.innerHTML = `
                        <td>${date}</td>
                        <td><strong>${log.username}</strong></td>
                        <td><code>${log.code}</code></td>
                        <td>${log.ip}</td>
                    `;
                    tbody.appendChild(row);
                });
            }
        } catch (error) {
            console.error(error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: red;">Błąd ładowania logów</td></tr>';
        } finally {
            this.showLoading(false);
        }
    }

    logout() {
        fetch(`${this.apiBaseUrl}/logout`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        }).finally(() => {
            localStorage.removeItem('token');
            localStorage.removeItem('username');
            localStorage.removeItem('role');
            window.location.href = 'login.html';
        });
    }

    showLoading(show) {
        const loading = document.getElementById('loading');
        if (show) {
            loading.classList.remove('hidden');
        } else {
            loading.classList.add('hidden');
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new AdminPanel();
});