/* =========================================================
   PERSISTÊNCIA DO LAYOUT
========================================================= */

function obterParentId(elemento) {
    const pai = elemento?.parentElement;
    if (!pai) return '';
    return pai.id || pai.dataset.lane || '';
}

function salvarEstadoGeral() {
    clearTimeout(syncTimeout);

    syncTimeout = setTimeout(async () => {
        const layout = [...document.querySelectorAll('.pallet')].map(pallet => ({
            id: pallet.id,
            text: pallet.textContent.trim(),
            className: pallet.className,
            parentId: obterParentId(pallet)
        }));

        await saveDatabase('save_layout', {
            palletMUs,
            currentIdCounter,
            layout
        });

        atualizarDashboard();
    }, 500);
}

async function carregarEstadoGeral() {
    const banco = await fetchDatabase('get_layout');

    if (!banco) {
        updateRedCounter();
        atualizarDashboard();
        return;
    }

    palletMUs = banco.palletMUs || {};
    currentIdCounter = Number(banco.currentIdCounter) || 1;

    document.querySelectorAll('.pallet').forEach(pallet => {
        pallet.remove();
    });

    const layout = Array.isArray(banco.layout) ? banco.layout : [];

    layout.forEach(item => {
        const pai =
            document.getElementById(item.parentId) ||
            document.querySelector(`[data-lane="${item.parentId}"]`);

        if (!pai) return;

        const pallet = document.createElement('div');

        pallet.id = item.id || `pallet-${Date.now()}`;
        pallet.textContent = item.text || 'Pallet';
        pallet.className = item.className || 'pallet red';
        pallet.draggable = true;

        pallet.addEventListener('dragstart', drag);
        pallet.addEventListener('click', () => {
            selectPalletElement(pallet, pallet.textContent.trim());
        });

        pai.appendChild(pallet);
    });

    updateRedCounter();
    atualizarDashboard();
}

/* =========================================================
   DRAG AND DROP
========================================================= */

function allowDrop(event) {
    event.preventDefault();

    const alvo = event.currentTarget || event.target;

    if (alvo?.classList) {
        alvo.classList.add('drag-over');
    }
}

function drag(event) {
    const elemento = event.currentTarget || event.target;

    if (!elemento?.id) return;

    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', elemento.id);

    elemento.classList.add('dragging');
}

function clearDragEffects() {
    document
        .querySelectorAll('.drag-over, .dragging')
        .forEach(elemento => {
            elemento.classList.remove('drag-over', 'dragging');
        });
}

document.addEventListener('dragend', () => {
    clearDragEffects();
    salvarEstadoGeral();
});

document.addEventListener('drop', () => {
    clearDragEffects();
});

document.addEventListener('dragleave', event => {
    const elemento = event.target;

    if (
        elemento?.classList?.contains('pallet-row') ||
        elemento?.classList?.contains('street-lane') ||
        elemento?.classList?.contains('zone')
    ) {
        elemento.classList.remove('drag-over');
    }
});

function obterPalletDoEvento(event) {
    const id = event.dataTransfer?.getData('text/plain');

    if (!id) return null;

    return document.getElementById(id);
}

function quantidadeDePaletes(elemento) {
    return elemento?.querySelectorAll('.pallet').length || 0;
}

/* =========================================================
   VALIDAÇÕES DE MOVIMENTAÇÃO
========================================================= */

function validarMovimentacaoPallet(pallet, destino) {
    if (!pallet) {
        return {
            ok: false,
            motivo: 'Palete inválido.'
        };
    }

    const vermelho = pallet.classList.contains('red');
    const amareloSemId =
        pallet.classList.contains('yellow-no-id');

    const amareloConferido =
        pallet.classList.contains('yellow-checked');

    const azul = pallet.classList.contains('blue');
    const verde = pallet.classList.contains('green');

    if (destino === 'amarela') {
        if (vermelho || verde) {
            return { ok: true };
        }

        return {
            ok: false,
            motivo: 'Apenas paletes vermelhos ou verdes podem ir para a triagem.'
        };
    }

    if (destino === 'rua') {
        if (amareloConferido || azul || verde) {
            return { ok: true };
        }

        if (amareloSemId) {
            return {
                ok: false,
                motivo: 'Finalize a Checagem HH antes de enviar para a rua.'
            };
        }

        return {
            ok: false,
            motivo: 'O palete precisa passar pela triagem primeiro.'
        };
    }

    if (destino === 'verde') {
        if (azul) {
            return { ok: true };
        }

        return {
            ok: false,
            motivo: 'Apenas paletes azuis com ID podem ir para expedição.'
        };
    }

    return {
        ok: false,
        motivo: 'Destino desconhecido.'
    };
}

