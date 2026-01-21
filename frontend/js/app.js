class HSCodeVerifier {
    constructor() {
        this.apiBaseUrl = 'https://hs-code-verifier-api.konto-dla-m-w-q4r.workers.dev';
        this.init();
    }

    init() {
        // Elementy DOM
        this.hsCodeInput = document.getElementById('hsCode');
        this.verifyBtn = document.getElementById('verifyBtn');
        this.loading = document.getElementById('loading');
        this.result = document.getElementById('result');
        this.apiStatus = document.getElementById('api-status');
        this.dbFormat = document.getElementById('db-format');
        this.dbCount = document.getElementById('db-count');
        this.lastSync = document.getElementById('last-sync');
        this.extendedCodeInfo = document.getElementById('extended-code-info');
        this.extendedCodeSpan = document.getElementById('extended-code');
        this.copyBtn = document.getElementById('copyBtn');
        
        this.bindEvents();
        this.checkAPI();
        this.loadSystemInfo();
    }

    bindEvents() {
        // Weryfikacja na kliknięcie
        this.verifyBtn.addEventListener('click', () => this.verify());
        
        // Weryfikacja na Enter
        this.hsCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verify();
        });
        
        // Auto-formatowanie podczas wpisywania
        this.hsCodeInput.addEventListener('input', (e) => {
            this.formatInput(e.target);
        });
        
        // Nowa weryfikacja
        document.getElementById('newBtn').addEventListener('click', () => {
            this.resetForm();
        });
        
        // Kopiowanie wyniku
        if (this.copyBtn) {
            this.copyBtn.addEventListener('click', () => {
                this.copyResult();
            });
        }
        
        // Przykładowe kody
        document.querySelectorAll('.btn-example').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const code = e.target.closest('.btn-example').dataset.code;
                this.hsCodeInput.value = code;
                this.verify();
            });
        });
    }

    formatInput(input) {
        let value = input.value.replace(/[^\d\s\-]/g, '');
        value = value.replace(/\s+/g, ' ').trim();
        
        // Auto-dodawanie spacji dla dłuższych kodów
        if (value.length > 4 && !value.includes(' ') && !value.includes('-')) {
            const parts = [];
            parts.push(value.substring(0, 4));
            if (value.length > 4) parts.push(value.substring(4, 6));
            if (value.length > 6) parts.push(value.substring(6, 8));
            if (value.length > 8) parts.push(value.substring(8, 10));
            
            value = parts.join(' ').trim();
        }
        
        input.value = value;
    }

    async loadSystemInfo() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/stats`);
            const data = await response.json();
            
            if (response.ok) {
                this.lastSync.textContent = data.database.lastSync === 'Nigdy' ? 'Nigdy' : 
                    new Date(data.database.lastSync).toLocaleString('pl-PL');
            }
        } catch (error) {
            console.error('Błąd ładowania informacji o systemie:', error);
        }
    }

    async checkAPI() {
        try {
            const response = await fetch(`${this.apiBaseUrl}/health`);
            const data = await response.json();
            
            if (response.ok) {
                this.apiStatus.textContent = 'Działa ✓';
                this.apiStatus.className = 'status-indicator online';
                
                if (data.database) {
                    this.dbFormat.textContent = data.database.hasBinding ? 'Cloudflare KV' : 'Brak';
                    this.dbCount.textContent = data.database.totalRecords || '0';
                }
            } else {
                this.apiStatus.textContent = 'Błąd ✗';
                this.apiStatus.className = 'status-indicator offline';
            }
        } catch {
            this.apiStatus.textContent = 'Brak połączenia';
            this.apiStatus.className = 'status-indicator offline';
        }
    }

    async verify() {
        let code = this.hsCodeInput.value.trim();
        
        if (!code) {
            this.showError('Wprowadź kod HS do weryfikacji');
            return;
        }
        
        const cleanedCode = code.replace(/[^\d]/g, '');
        
        if (cleanedCode.length < 4) {
            this.showError('Kod HS musi mieć minimum 4 cyfry');
            return;
        }
        
        if (cleanedCode.length > 10) {
            this.showError('Kod HS może mieć maksymalnie 10 cyfr');
            return;
        }
        
        this.showLoading(true);
        
        try {
            const response = await fetch(`${this.apiBaseUrl}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ code: code })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Błąd serwera');
            }
            
            this.displayResult(data);
            
        } catch (error) {
            this.showError(`Błąd weryfikacji: ${error.message}`);
        } finally {
            this.showLoading(false);
        }
    }

    formatDescription(description) {
        if (!description) return '<em>Brak opisu</em>';
        
        const parts = description.split(' → ');
        
        let formattedParts = [];
        
        if (parts.length > 1 && parts[parts.length - 1].includes('Pozostałe')) {
            // Jeśli ostatnia część to "Pozostałe", pogrubiamy dwie ostatnie
            formattedParts = parts.slice(0, parts.length - 2).map(part => 
                `<div class="desc-line">${part}</div>`
            );
            
            formattedParts.push(
                `<div class="desc-line"><strong>${parts[parts.length - 2]}</strong></div>`,
                `<div class="desc-line"><strong>${parts[parts.length - 1]}</strong></div>`
            );
        } else {
            // W przeciwnym razie tylko ostatnią część
            formattedParts = parts.slice(0, parts.length - 1).map(part => 
                `<div class="desc-line">${part}</div>`
            );
            
            if (parts.length > 0) {
                formattedParts.push(
                    `<div class="desc-line"><strong>${parts[parts.length - 1]}</strong></div>`
                );
            }
        }
        
        return formattedParts.join('');
    }

    displayResult(data) {
        console.log('Odpowiedź API:', data);
        
        // Aktualizuj pola wyniku
        document.getElementById('result-code').textContent = data.code;
        document.getElementById('result-desc').innerHTML = this.formatDescription(data.description);
        
        const statusEl = document.getElementById('result-status');
        
        // Ustaw status weryfikacji
        if (data.specialStatus === 'sanepid') {
            statusEl.textContent = 'SANEPID';
            statusEl.className = 'sanepid';
        } else if (data.specialStatus === 'sanction') {
            statusEl.textContent = 'SANKCJE';
            statusEl.className = 'sanction';
        } else if (data.isGeneralCode) {
            statusEl.textContent = 'KOD OGÓLNY';
            statusEl.className = 'general';
        } else if (data.isValid) {
            statusEl.textContent = 'POPRAWNY';
            statusEl.className = 'valid';
        } else {
            statusEl.textContent = 'NIEPOPRAWNY';
            statusEl.className = 'invalid';
        }
        
        // Obsługa rozszerzonych kodów
        if ((data.isSingleSubcode || data.isExtendedFromPrefix) && data.originalCode) {
            this.extendedCodeSpan.textContent = `${data.originalCode} → ${data.code}`;
            this.extendedCodeInfo.classList.remove('hidden');
        } else {
            this.extendedCodeInfo.classList.add('hidden');
        }
        
        // Wyświetl ostrzeżenie specjalne
        this.showSpecialWarning(data);
        
        // Pokaż panel wyników
        this.result.classList.remove('hidden');
        
        // Przewiń do wyników
        this.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showSpecialWarning(data) {
        // Usuń istniejące ostrzeżenia
        const oldWarning = document.querySelector('.special-warning');
        if (oldWarning) {
            oldWarning.remove();
        }
        
        // Jeśli kod ma specjalny status, dodaj ostrzeżenie
        if (data.specialMessage && data.specialStatus) {
            const warning = document.createElement('div');
            warning.className = `special-warning ${data.specialStatus}`;
            
            let icon = '';
            let title = '';
            
            if (data.specialStatus === 'sanepid') {
                icon = 'fa-virus';
                title = 'Kontrola SANEPID';
            } else if (data.specialStatus === 'sanction') {
                icon = 'fa-ban';
                title = 'Towar sankcyjny';
            }
            
            warning.innerHTML = `
                <i class="fas ${icon}"></i>
                <div class="warning-content">
                    <strong>${title}</strong>
                    <p>${data.specialMessage}</p>
                </div>
            `;
            
            // Dodaj ostrzeżenie na początek panelu wyników
            const resultCard = document.getElementById('result');
            const resultTitle = resultCard.querySelector('h2');
            resultCard.insertBefore(warning, resultTitle.nextSibling);
        }
    }

    showError(message) {
        alert(message);
        this.hsCodeInput.focus();
    }

    showLoading(show) {
        if (show) {
            this.loading.classList.remove('hidden');
            this.verifyBtn.disabled = true;
            this.verifyBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Weryfikacja...';
        } else {
            this.loading.classList.add('hidden');
            this.verifyBtn.disabled = false;
            this.verifyBtn.innerHTML = '<i class="fas fa-search"></i> Sprawdź kod';
        }
    }

    resetForm() {
        this.hsCodeInput.value = '';
        this.result.classList.add('hidden');
        this.extendedCodeInfo.classList.add('hidden');
        
        // Usuń ostrzeżenia
        const warning = document.querySelector('.special-warning');
        if (warning) {
            warning.remove();
        }
        
        this.hsCodeInput.focus();
    }

    copyResult() {
        const code = document.getElementById('result-code').textContent;
        const description = document.getElementById('result-desc').textContent;
        const status = document.getElementById('result-status').textContent;
        
        const textToCopy = `Wynik weryfikacji:
Kod HS: ${code}
Opis towaru: ${description}
Status weryfikacji: ${status}`;
        
        navigator.clipboard.writeText(textToCopy)
            .then(() => {
                const originalText = this.copyBtn.innerHTML;
                this.copyBtn.innerHTML = '<i class="fas fa-check"></i> Skopiowano!';
                setTimeout(() => {
                    this.copyBtn.innerHTML = originalText;
                }, 2000);
            })
            .catch(err => {
                console.error('Błąd kopiowania:', err);
            });
    }
}

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
    new HSCodeVerifier();
});