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
        document.getElementById('copyEmailBtn').addEventListener('click', () => this.copyResultForEmail());
    }

    // Nowa metoda do kopiowania wyniku do schowka (dla e-maila)
    copyResultForEmail() {
        // Pobierz aktualnie wyświetlane dane
        const code = document.getElementById('result-code').innerText.trim();
        const description = document.getElementById('result-desc').innerHTML; // może zawierać <br>
        const status = document.getElementById('result-status').innerText.trim();
        
        // Sprawdź, czy wyświetlono ostrzeżenia
        const sanctionVisible = !this.sanctionWarningTop.classList.contains('hidden');
        const controlledVisible = !this.controlledWarningTop.classList.contains('hidden');
        
        // Pobierz treść ostrzeżeń (jeśli widoczne)
        let sanctionHtml = '';
        if (sanctionVisible) {
            const sanctionMsg = document.getElementById('sanction-message')?.innerText || 'UWAGA: Towar sankcyjny - sprawdź obowiązujące ograniczenia!';
            sanctionHtml = `
                <div style="color: #dc3545; font-family: Calibri, sans-serif; font-size: 11pt; margin-bottom: 8px;">
                    <strong>⚠️ ${sanctionMsg}</strong><br>
                    <span style="font-weight: normal;">Ten kod HS podlega specjalnym regulacjom i ograniczeniom w handlu międzynarodowym.</span>
                </div>
            `;
        }
        
        let controlledHtml = '';
        if (controlledVisible) {
            const controlledMsg = document.getElementById('controlled-message')?.innerText || 'UWAGA: Towar podlega kontroli SANEPID!';
            controlledHtml = `
                <div style="color: #2196f3; font-family: Calibri, sans-serif; font-size: 11pt; margin-bottom: 8px;">
                    <strong>📋 ${controlledMsg}</strong><br>
                    <span style="font-weight: normal;">Wymagane dokumenty sanitarne: świadectwo weterynaryjne, certyfikat fitosanitarny.</span>
                </div>
            `;
        }
        
        // Jeśli oba ostrzeżenia, pokaż tylko sankcyjne (zgodnie z logiką)
        if (sanctionVisible && controlledVisible) {
            controlledHtml = '';
        }
        
        // Rozszerzony kod (jeśli występuje)
        let extendedHtml = '';
        if (!this.extendedCodeInfo.classList.contains('hidden')) {
            const extendedText = this.extendedCodeSpan.innerText;
            extendedHtml = `<div style="font-family: Calibri, sans-serif; font-size: 11pt; margin-top: 8px;"><strong>Pełny kod 10-cyfrowy:</strong> ${extendedText}</div>`;
        }
        
        // Przygotuj pełny HTML do skopiowania
        const emailHtml = `
            <div style="font-family: Calibri, sans-serif; font-size: 11pt;">
                ${sanctionHtml}
                ${controlledHtml}
                <div><strong>Kod HS:</strong> ${code}</div>
                <div><strong>Opis towaru:</strong> ${description}</div>
                <div><strong>Status weryfikacji:</strong> <span style="color: ${this.getStatusColor(status)};">${status}</span></div>
                ${extendedHtml}
            </div>
        `;
        
        // Skopiuj do schowka jako HTML (działa w większości nowoczesnych przeglądarek)
        navigator.clipboard.write([
            new ClipboardItem({
                'text/html': new Blob([emailHtml], { type: 'text/html' }),
                'text/plain': new Blob([this.stripHtml(emailHtml)], { type: 'text/plain' })
            })
        ]).then(() => {
            alert('Skopiowano do schowka w formacie odpowiednim dla e-maila (Calibri 11pt).');
        }).catch(err => {
            console.error('Błąd kopiowania:', err);
            alert('Nie udało się skopiować automatycznie. Możesz zaznaczyć tekst ręcznie.');
        });
    }
    
    // Pomocnicza funkcja do określenia koloru statusu
    getStatusColor(status) {
        if (status === 'SANKCJE' || status === 'NIEPOPRAWNY') return '#dc3545';
        if (status === 'SANEPID') return '#2196f3';
        if (status === 'KOD OGÓLNY') return '#152a5e';
        if (status === 'POPRAWNY') return '#28a745';
        return '#000000';
    }
    
    // Usuwa tagi HTML, zostawia czysty tekst (dla wersji plain text)
    stripHtml(html) {
        const div = document.createElement('div');
        div.innerHTML = html;
        return div.textContent || div.innerText || '';
    }

    // ... reszta metod (formatInput, formatDescription, checkAPI, fetchAdditionalStats, verify, displayResult, showLoading)
    // pozostaje bez zmian – patrz poprzednia wersja, ale uzupełniam poniżej dla kompletności

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
        const isLastRemaining = parts[lastIndex].includes('Pozostałe');
        const formattedParts = parts.map((part, index) => {
            let formattedPart = part;
            if (isLastRemaining) {
                if (index >= lastIndex - 1) {
                    formattedPart = `<strong>${part}</strong>`;
                }
            } else {
                if (index === lastIndex) {
                    formattedPart = `<strong>${part}</strong>`;
                }
            }
            return formattedPart;
        });
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
                headers: { 'Content-Type': 'application/json' },
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
        const codeElement = document.getElementById('result-code');
        codeElement.innerHTML = `&nbsp;${data.code}`;
        
        const descElement = document.getElementById('result-desc');
        if (data.formattedDescription) {
            descElement.innerHTML = `&nbsp;${data.formattedDescription}`;
        } else if (data.description) {
            descElement.innerHTML = `&nbsp;${this.formatDescription(data.description)}`;
        } else {
            descElement.textContent = '';
        }
        
        const statusEl = document.getElementById('result-status');
        let statusText = '';
        if (data.specialStatus) {
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
        statusEl.innerHTML = `&nbsp;${statusText}`;
        
        // Kolory inline dla statusu
        if (statusEl.className === 'sanctioned' || statusEl.className === 'invalid') {
            statusEl.style.color = '#dc3545';
        } else if (statusEl.className === 'controlled-status') {
            statusEl.style.color = '#2196f3';
        } else if (statusEl.className === 'general') {
            statusEl.style.color = '#152a5e';
        } else if (statusEl.className === 'valid') {
            statusEl.style.color = '#28a745';
        }
        
        if ((data.isSingleSubcode || data.isExtendedFromPrefix) && data.originalCode) {
            this.extendedCodeSpan.innerHTML = `&nbsp;${data.originalCode} → ${data.code}`;
            this.extendedCodeInfo.classList.remove('hidden');
        } else {
            this.extendedCodeInfo.classList.add('hidden');
        }
        
        // Obsługa ostrzeżeń
        if (data.sanctioned) {
            this.sanctionWarningTop.classList.remove('hidden');
            if (data.sanctionMessage) {
                document.getElementById('sanction-message').textContent = data.sanctionMessage;
            }
        } else {
            this.sanctionWarningTop.classList.add('hidden');
        }
        
        if (data.controlled) {
            this.controlledWarningTop.classList.remove('hidden');
            if (data.controlMessage) {
                document.getElementById('controlled-message').textContent = data.controlMessage;
            }
        } else {
            this.controlledWarningTop.classList.add('hidden');
        }
        
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

// Inicjalizacja po załadowaniu DOM
document.addEventListener('DOMContentLoaded', () => {
    new HSCodeVerifier();
});