/* =========================================================
   MOVIMENTAÇÃO PARA A ZONA VERMELHA
========================================================= */

function dropPalletRed(event, redContainer) {
    event.preventDefault();
    clearDragEffects();

    const pallet = obterPalletDoEvento(event);

    if (!pallet || !redContainer) return;

    if (pallet.parentElement === redContainer) {
        return;
    }

    if (
        quantidadeDePaletes(redContainer) >= MAX_RED_PALLETS
    ) {
        exibirToast(
            'warning',
            'Zona cheia',
            'A Zona Vermelha atingiu sua capacidade.'
        );
        return;
    }

    const confirmou = window.confirm(
        `Retornar o palete "${pallet.textContent.trim()}" para Pendentes?`
    );

    if (!confirmou) return;

    delete palletMUs[pallet.id];

    const numero = obterProximoNumeroVermelho();

    pallet.className = 'pallet red';
    pallet.textContent = numero
        ? `P${String(numero).padStart(2, '0')}`
        : 'Pallet';

    redContainer.appendChild(pallet);

    updateRedCounter();
    salvarEstadoGeral();

    updateStatus(
        '🔴 <strong>Palete retornado para Pendentes.</strong>'
    );
}

/* =========================================================
   MOVIMENTAÇÃO PARA A ZONA AMARELA
========================================================= */

function dropPalletYellow(event, yellowContainer) {
    event.preventDefault();
    clearDragEffects();

    const pallet = obterPalletDoEvento(event);

    if (!pallet || !yellowContainer) return;

    if (
        pallet.parentElement === yellowContainer
    ) {
        return;
    }

    if (
        quantidadeDePaletes(yellowContainer) >= MAX_YELLOW_PALLETS
    ) {
        exibirToast(
            'warning',
            'Zona cheia',
            'A Zona Amarela atingiu sua capacidade.'
        );
        return;
    }

    const validacao =
        validarMovimentacaoPallet(pallet, 'amarela');

    if (!validacao.ok) {
        exibirToast(
            'warning',
            'Movimentação bloqueada',
            validacao.motivo
        );
        return;
    }

    if (pallet.classList.contains('green')) {
        const confirmacao = window.prompt(
            `Informe o código atual do palete:\n${pallet.textContent.trim()}`
        );

        if (
            confirmacao?.trim().toUpperCase() !==
            pallet.textContent.trim().toUpperCase()
        ) {
            exibirToast(
                'error',
                'Código inválido',
                'O código informado não confere.'
            );
            return;
        }

        pallet.className = 'pallet yellow-checked';
        pallet.textContent = 'Check';
    } else {
        pallet.className = 'pallet yellow-no-id';
        pallet.textContent = 'No ID';
    }

    yellowContainer.appendChild(pallet);

    updateRedCounter();
    salvarEstadoGeral();

    updateStatus(
        '🟡 <strong>Palete enviado para Triagem.</strong>'
    );
}

/* =========================================================
   MOVIMENTAÇÃO PARA AS RUAS
========================================================= */

function obterCodigoDaRua(laneElement) {
    if (!laneElement) return '';

    if (laneElement.dataset.lane) {
        return laneElement.dataset.lane;
    }

    const faixa = laneElement.closest('.street-lane');

    return (
        faixa?.querySelector('.lane-title')?.textContent.trim() ||
        ''
    );
}

function dropPallet(event, laneElement) {
    event.preventDefault();
    clearDragEffects();

    const pallet = obterPalletDoEvento(event);

    if (!pallet || !laneElement) return;

    if (pallet.parentElement === laneElement) {
        return;
    }

    if (
        quantidadeDePaletes(laneElement) >= 6
    ) {
        exibirToast(
            'warning',
            'Rua cheia',
            'Esta rua atingiu a capacidade máxima.'
        );
        return;
    }

    const validacao =
        validarMovimentacaoPallet(pallet, 'rua');

    if (!validacao.ok) {
        exibirToast(
            'warning',
            'Movimentação bloqueada',
            validacao.motivo
        );
        return;
    }

    const codigoRua = obterCodigoDaRua(laneElement);

    const precisaConfirmar =
        pallet.classList.contains('yellow-checked') ||
        pallet.classList.contains('green') ||
        pallet.closest('.street-lane');

    if (precisaConfirmar) {
        const confirmacao = window.prompt(
            `Digite o código da rua de destino:\n${codigoRua}`
        );

        if (
            confirmacao?.trim().toUpperCase() !==
            codigoRua.trim().toUpperCase()
        ) {
            exibirToast(
                'error',
                'Rua não validada',
                'O código da rua está incorreto.'
            );
            return;
        }
    }

    pallet.className = 'pallet blue';

    if (
        pallet.textContent.trim() === 'Check' ||
        pallet.textContent.trim() === 'No ID'
    ) {
        pallet.textContent =
            `PL-${String(currentIdCounter++).padStart(2, '0')}`;
    }

    laneElement.appendChild(pallet);

    updateRedCounter();
    salvarEstadoGeral();

    updateStatus(
        `🔵 <strong>Palete enviado para ${codigoRua}.</strong>`
    );
}

