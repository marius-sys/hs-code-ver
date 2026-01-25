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
        this.lastUpdate = document.getElementById('last-update');
        this.extendedCodeInfo = document.getElementById('extended-code-info');
        this.extendedCodeSpan = document.getElementById('extended-code');
        this.sanctionWarningTop = document.getElementById('sanction-warning-top');
        this.controlledWarningTop = document.getElementById('controlled-warning-top');
        
        this.bindEvents();
        this.checkAPI();
    }

    bindEvents() {
        this.verifyBtn.addEventListener('click', () => this.verify());
        this.hsCodeInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.verify();
        });
        
        this.hsCodeInput.addEventListener('input', (e) => {
            this.formatInput(e.target);
        });
        
        document.getElementById('newBtn').addEventListener('click', () => {
            this.hsCodeInput.value = '';
            this.result.classList.add('hidden');
            this.extendedCodeInfo.classList.add('hidden');
            
            // Ukryj oba ostrzeżenia
            this.sanctionWarningTop.classList.add('hidden');
            this.controlledWarningTop.classList.add('hidden');
            
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

    formatInput(input) {
        let value = input.value.replace(/[^\d\s\-]/g, '');
        value = value.replace(/\s+/g, ' ').trim();
        
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

    formatDescription(description) {
        if (!description) return '';
        
        const parts = description.split(' → ');
        const lastIndex = parts.length - 1;
        
        // Sprawdź czy ostatnia część to "Pozostałe"
        const isLastRemaining = parts[lastIndex].includes('Pozostałe');
        
        // Formatuj każdą część
        const formattedParts = parts.map((part, index) => {
            let formattedPart = part;
            
            // Pogrubienie odpowiednich części
            if (isLastRemaining) {
                // Jeśli ostatni to "Pozostałe", pogrubiamy ostatnie dwie części
                if (index >= lastIndex - 1) {
                    formattedPart = `<strong>${part}</strong>`;
                }
            } else {
                // W przeciwnym razie tylko ostatnią część
                if (index === lastIndex) {
                    formattedPart = `<strong>${part}</strong>`;
                }
            }
            
            return formattedPart;
        });
        
        // Połącz z <br> zamiast →
        return formattedParts.join('<br>');
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
                    this.lastUpdate.textContent = data.database.lastSync || 'Nieznana';
                }
                
                // Pobierz też dane o sankcjach i kontroli SANEPID
                this.fetchAdditionalStats();
            } else {
                this.apiStatus.textContent = 'Błąd ✗';
                this.apiStatus.style.color = '#dc3545';
            }
        } catch {
            this.apiStatus.textContent = 'Brak połączenia';
            this.apiStatus.style.color = '#dc3545';
        }
    }

    async fetchAdditionalStats() {
        try {
            const [sanctionsRes, controlledRes] = await Promise.all([
                fetch(`${this.apiBaseUrl}/sanctions`),
                fetch(`${this.apiBaseUrl}/controlled`)
            ]);
            
            const sanctionsData = await sanctionsRes.json();
            const controlledData = await controlledRes.json();
            
            // Możesz dodać te informacje gdzieś w UI jeśli chcesz
            if (sanctionsData.success) {
                console.log(`Aktualne sankcje: ${sanctionsData.totalCodes} kodów`);
            }
            if (controlledData.success) {
                console.log(`Aktualna kontrola SANEPID: ${controlledData.totalCodes} kodów`);
            }
        } catch (error) {
            console.log('Nie udało się pobrać dodatkowych statystyk:', error);
        }
    }

    async verify() {
        let code = this.hsCodeInput.value.trim();
        
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
        console.log('Dane z API:', data);
        
        // Ustaw kod HS - dodajemy nierozłączną spację przed wartością
        const codeElement = document.getElementById('result-code');
        // Używamy nierozłącznej spacji (U+00A0) aby była zawsze widoczna
        codeElement.innerHTML = `&nbsp;${data.code}`;
        
        // Wyświetl sformatowany opis lub zwykły
        const descElement = document.getElementById('result-desc');
        if (data.formattedDescription) {
            descElement.innerHTML = `&nbsp;${data.formattedDescription}`;
        } else if (data.description) {
            // Jeśli backend nie dostarczył sformatowanego opisu, sformatuj go na froncie
            descElement.innerHTML = `&nbsp;${this.formatDescription(data.description)}`;
        } else {
            descElement.textContent = '';
        }
        
        const statusEl = document.getElementById('result-status');
        let statusText = '';
        
        // Ustaw status weryfikacji
        if (data.specialStatus) {
            // Kod sankcyjny lub pod kontrolą SANEPID
            if (data.specialStatus === 'SANKCJE') {
                statusText = 'SANKCJE';
                statusEl.className = 'sanctioned';
            } else if (data.specialStatus === 'SANEPID') {
                statusText = 'SANEPID';
                statusEl.className = 'controlled-status';
            }
        } else if (data.isGeneralCode) {
            statusText = 'KOD OGÓLNY';
            statusEl.className = 'general';
        } else if (data.isValid) {
            statusText = 'POPRAWNY';
            statusEl.className = 'valid';
        } else {
            statusText = 'NIEPOPRAWNY';
            statusEl.className = 'invalid';
        }
        
        // Dodaj nierozłączną spację przed statusem
        statusEl.innerHTML = `&nbsp;${statusText}`;
        
        if ((data.isSingleSubcode || data.isExtendedFromPrefix) && data.originalCode) {
            this.extendedCodeSpan.innerHTML = `&nbsp;${data.originalCode} → ${data.code}`;
            this.extendedCodeInfo.classList.remove('hidden');
        } else {
            this.extendedCodeInfo.classList.add('hidden');
        }
        
        // Obsługa ostrzeżeń sankcyjnych
        if (data.sanctioned) {
            console.log('Wyświetlam ostrzeżenie sankcyjne dla kodu:', data.code);
            this.sanctionWarningTop.classList.remove('hidden');
            if (data.sanctionMessage) {
                document.getElementById('sanction-message').textContent = data.sanctionMessage;
            }
        } else {
            this.sanctionWarningTop.classList.add('hidden');
        }
        
        // Obsługa ostrzeżeń kontroli SANEPID
        if (data.controlled) {
            console.log('Wyświetlam ostrzeżenie kontroli SANEPID dla kodu:', data.code);
            this.controlledWarningTop.classList.remove('hidden');
            if (data.controlMessage) {
                document.getElementById('controlled-message').textContent = data.controlMessage;
            }
        } else {
            this.controlledWarningTop.classList.add('hidden');
        }
        
        // Jeśli oba ostrzeżenia są widoczne, ukryj SANEPID (sankcyjne ma pierwszeństwo)
        if (data.sanctioned && data.controlled) {
            this.controlledWarningTop.classList.add('hidden');
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