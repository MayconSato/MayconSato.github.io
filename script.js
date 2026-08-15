// ==================================================================
// CONFIGURAÇÕES GLOBAIS (VARIÁVEIS) E ESTADO
// ==================================================================
// ⚠️ ATENÇÃO: Substitua pela URL gerada no seu Google Apps Script
const GOOGLE_SHEETS_URL = "https://script.google.com/macros/s/AKfycbyWvQ8Anvus1la6b58rb0PDCB5miiiYo0gVUevofddG8Sm1owo20hx1cZXm-9AX8ivVNA/exec";

let selectedElement = null;
let selectedName = '';
let currentIdCounter = 1;
let timerInterval = null;
let dashInterval = null;
let syncTimeout = null; // Controle anti-spam para o Google Sheets

const MAX_RED_PALLETS = 10;
const MAX_YELLOW_PALLETS = 6;
const MAX_GREEN_PALLETS = 12;

let palletMUs = {};
const palletLocation = {};

const LANE_CODES = {
    'RUA A': 'R-A', 'RUA B': 'R-B', 'RUA C': 'R-C', 
    'RUA D': 'R-D', 'RUA E': 'R-E'
};

const LISTA_ERROS_PADRAO = [
    'Audit', 'Cubing', 'Montagem de Hu', 'Sor', 'P2M', 'Checkin',
    'Usuário Travado', 'Transfer Volume', 'Viagem em Curso',
    'Despacho em HU', 'Vincular em HU', 'Invoincing', 'Decating', 'Saldo em outro CAD'
];

let dadosHistorico = [];
let muSelecionadaGlobal = null;
let paleteAtualGlobal = null;

// ==================================================================
// COMUNICAÇÃO COM GOOGLE SHEETS (O NOVO BANCO DE DADOS)
// ==================================================================

// Função para BUSCAR dados (GET)
async function fetchDatabase(action) {
    try {
        const response = await fetch(`${GOOGLE_SHEETS_URL}?action=${action}`);
        return await response.json();
    } catch (error) {
        console.error(`Erro ao buscar [${action}] no Sheets:`, error);
        return null;
    }
}

// Função para SALVAR dados (POST) - Roda em background (Fire-and-forget)
function saveDatabase(action, data) {
    fetch(GOOGLE_SHEETS_URL, {
        method: 'POST',
        mode: 'no-cors', // Evita bloqueios de CORS no envio silencioso
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ action: action, data: JSON.stringify(data) }).toString()
    }).catch(e => console.error(`Erro ao salvar [${action}]:`, e));
}

// ==================================================================
// 1. INICIALIZAÇÃO CENTRALIZADA (DOM CONTENT LOADED)
// ==================================================================
document.addEventListener('DOMContentLoaded', async () => {
    // Proteção de Interface
    document.body.removeAttribute('contenteditable');
    const protectedSelectors = 'h1, h2, h3, h4, h5, h6, span, p, label, .zone-header, .lane-title, .app-drawer h2, .main-navbar';
    document.querySelectorAll(protectedSelectors).forEach(el => el.contentEditable = "false");

    // Tema e Sessão (Mantidos localmente pois são config do dispositivo do usuário)
    const temaSalvo = localStorage.getItem('wms_current_theme') || 'dark';
    mudarTema(temaSalvo);
    verificarStatusSessao();

    // Mapeamento de Eventos (Botões)
    mapearEventosGlobais();

    // Carregamento de Estado do Layout via Google Sheets
    if (obterUsuarioAtual() !== 'Nenhum operador logado') {
        await carregarEstadoGeral();
    }
    
    // Telas Específicas
    if (document.getElementById('history-table-body')) {
        await carregarDadosDoSheets();
        carregarHistoricoComMedias();
    }
    
    if (document.getElementById('kpi-ocupacao-pendentes-perc') || document.getElementById('graficoErros')) {
        atualizarDashboard();
        if (dashInterval) clearInterval(dashInterval);
        dashInterval = setInterval(atualizarDashboard, 5000);
    }
});