/* =========================================================
   MOVIMENTAÇÃO PARA EXPEDIÇÃO
========================================================= */

function dropPalletGreen(event, greenContainer) {
    event.preventDefault();
    clearDragEffects();

    const pallet = obterPalletDoEvento(event);

    if (!pallet || !greenContainer) return;

    if (pallet.parentElement === greenContainer) {
        return;
    }

    if (
        quantidadeDePaletes(greenContainer) >= MAX_GREEN_PALLETS
    ) {
        exibirToast(
            'warning',
            'Expedição cheia',
            'A Zona Verde atingiu a capacidade máxima.'
        );
        return;
    }

    const validacao =
        validarMovimentacaoPallet(pallet, 'verde');

    if (!validacao.ok) {
        exibirToast(
            'warning',
            'Movimentação bloqueada',
            validacao.motivo
        );
        return;
    }

    const confirmou = window.confirm(
        `Liberar o palete ${pallet.textContent.trim()} para expedição?`
    );

    if (!confirmou) return;

    pallet.className = 'pallet green';
    greenContainer.appendChild(pallet);

    updateRedCounter();
    salvarEstadoGeral();

    updateStatus(
        '🟢 <strong>Palete liberado para expedição.</strong>'
    );
}

/* =========================================================
   SELEÇÃO DE PALETES
========================================================= */

function selectPalletElement(element, name = '') {
    if (!element) return;

    document
        .querySelectorAll('.pallet.selected')
        .forEach(pallet => {
            pallet.classList.remove('selected');
        });

    selectedElement = element;
    selectedName = name || element.textContent.trim();

    selectedElement.classList.add('selected');

    const mus = palletMUs[element.id] || [];

    updateStatus(`
        📦 <strong>Palete:</strong>
        <span>${escapeHTML(element.textContent.trim())}</span><br>
        📊 <strong>MUs:</strong>
        ${mus.length}/${MAX_MUS_PER_PALLET}<br>
        <small>
            ${mus.length ? mus.map(escapeHTML).join(', ') : 'Vazio'}
        </small>
    `);
}

/* =========================================================
   AÇÕES DOS BOTÕES DAS ZONAS
========================================================= */

