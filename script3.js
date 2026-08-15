/* =========================================================
   DASHBOARD
========================================================= */

function contarPaletesSeletor(seletor) {
    return document.querySelectorAll(`${seletor} .pallet`).length;
}

function atualizarIndicador(idBase, quantidade, limite) {
    const percentual =
        limite > 0
            ? Math.min(100, Math.round((quantidade / limite) * 100))
            : 0;

    const percentualEl =
        document.getElementById(`${idBase}-perc`);

    const barraEl =
        document.getElementById(`${idBase}-bar`);

    if (percentualEl) {
        percentualEl.textContent = `${percentual}%`;
    }

    if (barraEl) {
        barraEl.style.width = `${percentual}%`;
        barraEl.setAttribute('aria-valuenow', percentual);
    }
}

function atualizarDashboard() {
    const pendentes =
        document.getElementById('red-stack')?.children.length || 0;

    const triagem =
        document.getElementById('yellow-stack')?.children.length || 0;

    const expedicao =
        document.getElementById('green-stack')?.children.length || 0;

    let ruas = 0;

    document.querySelectorAll('.street-lane').forEach(rua => {
        ruas += rua.querySelectorAll('.pallet').length;
    });

    atualizarIndicador(
        'kpi-ocupacao-pendentes',
        pendentes,
        MAX_RED_PALLETS
    );

    atualizarIndicador(
        'kpi-ocupacao-triagem',
        triagem,
        MAX_YELLOW_PALLETS
    );

    atualizarIndicador(
        'kpi-ocupacao-ruas',
        ruas,
        30
    );

    atualizarIndicador(
        'kpi-ocupacao-expedicao',
        expedicao,
        MAX_GREEN_PALLETS
    );

    atualizarNumerosDashboard(
        pendentes,
        triagem,
        ruas,
        expedicao
    );

    atualizarGraficoErros();
}

function atualizarNumerosDashboard(
    pendentes,
    triagem,
    ruas,
    expedicao
) {
    const valores = {
        'kpi-pendentes': pendentes,
        'kpi-triagem': triagem,
        'kpi-ruas': ruas,
        'kpi-expedicao': expedicao
    };

    Object.entries(valores).forEach(([id, valor]) => {
        const elemento = document.getElementById(id);

        if (elemento) {
            elemento.textContent = valor;
        }
    });
}

function chamarDashboardBackground() {
    if (
        document.getElementById('kpi-ocupacao-pendentes-perc') ||
        document.getElementById('graficoErros')
    ) {
        atualizarDashboard();
    }
}

/* =========================================================
   GRÁFICO DE ERROS
========================================================= */

function obterErrosArmazenados() {
    try {
        return JSON.parse(
            localStorage.getItem('wms_erros_mus') || '[]'
        );
    } catch {
        return [];
    }
}

function salvarErrosArmazenados(erros) {
    localStorage.setItem(
        'wms_erros_mus',
        JSON.stringify(erros)
    );
}

function atualizarGraficoErros() {
    const canvas =
        document.getElementById('graficoErros');

    if (!canvas || typeof Chart === 'undefined') {
        return;
    }

    const erros = obterErrosArmazenados();
    const agrupados = {};

    erros.forEach(item => {
        const nome = item.erro || 'Não informado';
        agrupados[nome] = (agrupados[nome] || 0) + 1;
    });

    const labels = Object.keys(agrupados);
    const valores = Object.values(agrupados);

    if (window.graficoErrosBuffer) {
        window.graficoErrosBuffer.destroy();
    }

    window.graficoErrosBuffer = new Chart(canvas, {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Quantidade de erros',
                data: valores,
                backgroundColor: '#ef4444',
                borderColor: '#f87171',
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        precision: 0
                    }
                }
            }
        }
    });
}

/* =========================================================
   CONSULTA DE PALETES E MUs
========================================================= */

