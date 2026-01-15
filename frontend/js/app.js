class HSCodeVerifier {
    constructor() {
        this.apiBaseUrl = 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev';
        this.init();
    }

    init() {
        this.hsCodeInput = document.getElementById('hsCode');
        this.verifyBtn = document.getElementById('verifyBtn');
        this.loading = document.getElementById('loading');
        this.result = document.getElementById('result');
        this.apiStatus = document.getElementById('api-status');
        this.dbFormat = document.getElementById('db-format');
        this.dbCount = document.getElementById('db-count');
        
        this.bindEvents();
        this.checkAPI();
    }

    bindEvents() {
        this.verifyBtn.addEventListener('click', () => this.verify());
        this.hsCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verify();
        });
        
        document.getElementById('newBtn').addEventListener('click', () => {
            this.hsCodeInput.value = '';
            this.result.classList.add('hidden');
            // Usuń ewentualne ostrzeżenia sankcyjne
            const warning = document.querySelector('.sanction-warning');
            if (warning) {
                warning.remove();
            }
            this.hsCodeInput.focus();
        });
        
        document.querySelectorAll('.btn-example').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.target.dataset.code;
                this.hsCodeInput.value = code;
                this.verify();
            });
        });
    }

    async checkAPI() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/health`);
            const data = await response.json();
            
            if (response.ok) {
                this.apiStatus.textContent = 'Działa ✓';
                this.apiStatus.style.color = '#28a745';
                
                if (data.database) {
                    this.dbFormat.textContent = data.database.hasBinding ? 'KV' : 'Brak';
                    this.dbCount.textContent = data.database.totalRecords || '0';
                }
            } else {
                this.apiStatus.textContent = 'Błąd ✗';
                this.apiStatus.style.color = '#dc3545';
            }
        } catch {
            this.apiStatus.textContent = 'Brak połączenia';
            this.apiStatus.style.color = '#dc3545';
        }
    }

    async verify() {
        const code = this.hsCodeInput.value.trim();
        
        if (!code || code.length < 4) {
            alert('Wprowadź poprawny kod HS (min. 4 cyfry)');
            return;
        }
        
        this.showLoading(true);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code })
            });
            
            const data = await response.json();
            this.displayResult(data);
            
        } catch (error) {
            alert('Błąd połączenia z serwerem');
            console.error('Błąd weryfikacji:', error);
        } finally {
            this.showLoading(false);
        }
    }

    displayResult(data) {
        document.getElementById('result-code').textContent = data.code;
        document.getElementById('result-desc').textContent = data.description;
        
        const statusEl = document.getElementById('result-status');
        
        if (data.isGeneralCode) {
            statusEl.textContent = 'KOD OGÓLNY';
            statusEl.className = 'general';
        } else if (data.isValid) {
            statusEl.textContent = 'POPRAWNY';
            statusEl.className = 'valid';
        } else {
            statusEl.textContent = 'NIEPOPRAWNY';
            statusEl.className = 'invalid';
        }
        
        // Usuń stare ostrzeżenia sankcyjne jeśli istnieją
        const oldWarning = document.querySelector('.sanction-warning');
        if (oldWarning) {
            oldWarning.remove();
        }
        
        // Dodaj ostrzeżenie sankcyjne jeśli dotyczy
        if (data.sanctioned) {
            const warning = document.createElement('div');
            warning.className = 'sanction-warning';
            warning.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <strong>UWAGA SANKCYJNA:</strong> ${data.sanctionMessage || 'Ten towar podlega ograniczeniom'}
            `;
            document.getElementById('result').appendChild(warning);
        }
        
        this.result.classList.remove('hidden');
    }

    showLoading(show) {
        if (show) {
            this.loading.classList.remove('hidden');
            this.verifyBtn.disabled = true;
        } else {
            this.loading.classList.add('hidden');
            this.verifyBtn.disabled = false;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new HSCodeVerifier();
});