function mapearEventosGlobais() {
    const btnSearch = document.querySelector('.btn-search');
    if (btnSearch) btnSearch.addEventListener('click', realizarConsulta);

    const inputSearch = document.getElementById('search-input');
    if (inputSearch) inputSearch.addEventListener('keypress', (e) => { if (e.key === 'Enter') realizarConsulta(); });

    const btnRemover = document.querySelector('.action-buttons .btn-action.danger');
    if (btnRemover) btnRemover.addEventListener('click', removerMUAtual);

    const btnMover = document.querySelector('.action-buttons .btn-action.primary');
    if (btnMover) btnMover.addEventListener('click', moverMUAtual);

    const btnAlterarStatus = document.getElementById('btn-alterar-status');
    if (btnAlterarStatus) btnAlterarStatus.addEventListener('click', alterarStatusMUAtual);

    const btnSelecionarErros = document.getElementById('btn-selecionar-erros');
    if (btnSelecionarErros) btnSelecionarErros.addEventListener('click', abrirModalSelecaoErros);
}

// ==================================================================
// 2. GERENCIAMENTO DE AUTENTICAÇÃO (VIA SHEETS)
// ==================================================================
function verificarStatusSessao() {
    const usuarioAtivo = localStorage.getItem('usuario_ativo_wms');
    const authContainer = document.getElementById('auth-system-container');

    if (usuarioAtivo && authContainer) {
        authContainer.style.display = 'none';
    } else if (authContainer) {
        authContainer.style.display = 'flex';
    }
}