function obterLocalizacao(parentId) {
    if (!parentId) {
        return 'Desconhecido';
    }

    const mapa = {
        'R-A': 'Rua A',
        'R-B': 'Rua B',
        'R-C': 'Rua C',
        'R-D': 'Rua D',
        'R-E': 'Rua E',
        'red-stack': 'Pendentes',
        'yellow-stack': 'Triagem',
        'green-stack': 'Expedição'
    };

    return mapa[parentId] || parentId;
}

async function realizarConsulta() {
    const campo =
        document.getElementById('search-input');

    const termo =
        campo?.value.trim().toUpperCase();

    if (!termo) {
        exibirToast(
            'warning',
            'Pesquisa vazia',
            'Digite uma MU ou palete.'
        );
        return;
    }

    exibirToast(
        'info',
        'Consultando',
        'Buscando informações...',
        1500
    );

    const banco = await fetchDatabase('get_layout');

    if (!banco) {
        exibirToast(
            'error',
            'Erro',
            'Não foi possível consultar o servidor.'
        );
        return;
    }

    const layout = Array.isArray(banco.layout)
        ? banco.layout
        : [];

    const musPorPalete =
        banco.palletMUs || {};

    let paleteEncontrado = null;
    let musEncontradas = [];
    let localizacao = 'Desconhecido';

    if (
        termo.startsWith('P') ||
        termo.startsWith('PL')
    ) {
        paleteEncontrado = layout.find(item =>
            String(item.text || '').toUpperCase() === termo
        );

        if (paleteEncontrado) {
            musEncontradas =
                musPorPalete[paleteEncontrado.id] || [];

            localizacao =
                obterLocalizacao(paleteEncontrado.parentId);
        }
    }

    if (termo.startsWith('MU')) {
        for (const [id, lista] of Object.entries(musPorPalete)) {
            if (!Array.isArray(lista)) continue;

            if (lista.includes(termo)) {
                paleteEncontrado =
                    layout.find(item => item.id === id);

                musEncontradas = lista;

                if (paleteEncontrado) {
                    localizacao =
                        obterLocalizacao(
                            paleteEncontrado.parentId
                        );
                }

                break;
            }
        }
    }

    if (!paleteEncontrado) {
        exibirToast(
            'error',
            'Não encontrado',
            'Código não localizado no sistema.'
        );
        return;
    }

    renderizarTabelaPalete(
        paleteEncontrado.id,
        paleteEncontrado.text,
        localizacao,
        musEncontradas,
        termo
    );
}

function obterTabelaConsulta() {
    return (
        document.querySelector('.data-table tbody') ||
        document.querySelector('#consulta-table-body')
    );
}

function renderizarTabelaPalete(
    idInterno,
    nomePalete,
    localizacao,
    mus,
    termo
) {
    const tabela = obterTabelaConsulta();

    const titulo =
        document.querySelector('.card-header-flex h2') ||
        document.querySelector('#resultado-titulo');

    if (titulo) {
        titulo.textContent =
            `📦 Palete: ${nomePalete}`;
    }

    if (!tabela) {
        return;
    }

    if (!mus.length) {
        tabela.innerHTML = `
            <tr>
                <td colspan="4">
                    Nenhuma MU cadastrada neste palete.
                </td>
            </tr>
        `;
        return;
    }

    tabela.innerHTML = mus.map(mu => `
        <tr class="${mu === termo ? 'selected-row' : ''}">
            <td>${escapeHTML(mu)}</td>
            <td>Liberado</td>
            <td>${escapeHTML(localizacao)}</td>
            <td>
                <button
                    type="button"
                    class="btn-table"
                    data-mu="${escapeHTML(mu)}"
                    data-pallet-id="${escapeHTML(idInterno)}"
                    data-pallet-name="${escapeHTML(nomePalete)}"
                    data-location="${escapeHTML(localizacao)}">
                    Selecionar
                </button>
            </td>
        </tr>
    `).join('');

    tabela.querySelectorAll('.btn-table').forEach(botao => {
        botao.addEventListener('click', () => {
            selecionarMU(
                botao.dataset.mu,
                botao.dataset.palletId,
                botao.dataset.palletName,
                botao.dataset.location
            );
        });
    });

    if (mus.includes(termo)) {
        selecionarMU(
            termo,
            idInterno,
            nomePalete,
            localizacao
        );
    }
}

