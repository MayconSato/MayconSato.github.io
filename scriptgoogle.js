'use strict';

/* =========================================================
   CONFIGURAÇÕES GERAIS
========================================================= */

const GOOGLE_SHEETS_URL =
'https://script.google.com/macros/s/AKfycbyWvQ8Anvus1la6b58rb0PDCB5miiiYo0gVUevofddG8Sm1owo20hx1cZXm-9AX8ivVNA/exec';

const MAX_RED_PALLETS = 10;
const MAX_YELLOW_PALLETS = 6;
const MAX_GREEN_PALLETS = 12;
const MAX_MUS_PER_PALLET = 30;

let selectedElement = null;
let selectedName = '';
let currentIdCounter = 1;
let timerInterval = null;
let dashInterval = null;
let syncTimeout = null;

let palletMUs = {};
let dadosHistorico = [];
let muSelecionadaGlobal = null;
let paleteAtualGlobal = null;

const LISTA_ERROS_PADRAO = [
    'Audit',
    'Cubing',
    'Montagem de Hu',
    'Sor',
    'P2M',
    'Checkin',
    'Usuário Travado',
    'Transfer Volume',
    'Viagem em Curso',
    'Despacho em HU',
    'Vincular em HU',
    'Invoicing',
    'Decanting',
    'Saldo em outro CAD'
];

/* =========================================================
   FUNÇÕES UTILITÁRIAS
========================================================= */

