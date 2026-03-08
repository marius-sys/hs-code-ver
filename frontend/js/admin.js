const API_BASE_URL = 'https://hs-code-verifier-api-auth.konto-dla-m-w-q4r.workers.dev';
// admin.js – ładowanie logów
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
        const response = await fetch(`${API_BASE_URL}/admin/logs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        if (data.success) {
            const tbody = document.getElementById('logsBody');
            tbody.innerHTML = '';
            if (data.logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4">Brak logów</td></tr>';
            } else {
                data.logs.forEach(log => {
                    const row = tbody.insertRow();
                    row.insertCell().textContent = new Date(log.timestamp).toLocaleString();
                    row.insertCell().textContent = log.userId;
                    row.insertCell().textContent = log.code;
                    row.insertCell().textContent = log.ip;
                });
            }
        } else {
            alert('Błąd ładowania logów: ' + data.error);
        }
    } catch (err) {
        alert('Błąd połączenia');
    }
});