function selecionarMU(
    mu,
    idInterno,
    nomePalete,
    localizacao
) {
    muSelecionadaGlobal = mu;

    paleteAtualGlobal = {
        idInterno,
        idPalete: nomePalete,
        localizacao
    };

    const campo =
        document.getElementById('detail-mu-code');

    if (campo) {
        campo.textContent = mu;
    }

    document
        .querySelectorAll('.action-buttons .btn-action')
        .forEach(botao => {
            botao.removeAttribute('disabled');
        });
}

/* =========================================================
   AÇÕES DA CONSULTA
========================================================= */

function removerMUAtual() {
    if (
        !muSelecionadaGlobal ||
        !paleteAtualGlobal
    ) {
        exibirToast(
            'info',
            'Atenção',
            'Selecione uma MU primeiro.'
        );
        return;
    }

    const confirmou = window.confirm(
        `Remover a MU ${muSelecionadaGlobal}?`
    );

    if (!confirmou) return;

    const id = paleteAtualGlobal.idInterno;

    if (!Array.isArray(palletMUs[id])) {
        return;
    }

    palletMUs[id] =
        palletMUs[id].filter(mu =>
            mu !== muSelecionadaGlobal
        );

    salvarEstadoGeral();

    exibirToast(
        'success',
        'MU removida',
        'A MU foi removida do palete.'
    );

    realizarConsulta();
}

function moverMUAtual() {
    if (
        !muSelecionadaGlobal ||
        !paleteAtualGlobal
    ) {
        exibirToast(
            'info',
            'Atenção',
            'Selecione uma MU primeiro.'
        );
        return;
    }

    const destino =
        window.prompt(
            'Informe o palete de destino, por exemplo PL-02:'
        )?.trim().toUpperCase();

    if (!destino) return;

    if (
        destino ===
        String(paleteAtualGlobal.idPalete).toUpperCase()
    ) {
        exibirToast(
            'warning',
            'Destino inválido',
            'Escolha um palete diferente.'
        );
        return;
    }

    const palletDestino =
        [...document.querySelectorAll('.pallet')]
            .find(pallet =>
                pallet.textContent.trim().toUpperCase() === destino
            );

    if (!palletDestino) {
        exibirToast(
            'error',
            'Destino não encontrado',
            'O palete de destino não existe no layout.'
        );
        return;
    }

    const origemId = paleteAtualGlobal.idInterno;

    if (!Array.isArray(palletMUs[origemId])) {
        return;
    }

    palletMUs[origemId] =
        palletMUs[origemId].filter(
            mu => mu !== muSelecionadaGlobal
        );

    if (!Array.isArray(palletMUs[palletDestino.id])) {
        palletMUs[palletDestino.id] = [];
    }

    if (
        palletMUs[palletDestino.id].length >=
        MAX_MUS_PER_PALLET
    ) {
        exibirToast(
            'warning',
            'Palete cheio',
            'O palete de destino já possui 30 MUs.'
        );
        return;
    }

    palletMUs[palletDestino.id].push(muSelecionadaGlobal);

    salvarEstadoGeral();

    exibirToast(
        'success',
        'MU movida',
        'A MU foi transferida com sucesso.'
    );

    const campo =
        document.getElementById('search-input');

    if (campo) {
        campo.value = destino;
    }

    realizarConsulta();
}

function alterarStatusMUAtual() {
    if (!muSelecionadaGlobal) {
        exibirToast(
            'info',
            'Atenção',
            'Selecione uma MU primeiro.'
        );
        return;
    }

    exibirToast(
        'success',
        'Status alterado',
        `Status da MU ${muSelecionadaGlobal} atualizado.`
    );
}