function triggerAction(actionName) {
    if (!selectedElement) {
        exibirToast(
            'info',
            'Atenção',
            'Selecione um palete primeiro.'
        );
        return;
    }

    const palletId = selectedElement.id;

    if (actionName === 'Checagem HH') {
        if (
            !selectedElement.classList.contains('yellow-no-id')
        ) {
            exibirToast(
                'warning',
                'Atenção',
                'Selecione um palete sem ID na Triagem.'
            );
            return;
        }

        selectedElement.className =
            'pallet yellow-checked selected';

        selectedElement.textContent = 'Check';
        palletMUs[palletId] = [];

        updateStatus(
            '🟡 <strong>Checagem HH concluída.</strong>'
        );
    }

    if (actionName === 'Cadastrar MU') {
        if (
            !selectedElement.classList.contains('yellow-checked')
        ) {
            exibirToast(
                'warning',
                'Atenção',
                'Finalize a Checagem HH primeiro.'
            );
            return;
        }

        if (!Array.isArray(palletMUs[palletId])) {
            palletMUs[palletId] = [];
        }

        while (
            palletMUs[palletId].length < MAX_MUS_PER_PALLET
        ) {
            let mu = window.prompt(
                `Bipe a MU (${palletMUs[palletId].length}/${MAX_MUS_PER_PALLET})`
            );

            if (!mu) break;

            mu = mu.trim().toUpperCase();

            if (!/^MU[A-Z0-9]{14}$/.test(mu)) {
                exibirToast(
                    'warning',
                    'Formato inválido',
                    'A MU deve ter 16 caracteres e começar com MU.'
                );
                continue;
            }

            if (palletMUs[palletId].includes(mu)) {
                exibirToast(
                    'warning',
                    'MU duplicada',
                    'Esta MU já foi cadastrada.'
                );
                continue;
            }

            palletMUs[palletId].push(mu);
        }

        updateStatus(`
            📦 <strong>MUs:</strong>
            ${palletMUs[palletId].length}/${MAX_MUS_PER_PALLET}
        `);
    }

    if (actionName === 'Despachar PL') {
        if (
            !selectedElement.classList.contains('green')
        ) {
            exibirToast(
                'warning',
                'Atenção',
                'Somente paletes verdes podem ser despachados.'
            );
            return;
        }

        const mus = palletMUs[palletId] || [];

        if (!mus.length) {
            exibirToast(
                'warning',
                'Palete vazio',
                'Cadastre pelo menos uma MU antes do despacho.'
            );
            return;
        }

        const confirmou = window.confirm(
            `Despachar ${selectedElement.textContent.trim()}?`
        );

        if (!confirmou) return;

        const dataDespacho =
            new Date().toLocaleString('pt-BR');

        const historico = mus.map(mu => ({
            dataDespacho,
            palletID: selectedElement.textContent.trim(),
            mu,
            acoesFeitas: 1,
            tempoNoBuffer: '0m',
            usuario: obterUsuarioAtual()
        }));

        await saveDatabase('save_historico', historico);

        delete palletMUs[palletId];
        selectedElement.remove();
        selectedElement = null;
        selectedName = '';

        updateStatus(
            '🟢 <strong>Palete despachado com sucesso.</strong>'
        );
    }

    salvarEstadoGeral();
}

/* =========================================================
   GERENCIAMENTO DE PALETES VERMELHOS
========================================================= */

function obterProximoNumeroVermelho() {
    const stack = document.getElementById('red-stack');

    if (!stack) return null;

    const usados = [...stack.children]
        .map(pallet => {
            const numero =
                pallet.textContent.match(/\d+/)?.[0];

            return Number(numero) || 0;
        });

    for (let numero = 1; numero <= MAX_RED_PALLETS; numero++) {
        if (!usados.includes(numero)) {
            return numero;
        }
    }

    return null;
}

function configurarPallet(pallet) {
    if (!pallet) return;

    pallet.draggable = true;

    pallet.addEventListener('dragstart', drag);

    pallet.addEventListener('click', () => {
        selectPalletElement(pallet, pallet.textContent.trim());
    });
}

function addRedPallet() {
    const stack = document.getElementById('red-stack');

    if (!stack) return;

    if (
        stack.children.length >= MAX_RED_PALLETS
    ) {
        exibirToast(
            'warning',
            'Limite atingido',
            'A Zona Vermelha está cheia.'
        );
        return;
    }

    const numero = obterProximoNumeroVermelho();

    if (!numero) return;

    const pallet = document.createElement('div');

    pallet.id =
        `pallet-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    pallet.className = 'pallet red';
    pallet.textContent =
        `P${String(numero).padStart(2, '0')}`;

    configurarPallet(pallet);
    stack.appendChild(pallet);

    updateRedCounter();
    salvarEstadoGeral();
}

function removeRedPallet() {
    const stack = document.getElementById('red-stack');

    if (!stack || !stack.children.length) {
        return;
    }

    const pallet = stack.lastElementChild;

    delete palletMUs[pallet.id];

    if (selectedElement === pallet) {
        selectedElement = null;
        selectedName = '';
    }

    pallet.remove();

    updateRedCounter();
    salvarEstadoGeral();
}

function updateRedCounter() {
    const contador =
        document.getElementById('red-count');

    const stack =
        document.getElementById('red-stack');

    if (contador && stack) {
        contador.textContent = stack.children.length;
    }
}

/* =========================================================
   EXPORTAÇÃO GLOBAL DA PARTE 2
========================================================= */

Object.assign(window, {
    obterParentId,
    salvarEstadoGeral,
    carregarEstadoGeral,
    allowDrop,
    drag,
    clearDragEffects,
    validarMovimentacaoPallet,
    dropPalletRed,
    dropPalletYellow,
    dropPallet,
    dropPalletGreen,
    selectPalletElement,
    triggerAction,
    addRedPallet,
    removeRedPallet,
    updateRedCounter,
    configurarPallet
});