function switchAuthTab(tabName, event) {
    document.querySelectorAll('.auth-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));

    const targetTab = document.getElementById(`tab-${tabName}`);
    if (targetTab) targetTab.classList.add('active');
    
    if (event && event.currentTarget) event.currentTarget.classList.add('active');
    if (tabName === 'status') atualizarStatusSessaoUI();
}

async function realizarCadastro(event) {
    event.preventDefault();
    const nome = document.getElementById('reg-fullname').value.trim();
    const usuario = document.getElementById('reg-username').value.trim().toLowerCase();
    const senha = document.getElementById('reg-password').value.trim();

    if (!nome || !usuario || !senha) return exibirToast('error', 'Erro', 'Preencha todos os campos.');

    exibirToast('info', 'Aguarde', 'Verificando banco de dados...', 2000);
    
    let usuarios = await fetchDatabase('get_usuarios') || [];

    if (usuarios.some(u => u.usuario === usuario)) {
        return exibirToast('warning', 'Usuário duplicado', 'Este usuário já está cadastrado!');
    }

    usuarios.push({ nome, usuario, senha });
    saveDatabase('save_usuarios', usuarios);

    exibirToast('success', 'Cadastro concluído', `Operador "${nome}" cadastrado com sucesso!`);
    document.getElementById('auth-register-form').reset();
    switchAuthTab('login', null);
}

async function realizarLogin(event) {
    event.preventDefault();
    const usuarioInput = document.getElementById('login-username').value.trim().toLowerCase();
    const senhaInput = document.getElementById('login-password').value.trim();

    exibirToast('info', 'Aguarde', 'Autenticando...', 2000);
    
    let usuarios = await fetchDatabase('get_usuarios') || [];

    if (usuarios.length === 0) {
        usuarios.push({ nome: "Admin WMS", usuario: "admin", senha: "123" });
        saveDatabase('save_usuarios', usuarios);
    }

    const auth = usuarios.find(u => u.usuario === usuarioInput && u.senha === senhaInput);

    if (auth) {
        const dadosSessao = `${auth.nome} (${auth.usuario})`;
        localStorage.setItem('usuario_ativo_wms', dadosSessao);
        localStorage.setItem('wms_login_timestamp', Date.now());
        
        document.getElementById('auth-system-container').style.display = 'none';
        exibirToast('success', 'Login bem-sucedido', `Bem-vindo, ${auth.nome}!`);
        await carregarEstadoGeral();
    } else {
        exibirToast('error', 'Falha de autenticação', 'Usuário ou senha incorretos!');
    }
}

function atualizarStatusSessaoUI() {
    const statusEl = document.getElementById('auth-status-user');
    if (statusEl) statusEl.innerHTML = `👤 <strong>Usuário Ativo:</strong> ${obterUsuarioAtual()}`;
}

function realizarLogout() {
    if (confirm('Deseja realmente encerrar a sessão?')) {
        localStorage.removeItem('usuario_ativo_wms');
        localStorage.removeItem('wms_login_timestamp');
        location.reload(); 
    }
}

// ==================================================================
// 3. CONFIGURAÇÕES E TIMERS
// ==================================================================
function abrirConfiguracoes() {
    const modal = document.getElementById('config-modal');
    if (modal) { modal.style.display = 'flex'; carregarDadosConfiguracao(); }
}

function fecharConfiguracoes() {
    const modal = document.getElementById('config-modal');
    if (modal) modal.style.display = 'none';
}

function carregarDadosConfiguracao() {
    const nomeEl = document.getElementById('cfg-user-name');
    if (nomeEl) nomeEl.innerText = obterUsuarioAtual();

    if (!localStorage.getItem('wms_login_timestamp')) localStorage.setItem('wms_login_timestamp', Date.now());

    if (timerInterval) clearInterval(timerInterval);
    atualizarCronometroSessao();
    timerInterval = setInterval(atualizarCronometroSessao, 1000);
}

function atualizarCronometroSessao() {
    const loginTime = parseInt(localStorage.getItem('wms_login_timestamp')) || Date.now();
    const diffMs = Math.max(0, Date.now() - loginTime);
    const s = Math.floor(diffMs / 1000);
    const timeStr = `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    const timerEl = document.getElementById('cfg-session-timer');
    if (timerEl) timerEl.innerText = timeStr;
}

function mudarTema(tema) {
    document.body.classList.remove('theme-dark', 'theme-light', 'theme-meli');
    document.body.classList.add(`theme-${tema}`);
    localStorage.setItem('wms_current_theme', tema);
}

async function alterarSenhaOperador(event) {
    event.preventDefault();
    const senhaAntiga = document.getElementById('cfg-old-pass').value.trim();
    const senhaNova = document.getElementById('cfg-new-pass').value.trim();
    const sessaoCompleta = localStorage.getItem('usuario_ativo_wms');

    if (!sessaoCompleta) return exibirToast('error', 'Erro', 'Sessão inválida.');
    const matchUser = sessaoCompleta.match(/\(([^)]+)\)$/);
    if (!matchUser) return exibirToast('error', 'Erro', 'Identificação falhou.');
    
    exibirToast('info', 'Aguarde', 'Atualizando no servidor...');
    let usuarios = await fetchDatabase('get_usuarios') || [];
    const idx = usuarios.findIndex(u => u.usuario === matchUser[1]);

    if (idx !== -1 && usuarios[idx].senha === senhaAntiga) {
        usuarios[idx].senha = senhaNova;
        saveDatabase('save_usuarios', usuarios);
        exibirToast('success', 'Sucesso', 'Senha alterada!');
        document.getElementById('cfg-old-pass').value = ''; document.getElementById('cfg-new-pass').value = '';
    } else {
        exibirToast('error', 'Erro', 'Senha atual incorreta.');
    }
}

// ==================================================================
// 4. FEEDBACK VISUAL
// ==================================================================
function exibirToast(tipo, titulo, mensagem, tempo = 3500) {
    const toastStack = document.getElementById('toast-stack');
    if (!toastStack) return;

    const toast = document.createElement('div');
    toast.className = `toast-item ${tipo}`;
    toast.innerHTML = `<span class="toast-title">${titulo}</span><span class="toast-message">${mensagem}</span>`;
    toastStack.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 300);
    }, tempo);
}

function obterUsuarioAtual() {
    return localStorage.getItem('usuario_ativo_wms') || 'Nenhum operador logado';
}

// ==================================================================
// 5. PERSISTÊNCIA DE MAPA E LAYOUT (NO GOOGLE SHEETS)
// ==================================================================
function salvarEstadoGeral() {
    // Debounce: Aguarda 1 segundo após a última ação para enviar ao servidor (evita travamentos)
    if (syncTimeout) clearTimeout(syncTimeout);
    
    syncTimeout = setTimeout(() => {
        const palletsData = Array.from(document.querySelectorAll('.pallet')).map(p => ({
            id: p.id,
            text: p.innerText,
            className: p.className,
            parentId: p.parentElement.id || p.parentElement.getAttribute('data-lane') || ''
        }));
        
        const payload = {
            palletMUs: palletMUs,
            currentIdCounter: currentIdCounter,
            layout: palletsData
        };
        
        saveDatabase('save_layout', payload);
        chamarDashboardBackground();
    }, 1000); 
}

async function carregarEstadoGeral() {
    const toastInfo = document.getElementById('toast-stack');
    if (toastInfo) exibirToast('info', 'Sincronização', 'Baixando mapa do servidor...', 2000);
    
    const db = await fetchDatabase('get_layout');
    
    if (db) {
        palletMUs = db.palletMUs || {};
        currentIdCounter = db.currentIdCounter || 1;
        const savedLayout = db.layout || null;

        if (savedLayout) {
            document.querySelectorAll('.pallet').forEach(p => p.remove());

            savedLayout.forEach(data => {
                let parent = document.getElementById(data.parentId) || document.querySelector(`[data-lane="${data.parentId}"]`);
                if (!parent) return;

                const p = document.createElement('div');
                p.id = data.id; p.innerText = data.text; p.className = data.className;
                p.draggable = true;
                p.setAttribute('ondragstart', 'drag(event)');
                const nomePainel = data.text.includes('PL') ? data.text : `Pallet ${data.text}`;
                p.setAttribute('onclick', `selectPalletElement(this, '${nomePainel}')`);
                parent.appendChild(p);
            });
        }
    }
    updateRedCounter();
}

// ==================================================================
// 6. REGRAS DE DRAG & DROP E VALIDAÇÕES
// ==================================================================
function validarMovimentacaoPallet(pallet, zonaDestino) {
    if (!pallet) return { ok: false, motivo: 'Palete inválido.' };
    const isRed = pallet.classList.contains('red');
    const isYellowNoId = pallet.classList.contains('yellow-no-id');
    const isYellowChecked = pallet.classList.contains('yellow-checked');
    const isBlue = pallet.classList.contains('blue');
    const isGreen = pallet.classList.contains('green');

    switch (zonaDestino) {
        case 'amarela': return (isRed || isGreen) ? { ok: true } : { ok: false, motivo: 'Apenas paletes vermelhos ou verdes podem ir para triagem.' };
        case 'rua':
            if (isYellowChecked || isBlue || isGreen) return { ok: true };
            if (isYellowNoId) return { ok: false, motivo: 'Faça a Checagem HH antes de enviar para a rua.' };
            return { ok: false, motivo: 'Paletes vermelhos devem passar pela triagem antes da rua.' };
        case 'verde': return isBlue ? { ok: true } : { ok: false, motivo: 'Apenas paletes com ID (Azul) podem ir para expedição.' };
        default: return { ok: false, motivo: 'Zona desconhecida.' };
    }
}

function allowDrop(event) {
    event.preventDefault();
    if(event.currentTarget.classList) event.currentTarget.classList.add('drag-over');
}

function drag(event) {
    event.dataTransfer.setData("text/plain", event.target.id);
    event.target.classList.add('dragging');
}

function clearDragEffects() {
    document.querySelectorAll('.drag-over, .dragging').forEach(el => el.classList.remove('drag-over', 'dragging'));
}

document.addEventListener('dragend', () => { clearDragEffects(); salvarEstadoGeral(); });
document.addEventListener('dragleave', (e) => {
    if (e.target.classList && (e.target.classList.contains('pallet-row') || e.target.classList.contains('street-lane') || e.target.classList.contains('zone-container'))) {
        e.target.classList.remove('drag-over');
    }
});

// Ações de Drop
function dropPalletRed(event, redContainer) {
    event.preventDefault(); clearDragEffects();
    const p = document.getElementById(event.dataTransfer.getData("text/plain"));
    if (!p || p.parentElement === redContainer) return;
    if (redContainer.children.length >= MAX_RED_PALLETS) return exibirToast('warning', 'Aviso', 'Zona Vermelha cheia.');
    if (confirm(`⚠️ Retornar palete "${p.innerText}" para a Zona Vermelha reseta as MUs. Confirma?`)) {
        delete palletMUs[p.id];
        p.className = 'pallet red'; p.innerText = `P${String(getNextAvailableRedNumber()).padStart(2, '0')}`;
        redContainer.appendChild(p);
        updateRedCounter(); salvarEstadoGeral(); updateStatus(`🔴 <strong>Palete retornado.</strong>`);
    }
}

function dropPalletYellow(event, yellowContainer) {
    event.preventDefault(); clearDragEffects();
    const p = document.getElementById(event.dataTransfer.getData('text/plain'));
    if (!p) return;
    if (yellowContainer.querySelectorAll('.pallet').length >= MAX_YELLOW_PALLETS) return exibirToast('info', 'Aviso', 'Zona Amarela cheia.');
    const val = validarMovimentacaoPallet(p, 'amarela');
    if (!val.ok) return exibirToast('warning', 'Bloqueado', val.motivo);

    if (p.classList.contains('green')) {
        const inputPL = prompt(`📦 PL retornando:\n(Confirme: ${p.innerText})`);
        if (inputPL !== p.innerText.trim()) return exibirToast('error', 'Erro', 'ID não confere.');
        p.className = 'pallet yellow-checked'; p.innerText = 'Check';
    } else {
        p.className = 'pallet yellow-no-id'; p.innerText = 'No ID';
    }
    yellowContainer.appendChild(p); updateRedCounter(); salvarEstadoGeral();
}

function dropPallet(event, laneElement) {
    event.preventDefault(); clearDragEffects();
    const p = document.getElementById(event.dataTransfer.getData('text/plain'));
    if (!p) return;
    const val = validarMovimentacaoPallet(p, 'rua');
    if (!val.ok) return exibirToast('warning', 'Bloqueado', val.motivo);
    if (laneElement.querySelectorAll('.pallet').length >= 6 && !laneElement.contains(p)) return exibirToast('info', 'Aviso', 'Rua cheia.');

    const targetCode = laneElement.getAttribute('data-lane') || laneElement.closest('.street-lane').querySelector('.lane-title').innerText;
    if (p.classList.contains('yellow-checked') || p.classList.contains('green') || p.closest('.street-lane')) {
        const confirmRua = prompt(`🚚 Confirme a rua de destino:`, targetCode);
        if (!confirmRua || confirmRua.toUpperCase().trim() !== targetCode.toUpperCase().trim()) return exibirToast('error', 'Erro', 'Rua não validada.');
    }
    p.className = 'pallet blue';
    if(p.innerText === 'Check' || p.innerText === 'No ID') p.innerText = `PL-${String(currentIdCounter++).padStart(2, '0')}`;
    laneElement.appendChild(p); updateRedCounter(); salvarEstadoGeral();
}

function dropPalletGreen(event, greenContainer) {
    event.preventDefault(); clearDragEffects();
    const p = document.getElementById(event.dataTransfer.getData('text/plain'));
    if (!p) return;
    const val = validarMovimentacaoPallet(p, 'verde');
    if (!val.ok) return exibirToast('warning', 'Bloqueado', val.motivo);
    if (greenContainer.querySelectorAll('.pallet').length >= MAX_GREEN_PALLETS) return exibirToast('info', 'Aviso', 'Expedição cheia.');
    if (confirm(`✅ Liberar ${p.innerText} para expedição?`)) {
        p.className = 'pallet green'; greenContainer.appendChild(p); updateRedCounter(); salvarEstadoGeral();
    }
}

// ==================================================================
// 7. AÇÕES INFERIORES E PALETES
// ==================================================================
function selectPalletElement(element, name) {
    if (!element) return;
    document.querySelectorAll('.pallet.selected').forEach(el => el.classList.remove('selected'));
    selectedElement = element; selectedName = name; selectedElement.classList.add('selected');
    const mus = palletMUs[element.id] || [];
    updateStatus(`📦 <strong>Palete:</strong> <span style="color:#38bdf8">${element.innerText}</span><br>📊 <strong>MUs:</strong> ${mus.length}/30<br><small>${mus.length > 0 ? mus.join(', ') : 'Vazio'}</small>`);
}

function updateStatus(htmlContent) {
    const statusElement = document.getElementById('app-status');
    if (statusElement) statusElement.innerHTML = htmlContent;
}

function triggerAction(actionName) {
    if (!selectedElement) return exibirToast('info', 'Atenção', 'Selecione um palete primeiro.');
    const elId = selectedElement.id;

    if (actionName === 'Checagem HH') {
        if (!selectedElement.classList.contains('yellow-no-id')) return exibirToast('warning', 'Aviso', 'Selecione palete Laranja.');
        selectedElement.className = 'pallet yellow-checked selected'; selectedElement.innerText = 'Check';
        palletMUs[elId] = []; updateStatus('🟡 <strong>Checagem concluída.</strong>');
    }
    else if (actionName === 'Cadastrar MU') {
        if (!selectedElement.classList.contains('yellow-checked')) return exibirToast('error', 'Erro', 'Faça Checagem HH primeiro.');
        if (!palletMUs[elId]) palletMUs[elId] = [];
        while (palletMUs[elId].length < 30) {
            let inputMU = prompt(`📦 [BIPAGEM]\nMUs: ${palletMUs[elId].length}/30\nBipe a MU (16 caracteres, inicia com MU):`);
            if (!inputMU) break;
            inputMU = inputMU.trim().toUpperCase();
            if (!inputMU.startsWith('MU') || inputMU.length !== 16) alert('Formato inválido!');
            else if (palletMUs[elId].includes(inputMU)) alert('MU já bipada!');
            else palletMUs[elId].push(inputMU);
        }
        updateStatus(`📦 <strong>MUs:</strong> ${palletMUs[elId].length}/30`);
    }
    else if (actionName === 'Despachar PL') {
        if (!selectedElement.classList.contains('green')) return exibirToast('error', 'Erro', 'Apenas paletes verdes na expedição podem ser despachados.');
        const m = palletMUs[elId] || [];
        if (m.length === 0) return exibirToast('warning', 'Erro', 'Palete sem MUs.');

        if (confirm(`🚚 Despachar ${selectedElement.innerText}?`)) {
            const payload = m.map(mu => ({
                dataDespacho: new Date().toLocaleString('pt-BR'), 
                palletID: selectedElement.innerText, 
                mu: mu, acoesFeitas: 1, tempoNoBuffer: '0m', usuario: obterUsuarioAtual()
            }));

            // Adiciona histórico no banco Sheets
            saveDatabase('save_historico', payload);

            delete palletMUs[elId];
            selectedElement.remove();
            selectedElement = null;
            updateStatus('🟢 <strong>Despachado!</strong>');
        }
    }
    salvarEstadoGeral();
}

function getNextAvailableRedNumber() {
    const stack = document.getElementById('red-stack');
    if (!stack) return 1;
    const used = Array.from(stack.children).map(p => parseInt(p.innerText.replace(/\D/g, '')) || 0);
    for (let i = 1; i <= MAX_RED_PALLETS; i++) if (!used.includes(i)) return i;
    return null;
}
function addRedPallet() {
    const stack = document.getElementById('red-stack');
    if (!stack || stack.children.length >= MAX_RED_PALLETS) return;
    const num = getNextAvailableRedNumber(); if (!num) return;
    const p = document.createElement('div'); p.className = 'pallet red'; p.id = `pallet-${Date.now()}`;
    p.draggable = true; p.innerText = `P${String(num).padStart(2, '0')}`;
    p.setAttribute('ondragstart', 'drag(event)'); p.setAttribute('onclick', `selectPalletElement(this, '${p.innerText}')`);
    stack.appendChild(p); updateRedCounter(); salvarEstadoGeral();
}
function removeRedPallet() {
    const stack = document.getElementById('red-stack');
    if (!stack || stack.children.length === 0) return;
    const last = stack.lastElementChild; delete palletMUs[last.id];
    if (selectedElement === last) selectedElement = null;
    stack.removeChild(last); updateRedCounter(); salvarEstadoGeral();
}
function updateRedCounter() {
    const count = document.getElementById('red-count'), stack = document.getElementById('red-stack');
    if (count && stack) count.innerText = stack.children.length;
}

// ==================================================================
// 8. DASHBOARD E MODAIS
// ==================================================================
function chamarDashboardBackground() { if (document.getElementById('kpi-ocupacao-pendentes-perc')) atualizarDashboard(); }
function atualizarDashboard() {
    const red = document.getElementById('red-stack')?.children.length || 0;
    const yel = document.getElementById('yellow-stack')?.children.length || 0;
    const grn = document.querySelector('.green-zone')?.querySelectorAll('.pallet').length || 0;
    let sts = 0; document.querySelectorAll('.street-lane').forEach(l => sts += l.querySelectorAll('.pallet').length);
    const renderBar = (id, ocup, max) => {
        const pEl = document.getElementById(`${id}-perc`), bEl = document.getElementById(`${id}-bar`);
        if(pEl && bEl) { const val = Math.min(100, Math.round((ocup/max)*100)); pEl.innerText = `${val}%`; bEl.style.width = `${val}%`; }
    };
    renderBar('kpi-ocupacao-pendentes', red, MAX_RED_PALLETS); renderBar('kpi-ocupacao-triagem', yel, MAX_YELLOW_PALLETS);
    renderBar('kpi-ocupacao-ruas', sts, 30); renderBar('kpi-ocupacao-expedicao', grn, MAX_GREEN_PALLETS);
}

document.addEventListener('dblclick', (event) => {
    const el = event.target.closest('.pallet'); if (!el) return;
    const mus = palletMUs[el.id] || [];
    document.getElementById('modal-title').innerText = `Resumo: ${el.innerText}`;
    document.getElementById('modal-content').innerHTML = `MUs: ${mus.length}/30<br><br>${mus.join('<br>') || 'Vazio'}`;
    document.getElementById('pallet-modal').style.display = 'flex';
});
function fecharModalPalete() { const modal = document.getElementById('pallet-modal'); if(modal) modal.style.display = 'none'; }

// ==================================================================
// 9. CONSULTA E HISTÓRICO
// ==================================================================
async function realizarConsulta() {
    const input = document.getElementById('search-input')?.value.trim().toUpperCase();
    if (!input) return exibirToast('warning', 'Aviso', 'Pesquisa vazia.');
    exibirToast('info', 'Buscando...', 'Verificando o banco de dados.', 1500);

    const db = await fetchDatabase('get_layout');
    if (!db) return exibirToast('error', 'Erro', 'Falha na conexão.');

    const layoutRemoto = db.layout || [];
    const muRemoto = db.palletMUs || {};

    let idFound = null, nameFound = "", mus = [], loc = "Desconhecido";

    if (input.startsWith('PL') || input.startsWith('P')) {
        const item = layoutRemoto.find(p => p.text.toUpperCase() === input);
        if (item) { idFound = item.id; nameFound = item.text; mus = muRemoto[item.id] || []; loc = LANE_CODES[item.parentId] || item.parentId; }
    } else if (input.startsWith('MU')) {
        for (const [id, mArr] of Object.entries(muRemoto)) {
            if (mArr.includes(input)) {
                idFound = id; mus = mArr;
                const item = layoutRemoto.find(p => p.id === id);
                if (item) { nameFound = item.text; loc = LANE_CODES[item.parentId] || item.parentId; }
                break;
            }
        }
    }
    if (!idFound && mus.length === 0) return exibirToast('error', 'Não achado', 'Código não localizado no mapa.');
    renderizarTabelaPalete(idFound, nameFound, loc, mus, input);
}

function renderizarTabelaPalete(idInt, idPal, loc, mus, term) {
    const tbody = document.querySelector('.data-table tbody');
    document.querySelector('.card-header-flex h2').innerHTML = `📦 Palete: ${idPal}`;
    if (!tbody) return;
    tbody.innerHTML = mus.length ? mus.map(mu => `<tr class="${mu===term?'selected-row':''}">
        <td>${mu}</td><td>Liberado</td><td>${loc}</td>
        <td><button class="btn-table" onclick="selecionarMU('${mu}','${idInt}','${idPal}','${loc}')">Selecionar</button></td>
    </tr>`).join('') : `<tr><td colspan="4">Vazio</td></tr>`;
    if(mus.length && mus.includes(term)) selecionarMU(term, idInt, idPal, loc);
}
function selecionarMU(mu, idInt, idPal, loc) {
    muSelecionadaGlobal = mu; paleteAtualGlobal = { idInterno: idInt, idPalete: idPal, localizacao: loc };
    document.getElementById('detail-mu-code').innerText = mu;
    document.querySelectorAll('.action-buttons .btn-action').forEach(b => b.removeAttribute('disabled'));
}

function removerMUAtual() {
    if (!muSelecionadaGlobal) return;
    if (confirm(`Remover MU ${muSelecionadaGlobal}?`)) {
        palletMUs[paleteAtualGlobal.idInterno] = palletMUs[paleteAtualGlobal.idInterno].filter(m => m !== muSelecionadaGlobal);
        salvarEstadoGeral(); exibirToast('success', 'Removida', 'MU removida!'); realizarConsulta();
    }
}
function moverMUAtual() {
    if (!muSelecionadaGlobal) return;
    const dest = prompt('Destino (Ex: PL-02):')?.trim().toUpperCase();
    if (!dest || dest === paleteAtualGlobal.idPalete) return;
    
    // Procura no DOM atual (que está sincronizado)
    const destEl = Array.from(document.querySelectorAll('.pallet')).find(p => p.innerText.toUpperCase() === dest);
    if (!destEl) return exibirToast('error', 'Erro', 'Destino não encontrado no layout.');

    palletMUs[paleteAtualGlobal.idInterno] = palletMUs[paleteAtualGlobal.idInterno].filter(m => m !== muSelecionadaGlobal);
    if (!palletMUs[destEl.id]) palletMUs[destEl.id] = [];
    palletMUs[destEl.id].push(muSelecionadaGlobal);

    salvarEstadoGeral(); exibirToast('success', 'Sucesso', 'MU Movida!'); document.getElementById('search-input').value = dest; realizarConsulta();
}

function alterarStatusMUAtual() { if(muSelecionadaGlobal) exibirToast('success', 'Sucesso', 'Status alterado.'); }
function abrirModalSelecaoErros() {
    if(!muSelecionadaGlobal) return;
    const erro = prompt(`Erro (Ex: ${LISTA_ERROS_PADRAO[0]}):`);
    if(erro) exibirToast('warning', 'Erro Registrado', `Erro ${erro} na MU ${muSelecionadaGlobal}`);
}

async function carregarDadosDoSheets() {
    dadosHistorico = await fetchDatabase('get_historico') || [];
}
function carregarHistoricoComMedias() {
    const tbody = document.getElementById('history-table-body');
    if (!tbody) return;
    tbody.innerHTML = dadosHistorico.slice().reverse().map(r => `
        <tr><td>${r.mu}</td><td>${r.palletID||'-'}</td><td>${r.dataDespacho}</td><td>${r.usuario}</td></tr>
    `).join('');
}

// Exportações OBRIGATÓRIAS
Object.assign(window, {
    switchAuthTab, realizarCadastro, realizarLogin, abrirConfiguracoes, fecharConfiguracoes, mudarTema, 
    alterarSenhaOperador, realizarLogout, selectPalletElement, triggerAction, allowDrop, drag, addRedPallet, 
    removeRedPallet, dropPalletRed, dropPalletYellow, dropPallet, dropPalletGreen, fecharModalPalete, 
    realizarConsulta, removerMUAtual, moverMUAtual, alterarStatusMUAtual, abrirModalSelecaoErros, selecionarMU
});