function abrirModalSelecaoErros() {
    if (!muSelecionadaGlobal) {
        exibirToast(
            'info',
            'Atenção',
            'Selecione uma MU primeiro.'
        );
        return;
    }

    const erro =
        window.prompt(
            `Informe o erro:\n${LISTA_ERROS_PADRAO.join(', ')}`
        );

    if (!erro?.trim()) return;

    const registros = obterErrosArmazenados();

    registros.push({
        mu: muSelecionadaGlobal,
        erro: erro.trim(),
        usuario: obterUsuarioAtual(),
        data: new Date().toLocaleString('pt-BR')
    });

    salvarErrosArmazenados(registros);
    atualizarGraficoErros();

    exibirToast(
        'warning',
        'Erro registrado',
        `Erro associado à MU ${muSelecionadaGlobal}.`
    );
}

/* =========================================================
   HISTÓRICO
========================================================= */

async function carregarDadosDoSheets() {
    dadosHistorico =
        await fetchDatabase('get_historico') || [];

    if (!Array.isArray(dadosHistorico)) {
        dadosHistorico = [];
    }
}

function carregarHistoricoComMedias() {
    const tabela =
        document.getElementById('history-table-body');

    if (!tabela) {
        return;
    }

    if (!dadosHistorico.length) {
        tabela.innerHTML = `
            <tr>
                <td colspan="4">
                    Nenhum registro encontrado.
                </td>
            </tr>
        `;
        return;
    }

    tabela.innerHTML =
        dadosHistorico
            .slice()
            .reverse()
            .map(registro => `
                <tr>
                    <td>${escapeHTML(registro.mu || '-')}</td>
                    <td>${escapeHTML(registro.palletID || '-')}</td>
                    <td>${escapeHTML(registro.dataDespacho || '-')}</td>
                    <td>${escapeHTML(registro.usuario || '-')}</td>
                </tr>
            `)
            .join('');
}

/* =========================================================
   EVENTOS GLOBAIS
========================================================= */

function mapearEventosGlobais() {
    const buscar =
        document.querySelector('.btn-search');

    if (buscar) {
        buscar.addEventListener('click', realizarConsulta);
    }

    const campoBusca =
        document.getElementById('search-input');

    if (campoBusca) {
        campoBusca.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                realizarConsulta();
            }
        });
    }

    const remover =
        document.querySelector(
            '.action-buttons .btn-action.danger'
        );

    if (remover) {
        remover.addEventListener('click', removerMUAtual);
    }

    const mover =
        document.querySelector(
            '.action-buttons .btn-action.primary'
        );

    if (mover) {
        mover.addEventListener('click', moverMUAtual);
    }

    const alterarStatus =
        document.getElementById('btn-alterar-status');

    if (alterarStatus) {
        alterarStatus.addEventListener(
            'click',
            alterarStatusMUAtual
        );
    }

    const selecionarErros =
        document.getElementById('btn-selecionar-erros');

    if (selecionarErros) {
        selecionarErros.addEventListener(
            'click',
            abrirModalSelecaoErros
        );
    }

    document
        .querySelectorAll('.pallet')
        .forEach(configurarPallet);
}

/* =========================================================
   INICIALIZAÇÃO
========================================================= */

document.addEventListener('DOMContentLoaded', async () => {
    carregarTema();
    verificarSessaoAtiva();
    mapearEventosGlobais();

    if (obterSessao()) {
        await carregarEstadoGeral();
    }

    if (
        document.getElementById('history-table-body')
    ) {
        await carregarDadosDoSheets();
        carregarHistoricoComMedias();
    }

    if (
        document.getElementById(
            'kpi-ocupacao-pendentes-perc'
        ) ||
        document.getElementById('graficoErros')
    ) {
        atualizarDashboard();

        clearInterval(dashInterval);
        dashInterval = setInterval(
            atualizarDashboard,
            5000
        );
    }
});

/* =========================================================
   EXPORTAÇÕES GLOBAIS
========================================================= */

Object.assign(window, {
    atualizarDashboard,
    chamarDashboardBackground,
    atualizarGraficoErros,
    realizarConsulta,
    renderizarTabelaPalete,
    selecionarMU,
    removerMUAtual,
    moverMUAtual,
    alterarStatusMUAtual,
    abrirModalSelecaoErros,
    carregarDadosDoSheets,
    carregarHistoricoComMedias,
    mapearEventosGlobais
});