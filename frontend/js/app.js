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
        this.extendedCodeInfo = document.getElementById('extended-code-info');
        this.extendedCodeSpan = document.getElementById('extended-code');
        
        this.bindEvents();
        this.checkAPI();
    }

    bindEvents() {
        this.verifyBtn.addEventListener('click', () => this.verify());
        this.hsCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verify();
        });
        
        // Auto-formatowanie podczas wpisywania
        this.hsCodeInput.addEventListener('input', (e) => {
            this.formatInput(e.target);
        });
        
        document.getElementById('newBtn').addEventListener('click', () => {
            this.hsCodeInput.value = '';
            this.result.classList.add('hidden');
            this.extendedCodeInfo.classList.add('hidden');
            
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

    // Formatowanie inputu (automatyczne dodawanie spacji)
    formatInput(input) {
        let value = input.value.replace(/[^\d\s\-]/g, ''); // Pozostaw tylko cyfry, spacje i myślniki
        value = value.replace(/\s+/g, ' ').trim(); // Zastąp wiele spacji jedną
        
        // Auto-formatowanie: 1234 56 78 90
        if (value.length > 4 && !value.includes(' ') && !value.includes('-')) {
            // Jeśli wpisano więcej niż 4 cyfry bez separatorów, dodaj spację
            const parts = [];
            parts.push(value.substring(0, 4));
            if (value.length > 4) parts.push(value.substring(4, 6));
            if (value.length > 6) parts.push(value.substring(6, 8));
            if (value.length > 8) parts.push(value.substring(8, 10));
            
            value = parts.join(' ').trim();
        }
        
        input.value = value;
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
        let code = this.hsCodeInput.value.trim();
        
        // Usuń wszystkie niecyfrowe znaki przed walidacją
        const cleanedCode = code.replace(/[^\d]/g, '');
        
        if (!cleanedCode || cleanedCode.length < 4) {
            alert('Wprowadź poprawny kod HS (min. 4 cyfry)');
            return;
        }
        
        if (cleanedCode.length > 10) {
            alert('Kod HS może mieć maksymalnie 10 cyfr');
            return;
        }
        
        this.showLoading(true);
        
        try {
            // Wyślij oryginalny kod (backend sam go wyczyści)
            const response = await fetch(`${this.apiBaseUrl}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: code })
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
        // Debug: sprawdź co przychodzi z API
        console.log('Dane z API:', data);
        
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
        
        // Obsługa rozszerzonych kodów (jeśli kod został rozszerzony)
        if (data.isSingleSubcode && data.originalCode) {
            this.extendedCodeSpan.textContent = `${data.originalCode} → ${data.code}`;
            this.extendedCodeInfo.classList.remove('hidden');
        } else {
            this.extendedCodeInfo.classList.add('hidden');
        }
        
        // Usuń stare ostrzeżenia sankcyjne jeśli istnieją
        const oldWarning = document.querySelector('.sanction-warning');
        if (oldWarning) {
            oldWarning.remove();
        }
        
        // Dodaj ostrzeżenie sankcyjne jeśli dotyczy
        if (data.sanctioned) {
            console.log('Wyświetlam ostrzeżenie sankcyjne dla kodu:', data.code);
            
            const warning = document.createElement('div');
            warning.className = 'sanction-warning';
            warning.innerHTML = `
                <i class="fas fa-exclamation-triangle"></i>
                <strong>${data.sanctionMessage || 'UWAGA: Towar sankcyjny!'}</strong>
            `;
            
            // Dodaj ostrzeżenie do karty wyników
            const resultCard = document.getElementById('result');
            resultCard.appendChild(warning);
            
            // Dodaj też klasę do karty wyników dla dodatkowego stylu
            resultCard.classList.add('has-sanction');
        } else {
            // Usuń klasę jeśli nie ma sankcji
            document.getElementById('result').classList.remove('has-sanction');
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