function escapeHTML(valor) {
    return String(valor ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function obterSessao() {
    try {
        return JSON.parse(
            localStorage.getItem('wms_sessao_ativa') || 'null'
        );
    } catch (erro) {
        console.error('Erro ao ler sessão:', erro);
        return null;
    }
}

function obterUsuarioAtual() {
    const sessao = obterSessao();

    if (!sessao) {
        return 'Nenhum operador logado';
    }

    return `${sessao.nome} (${sessao.usuario})`;
}

function obterIdDoPai(elemento) {
    const pai = elemento?.parentElement;

    if (!pai) {
        return '';
    }

    return pai.id || pai.dataset.lane || '';
}

/* =========================================================
   GOOGLE SHEETS
========================================================= */

async function fetchDatabase(action) {
    try {
        const url =
            `${GOOGLE_SHEETS_URL}?action=${encodeURIComponent(action)}`;

        const resposta = await fetch(url, {
            method: 'GET',
            cache: 'no-store'
        });

        if (!resposta.ok) {
            throw new Error(`HTTP ${resposta.status}`);
        }

        return await resposta.json();
    } catch (erro) {
        console.error(`Erro ao buscar ${action}:`, erro);
        return null;
    }
}

async function saveDatabase(action, data) {
    try {
        const resposta = await fetch(GOOGLE_SHEETS_URL, {
            method: 'POST',
            headers: {
                'Content-Type':
                    'application/x-www-form-urlencoded;charset=UTF-8'
            },
            body: new URLSearchParams({
                action,
                data: JSON.stringify(data)
            }).toString()
        });

        const texto = await resposta.text();

        try {
            return JSON.parse(texto);
        } catch {
            return {
                status: resposta.ok ? 'success' : 'error',
                raw: texto
            };
        }
    } catch (erro) {
        console.error(`Erro ao salvar ${action}:`, erro);
        return null;
    }
}

async function apiGetUsuarios() {
    const dados = await fetchDatabase('get_usuarios');

    if (!dados) {
        return {};
    }

    /*
      Aceita tanto este formato:

      {
        "admin": {
          "nome": "Administrador",
          "senha": "123"
        }
      }

      quanto este:

      [
        {
          "usuario": "admin",
          "nome": "Administrador",
          "senha": "123"
        }
      ]
    */

    if (Array.isArray(dados)) {
        return dados.reduce((resultado, usuario) => {
            if (!usuario?.usuario) {
                return resultado;
            }

            resultado[String(usuario.usuario).toLowerCase()] = {
                nome: usuario.nome || usuario.usuario,
                senha: usuario.senha || ''
            };

            return resultado;
        }, {});
    }

    return typeof dados === 'object' ? dados : {};
}

async function apiSaveUsuarios(usuarios) {
    const resposta = await saveDatabase('save_usuarios', usuarios);

    return (
        resposta?.status === 'success' ||
        resposta?.status === 'ok' ||
        resposta === null
    );
}

/* =========================================================
   TOASTS E STATUS
========================================================= */

function exibirToast(tipo, titulo, mensagem, tempo = 3500) {
    const stack = document.getElementById('toast-stack');

    if (!stack) {
        console.log(`[${tipo}] ${titulo}: ${mensagem}`);
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast-item ${tipo}`;

    const tituloEl = document.createElement('span');
    tituloEl.className = 'toast-title';
    tituloEl.textContent = titulo;

    const mensagemEl = document.createElement('span');
    mensagemEl.className = 'toast-message';
    mensagemEl.textContent = mensagem;

    toast.appendChild(tituloEl);
    toast.appendChild(mensagemEl);
    stack.appendChild(toast);

    window.setTimeout(() => {
        toast.classList.add('hide');

        window.setTimeout(() => {
            toast.remove();
        }, 300);
    }, tempo);
}

function updateStatus(conteudo) {
    const elemento = document.getElementById('app-status');

    if (elemento) {
        elemento.innerHTML = conteudo;
    }
}

/* =========================================================
   TEMA
========================================================= */

function mudarTema(tema) {
    const temasPermitidos = ['dark', 'light', 'meli'];
    const temaFinal = temasPermitidos.includes(tema) ? tema : 'light';

    document.body.classList.remove(
        'theme-dark',
        'theme-light',
        'theme-meli'
    );

    document.body.classList.add(`theme-${temaFinal}`);

    localStorage.setItem('wms_tema_preferido', temaFinal);
    localStorage.setItem('wms_current_theme', temaFinal);
}

function carregarTema() {
    const tema =
        localStorage.getItem('wms_tema_preferido') ||
        localStorage.getItem('wms_current_theme') ||
        'light';

    mudarTema(tema);
}

/* =========================================================
   AUTENTICAÇÃO
========================================================= */

function verificarStatusSessao() {
    verificarSessaoAtiva();
}

function verificarSessaoAtiva() {
    const sessao = obterSessao();

    const formularios =
        document.getElementById('auth-forms-container');

    const painel =
        document.getElementById('config-panel-container');

    const titulo =
        document.getElementById('config-modal-title');

    if (formularios) {
        formularios.style.display = sessao ? 'none' : 'block';
    }

    if (painel) {
        painel.style.display = sessao ? 'block' : 'none';
    }

    if (titulo) {
        titulo.textContent = sessao
            ? '⚙️ Configurações do Operador'
            : '🔐 Identificação do Operador';
    }

    const nome = document.getElementById('cfg-user-name');

    if (nome) {
        nome.textContent = sessao?.nome || '-';
    }

    if (sessao?.loginTime) {
        iniciarTimer(sessao.loginTime);
    } else {
        clearInterval(timerInterval);
    }
}

function switchModalTab(tabId) {
    const botoes = document.querySelectorAll(
        '#config-modal .tab-btn'
    );

    const abas = document.querySelectorAll(
        '#config-modal .modal-tab-content'
    );

    botoes.forEach(botao => {
        botao.classList.remove('active');
    });

    abas.forEach(aba => {
        aba.style.display = 'none';
    });

    const abaSelecionada =
        document.getElementById(`modal-tab-${tabId}`);

    if (abaSelecionada) {
        abaSelecionada.style.display = 'block';
    }

    const indice = tabId === 'register' ? 1 : 0;

    if (botoes[indice]) {
        botoes[indice].classList.add('active');
    }
}

function switchAuthTab(tabId, event) {
    switchModalTab(tabId);

    if (event?.currentTarget) {
        document.querySelectorAll('.tab-btn').forEach(botao => {
            botao.classList.remove('active');
        });

        event.currentTarget.classList.add('active');
    }
}

async function realizarCadastro(event) {
    event.preventDefault();

    const nome =
        document.getElementById('reg-fullname')?.value.trim();

    const usuario =
        document.getElementById('reg-username')?.value
            .trim()
            .toLowerCase();

    const senha =
        document.getElementById('reg-password')?.value.trim();

    if (!nome || !usuario || !senha) {
        exibirToast(
            'warning',
            'Atenção',
            'Preencha todos os campos.'
        );
        return;
    }

    exibirToast(
        'info',
        'Aguarde',
        'Verificando cadastro...',
        2000
    );

    const usuarios = await apiGetUsuarios();

    if (usuarios[usuario]) {
        exibirToast(
            'warning',
            'Usuário existente',
            'Este usuário já está cadastrado.'
        );
        return;
    }

    usuarios[usuario] = {
        nome,
        senha
    };

    const sucesso = await apiSaveUsuarios(usuarios);

    if (!sucesso) {
        exibirToast(
            'error',
            'Erro',
            'Não foi possível salvar o cadastro.'
        );
        return;
    }

    event.target.reset();
    switchModalTab('login');

    exibirToast(
        'success',
        'Cadastro concluído',
        'Agora faça login no sistema.'
    );
}

async function realizarLogin(event) {
    event.preventDefault();

    const usuario =
        document.getElementById('login-username')?.value
            .trim()
            .toLowerCase();

    const senha =
        document.getElementById('login-password')?.value.trim();

    if (!usuario || !senha) {
        exibirToast(
            'warning',
            'Atenção',
            'Informe usuário e senha.'
        );
        return;
    }

    exibirToast(
        'info',
        'Aguarde',
        'Validando acesso...',
        2000
    );

    const usuarios = await apiGetUsuarios();

    const conta = usuarios[usuario];

    if (!conta || String(conta.senha) !== senha) {
        exibirToast(
            'error',
            'Falha de autenticação',
            'Usuário ou senha incorretos.'
        );
        return;
    }

    const sessao = {
        usuario,
        nome: conta.nome || usuario,
        loginTime: Date.now()
    };

    localStorage.setItem(
        'wms_sessao_ativa',
        JSON.stringify(sessao)
    );

    event.target.reset();
    verificarSessaoAtiva();
    fecharConfiguracoes();

    exibirToast(
        'success',
        'Login realizado',
        `Bem-vindo, ${sessao.nome}!`
    );

    await carregarEstadoGeral();
}

function realizarLogout() {
    const confirmou = window.confirm(
        'Deseja realmente encerrar a sessão?'
    );

    if (!confirmou) {
        return;
    }

    localStorage.removeItem('wms_sessao_ativa');
    clearInterval(timerInterval);

    fecharConfiguracoes();
    verificarSessaoAtiva();

    exibirToast(
        'success',
        'Sessão encerrada',
        'Logout realizado com sucesso.'
    );
}

async function alterarSenhaOperador(event) {
    event.preventDefault();

    const sessao = obterSessao();

    if (!sessao) {
        exibirToast(
            'error',
            'Erro',
            'Nenhuma sessão ativa.'
        );
        return;
    }

    const senhaAtual =
        document.getElementById('cfg-old-pass')?.value.trim();

    const novaSenha =
        document.getElementById('cfg-new-pass')?.value.trim();

    if (!senhaAtual || !novaSenha) {
        exibirToast(
            'warning',
            'Atenção',
            'Preencha as duas senhas.'
        );
        return;
    }

    const usuarios = await apiGetUsuarios();
    const usuario = usuarios[sessao.usuario];

    if (!usuario || String(usuario.senha) !== senhaAtual) {
        exibirToast(
            'error',
            'Erro',
            'A senha atual está incorreta.'
        );
        return;
    }

    usuario.senha = novaSenha;

    const sucesso = await apiSaveUsuarios(usuarios);

    if (!sucesso) {
        exibirToast(
            'error',
            'Erro',
            'Não foi possível alterar a senha.'
        );
        return;
    }

    event.target.reset();

    exibirToast(
        'success',
        'Senha alterada',
        'Sua senha foi atualizada com sucesso.'
    );
}

/* =========================================================
   CONFIGURAÇÕES E CRONÔMETRO
========================================================= */

function abrirConfiguracoes() {
    const modal = document.getElementById('config-modal');

    if (!modal) {
        return;
    }

    verificarSessaoAtiva();

    modal.style.display = 'flex';
    modal.classList.add('visible');

    const sessao = obterSessao();

    if (sessao) {
        iniciarTimer(sessao.loginTime);
    }
}

function fecharConfiguracoes() {
    const modal = document.getElementById('config-modal');

    if (!modal) {
        return;
    }

    modal.style.display = 'none';
    modal.classList.remove('visible');
}

function iniciarTimer(loginTime) {
    clearInterval(timerInterval);

    if (!loginTime) {
        return;
    }

    function atualizar() {
        const diferenca =
            Math.max(0, Date.now() - Number(loginTime));

        const totalSegundos =
            Math.floor(diferenca / 1000);

        const horas =
            String(Math.floor(totalSegundos / 3600))
                .padStart(2, '0');

        const minutos =
            String(Math.floor((totalSegundos % 3600) / 60))
                .padStart(2, '0');

        const segundos =
            String(totalSegundos % 60)
                .padStart(2, '0');

        const campo =
            document.getElementById('cfg-session-timer');

        if (campo) {
            campo.textContent =
                `${horas}:${minutos}:${segundos}`;
        }
    }

    atualizar();
    timerInterval = setInterval(atualizar, 1000);
}

/* =========================================================
   MODAIS E NOTIFICAÇÕES
========================================================= */

function fecharPainelNotificacoes() {
    const painel =
        document.getElementById('notification-panel');

    if (painel) {
        painel.classList.add('hidden');
    }
}

function fecharModalPalete() {
    const modal =
        document.getElementById('pallet-modal');

    if (!modal) {
        return;
    }

    modal.classList.add('hidden');
    modal.style.display = 'none';
}

function abrirResumoPalete(elemento) {
    const modal =
        document.getElementById('pallet-modal');

    const titulo =
        document.getElementById('modal-title');

    const conteudo =
        document.getElementById('modal-content');

    if (!modal || !elemento) {
        return;
    }

    const mus = palletMUs[elemento.id] || [];

    if (titulo) {
        titulo.textContent =
            `Resumo: ${elemento.textContent.trim()}`;
    }

    if (conteudo) {
        conteudo.innerHTML = `
            <strong>MUs:</strong> ${mus.length}/${MAX_MUS_PER_PALLET}<br><br>
            ${
                mus.length
                    ? mus.map(escapeHTML).join('<br>')
                    : 'Nenhuma MU cadastrada.'
            }
        `;
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
}

document.addEventListener('dblclick', event => {
    const pallet = event.target.closest('.pallet');

    if (pallet) {
        abrirResumoPalete(pallet);
    }
});

/* =========================================================
   EXPORTAÇÃO GLOBAL DA PARTE 1
========================================================= */

Object.assign(window, {
    fetchDatabase,
    saveDatabase,
    apiGetUsuarios,
    apiSaveUsuarios,
    exibirToast,
    updateStatus,
    mudarTema,
    carregarTema,
    obterSessao,
    obterUsuarioAtual,
    verificarStatusSessao,
    verificarSessaoAtiva,
    switchModalTab,
    switchAuthTab,
    realizarCadastro,
    realizarLogin,
    realizarLogout,
    alterarSenhaOperador,
    abrirConfiguracoes,
    fecharConfiguracoes,
    iniciarTimer,
    fecharPainelNotificacoes,
    fecharModalPalete,
    abrirResumoPalete
});