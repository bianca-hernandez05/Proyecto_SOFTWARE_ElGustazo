/**
 * =========================================================
 * EL BUEN GUSTO - EL GUSTAZO POS
 * Módulo de Gestión de Pedidos a Domicilio (Delivery)
 * Sierra Maestra, Managua
 * =========================================================
 */

let pedidosDelivery = [];
let clientesDelivery = [];
let productosDelivery = [];
let repartidoresDelivery = [];
let itemsNuevoPedido = [];
let ticketActual = null;
let pedidoFacturaActual = null;

// Inicialización del módulo
document.addEventListener('DOMContentLoaded', async () => {
    verificarAutenticacion(false);
    inicializarHeaderComun();
    await cargarDatosAuxiliares();
    await cargarTableroDelivery();

    // Auto-refresco cada 25 segundos
    setInterval(cargarTableroDelivery, 25000);
});

// Cargar clientes, platillos y repartidores
async function cargarDatosAuxiliares() {
    try {
        const [resCl, resPr, resRep] = await Promise.all([
            fetch('/api/clientes'),
            fetch('/api/productos'),
            fetch('/api/delivery/repartidores')
        ]);
        clientesDelivery = await resCl.json();
        productosDelivery = await resPr.json();
        repartidoresDelivery = await resRep.json();

        poblarSelectsAuxiliares();
    } catch (e) {
        console.error('Error cargando datos auxiliares de delivery:', e);
    }
}

function poblarSelectsAuxiliares() {
    // 1. Clientes
    const selCl = document.getElementById('select-del-cliente');
    if (selCl) {
        selCl.innerHTML = '<option value="">-- Seleccionar cliente o escribir abajo --</option>';
        clientesDelivery.forEach(cl => {
            const opt = document.createElement('option');
            opt.value = cl.id_cliente;
            opt.innerText = `${cl.nombre} (${cl.telefono || 'Sin tel'}) - ${cl.categoria}`;
            selCl.appendChild(opt);
        });
    }

    // 2. Platillos
    const selPr = document.getElementById('select-del-producto');
    if (selPr) {
        selPr.innerHTML = '';
        productosDelivery.forEach(pr => {
            const opt = document.createElement('option');
            opt.value = pr.id_producto;
            opt.innerText = `${pr.nombre} (C$ ${parseFloat(pr.precio).toFixed(2)})`;
            selPr.appendChild(opt);
        });
    }

    // 3. Repartidores
    const selRep = document.getElementById('select-del-repartidor');
    if (selRep) {
        selRep.innerHTML = '<option value="">Por asignar al empacar</option>';
        repartidoresDelivery.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.nombre;
            opt.innerText = `${r.nombre} (${r.vehiculo} ${r.placa || ''})`;
            selRep.appendChild(opt);
        });
    }
}

// Cargar y renderizar el tablero Kanban
async function cargarTableroDelivery() {
    try {
        const res = await fetch('/api/delivery/pedidos');
        pedidosDelivery = await res.json();
        renderizarTableroKanban(pedidosDelivery);
        actualizarKpisDelivery(pedidosDelivery);
    } catch (e) {
        console.error('Error cargando pedidos delivery:', e);
    }
}

// Actualización manual con respuesta visual instantánea
async function actualizarTableroManual() {
    const btn = document.getElementById('btn-actualizar-tablero');
    const icon = document.getElementById('icon-refresh-tablero');
    const text = document.getElementById('text-refresh-tablero');
    const board = document.querySelector('.delivery-kanban-board');

    if (btn) btn.disabled = true;
    if (icon) icon.classList.add('spin-animation');
    if (text) text.innerText = 'Actualizando...';
    if (board) {
        board.style.opacity = '0.6';
        board.style.transition = 'opacity 0.2s ease';
    }

    try {
        await cargarTableroDelivery();
        mostrarToast('Tablero de pedidos actualizado con éxito');
    } catch (err) {
        mostrarToast('Error al actualizar el tablero', 'danger');
    } finally {
        setTimeout(() => {
            if (icon) icon.classList.remove('spin-animation');
            if (text) text.innerText = 'Actualizar Tablero';
            if (btn) btn.disabled = false;
            if (board) board.style.opacity = '1';
        }, 350);
    }
}

function actualizarKpisDelivery(pedidos) {
    const pendientes = pedidos.filter(p => p.estado === 'PENDIENTE').length;
    const preparacion = pedidos.filter(p => p.estado === 'EN_PREPARACION').length;
    const listos = pedidos.filter(p => p.estado === 'LISTO').length;
    const camino = pedidos.filter(p => p.estado === 'EN_CAMINO').length;
    const entregados = pedidos.filter(p => p.estado === 'ENTREGADO').length;

    document.getElementById('kpi-del-pendientes').innerText = pendientes;
    document.getElementById('kpi-del-preparacion').innerText = preparacion;
    document.getElementById('kpi-del-listos').innerText = listos;
    document.getElementById('kpi-del-camino').innerText = camino;
    document.getElementById('kpi-del-entregados').innerText = entregados;

    document.getElementById('count-col-pendiente').innerText = pendientes;
    document.getElementById('count-col-preparacion').innerText = preparacion;
    document.getElementById('count-col-listo').innerText = listos;
    document.getElementById('count-col-camino').innerText = camino;
    document.getElementById('count-col-entregado').innerText = entregados;

    const activos = pendientes + preparacion + listos + camino;
    const badgeHeader = document.getElementById('badge-nav-delivery');
    if (badgeHeader) {
        badgeHeader.innerText = activos;
        badgeHeader.style.display = activos > 0 ? 'inline-flex' : 'none';
    }
}

// Audio sintetizado para transiciones de estado de delivery
function reproducirSonidoDelivery(tipo = 'pop') {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!window._delAudioCtx) {
            window._delAudioCtx = new AudioCtx();
        }
        if (window._delAudioCtx.state === 'suspended') {
            window._delAudioCtx.resume();
        }
        const ctx = window._delAudioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (tipo === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(540, now);
            osc.frequency.exponentialRampToValueAtTime(780, now + 0.07);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (tipo === 'success') {
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(554.37, now + 0.08);
            osc.frequency.setValueAtTime(659.25, now + 0.16);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
            osc.start(now);
            osc.stop(now + 0.32);
        }
    } catch (e) {
        // Silencioso
    }
}

// Monitoreo de tiempo para pedidos activos (sin cronómetro estresante, solo alerta si supera 30 min)
function obtenerAlertaTiempo(fechaStr, estado) {
    // Si ya está entregado o cancelado, NUNCA mostrar alertas de tiempo ni demoras
    if (!fechaStr || estado === 'ENTREGADO' || estado === 'CANCELADO') {
        return null;
    }

    try {
        const fecha = new Date(fechaStr.replace(' ', 'T'));
        const ahora = new Date();
        const diffMs = ahora.getTime() - fecha.getTime();
        const diffMin = Math.max(0, Math.floor(diffMs / 60000));

        if (isNaN(diffMin)) return null;

        // Solo mostrar alerta si ha pasado más de media hora (30 min) para recordar monitorear
        if (diffMin > 30) {
            return {
                texto: `Revisar (+30 min)`,
                clase: 'time-alerta-monitoreo',
                minutos: diffMin
            };
        }

        // Si tiene 30 minutos o menos, no mostrar nada para evitar estrés al personal
        return null;
    } catch (e) {
        return null;
    }
}

// Barra visual de 5 pasos en el pipeline
function generarPipelineSteps(estado) {
    const pasos = ['PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO', 'ENTREGADO'];
    const idxActual = pasos.indexOf(estado);
    let html = '<div class="card-pipeline-bar" title="Progreso del pedido: Pendiente > Cocina > Listo > En Camino > Entregado">';
    pasos.forEach((p, idx) => {
        let cl = 'pipeline-step';
        if (idx < idxActual) cl += ' completed';
        else if (idx === idxActual) cl += ' active';
        html += `<div class="${cl}"></div>`;
    });
    html += '</div>';
    return html;
}

function renderizarTableroKanban(pedidos) {
    const cols = {
        'PENDIENTE': document.getElementById('col-cards-pendiente'),
        'EN_PREPARACION': document.getElementById('col-cards-preparacion'),
        'LISTO': document.getElementById('col-cards-listo'),
        'EN_CAMINO': document.getElementById('col-cards-camino'),
        'ENTREGADO': document.getElementById('col-cards-entregado')
    };

    Object.values(cols).forEach(col => {
        if (col) col.innerHTML = '';
    });

    const usuarioActual = typeof obtenerUsuarioActual === 'function' ? obtenerUsuarioActual() : null;
    const esAdmin = usuarioActual && usuarioActual.id_rol === 1;

    pedidos.forEach(p => {
        const colElem = cols[p.estado];
        if (!colElem) return;

        const card = document.createElement('div');
        card.className = `kanban-card card-${p.estado.toLowerCase()}`;

        let itemsHtml = '';
        (p.items || []).forEach(it => {
            itemsHtml += `<div>• ${it.cantidad}x ${it.producto_nombre || it.nombre}</div>`;
        });

        // Botón de avance según estado
        let botonAvance = '';
        if (p.estado === 'PENDIENTE') {
            botonAvance = `<button class="btn-action-status btn-start-prep" onclick="cambiarEstadoPedido(${p.id_pedido}, 'EN_PREPARACION')">A Cocina (En Prep)</button>`;
        } else if (p.estado === 'EN_PREPARACION') {
            botonAvance = `<button class="btn-action-status btn-mark-ready" onclick="cambiarEstadoPedido(${p.id_pedido}, 'LISTO')">Marcar Listo</button>`;
        } else if (p.estado === 'LISTO') {
            botonAvance = `<button class="btn-action-status btn-dispatch" onclick="despacharEnCamino(${p.id_pedido})">Despachar en Camino</button>`;
        } else if (p.estado === 'EN_CAMINO') {
            botonAvance = `<button class="btn-action-status btn-delivered" onclick="cambiarEstadoPedido(${p.id_pedido}, 'ENTREGADO')">Confirmar Entrega y Cobro</button>`;
        } else {
            botonAvance = `
                <div style="display:flex; gap:6px; align-items:center; width:100%;">
                    <span class="badge-status-completed" style="flex:1;">Entregado con Éxito</span>
                    <button type="button" class="btn-card-archive" onclick="archivarPedidoIndividual(${p.id_pedido})" title="Archivar pedido para quitar del tablero (se conserva guardado en ventas e historial)">
                        Archivar
                    </button>
                </div>
            `;
        }

        const telLink = p.telefono ? (p.telefono || '').replace(/\D/g, '') : '';
        const alertaTiempo = obtenerAlertaTiempo(p.fecha_creacion, p.estado);
        const pipelineHtml = generarPipelineSteps(p.estado);

        card.innerHTML = `
            <div class="card-header-row">
                <div style="display:flex; align-items:center; gap:6px;">
                    <strong class="card-pedido-num">#${p.numero_pedido}</strong>
                    ${alertaTiempo ? `
                        <span class="card-time-badge ${alertaTiempo.clase}" title="Han pasado más de 30 minutos desde la recepción. Monitorear estado del pedido.">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                            ${alertaTiempo.texto}
                        </span>
                    ` : ''}
                </div>
                <span class="card-origen-badge ${p.origen === 'WHATSAPP' ? 'badge-wa' : 'badge-tel'}">
                    ${p.origen === 'WHATSAPP' ? 'WhatsApp' : 'Llamada'}
                </span>
            </div>
            ${pipelineHtml}

            <div class="card-cliente-title">${p.cliente_nombre}</div>
            <div class="card-tel">Tel: <a href="tel:${p.telefono}">${p.telefono || 'Sin teléfono'}</a></div>
            <div class="card-direccion"><span style="font-weight:700; color:#0284C7;">Dir:</span> ${p.direccion}</div>
            
            <div class="card-repartidor" style="display:flex; justify-content:space-between; align-items:center; background:#F8FAFC; padding:5px 8px; border-radius:6px; margin:5px 0; border:1px solid #E2E8F0;">
                <div>
                    <span style="font-weight:700; color:#334155; font-size:0.75rem;">Repartidor:</span>
                    <strong style="color:#0F172A; font-size:0.8rem;">${p.repartidor || 'Por asignar'}</strong>
                </div>
                <button type="button" class="btn-small" style="padding:2px 7px; font-size:0.72rem; background:#EA580C; font-weight:700;" onclick="abrirModalReasignarRepartidor(${p.id_pedido}, '${p.repartidor || ''}')" title="Reasignar repartidor libremente">
                    Cambiar
                </button>
            </div>
            ${p.notas ? `<div class="card-notas">Nota: ${p.notas}</div>` : ''}

            <div class="card-items-list">
                ${itemsHtml}
            </div>

            <div class="card-totales-bar">
                <span>Subtotal: C$ ${parseFloat(p.subtotal).toFixed(2)} | Envío: C$ ${parseFloat(p.costo_delivery).toFixed(2)}</span>
                <div class="card-total-val">TOTAL: C$ ${parseFloat(p.total).toFixed(2)}</div>
                <small class="card-pago-label">${p.id_metodo_pago === 1 ? 'Efectivo contra entrega' : 'Transferencia ' + (p.banco || '')}</small>
            </div>

            <div class="card-controls-grid">
                ${botonAvance}
            </div>

            <div class="card-footer-actions">
                <button type="button" class="card-btn-mini btn-comanda-cocina" onclick="verTicketCocina(${p.id_pedido})" title="Imprimir Comanda de Cocina / Despacho">
                    Comanda Cocina
                </button>
                <button type="button" class="card-btn-mini btn-factura-qr" onclick="verFacturaDelivery(${p.id_pedido})" title="Ver Factura con QR">
                    Factura & QR
                </button>
                <button type="button" class="card-btn-mini" style="background:#0F172A; color:#FFFFFF; font-weight:700;" onclick="imprimirTicketDeliveryTermico(${p.id_pedido})" title="Imprimir Ticket Térmico para Repartidor">
                    Ticket Térmico
                </button>
                ${esAdmin ? `
                    <button type="button" class="card-btn-mini btn-order-delete" onclick="eliminarPedidoDelivery(${p.id_pedido}, '${p.numero_pedido}')" title="Eliminar pedido permanentemente (Solo Administrador)">
                        Eliminar
                    </button>
                ` : ''}
            </div>
        `;

        colElem.appendChild(card);
    });
}

// Cambiar estado de pedido
async function cambiarEstadoPedido(idPedido, nuevoEstado, repartidor = null) {
    try {
        const usuario = obtenerUsuarioActual();
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                estado: nuevoEstado,
                repartidor: repartidor,
                id_usuario: usuario ? usuario.id_usuario : 1
            })
        });
        const data = await res.json();
        if (data.success) {
            reproducirSonidoDelivery(nuevoEstado === 'ENTREGADO' ? 'success' : 'pop');
            mostrarToast(`Pedido actualizado a ${nuevoEstado}.`);
            await cargarTableroDelivery();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        alert('Error conectando con el servidor.');
    }
}

// Despachar en camino seleccionando repartidor
function despacharEnCamino(idPedido) {
    const pedido = pedidosDelivery.find(p => p.id_pedido === idPedido);
    let repartidor = pedido ? pedido.repartidor : '';

    if (!repartidor) {
        const nombresRep = repartidoresDelivery.map((r, i) => `${i + 1}. ${r.nombre}`).join('\n');
        const eleg = prompt(`Seleccione el repartidor para la orden:\n\n${nombresRep}\n\nEscriba el nombre o número del motorizado:`);
        if (!eleg) return;
        const num = parseInt(eleg);
        if (!isNaN(num) && repartidoresDelivery[num - 1]) {
            repartidor = repartidoresDelivery[num - 1].nombre;
        } else {
            repartidor = eleg;
        }
    }

    cambiarEstadoPedido(idPedido, 'EN_CAMINO', repartidor);
}



// Modal Nuevo Pedido Delivery
function abrirModalNuevoPedidoDelivery() {
    itemsNuevoPedido = [];
    document.getElementById('txt-del-costo-envio').value = '30';
    document.getElementById('txt-del-notas').value = '';
    document.getElementById('txt-del-nombre').value = '';
    document.getElementById('txt-del-telefono').value = '';
    document.getElementById('txt-del-direccion').value = '';
    renderizarItemsNuevoPedido();
    calcularTotalesModalDelivery();
    document.getElementById('modal-nuevo-delivery').classList.add('open');
}

function cerrarModalNuevoPedidoDelivery() {
    document.getElementById('modal-nuevo-delivery').classList.remove('open');
}

function alCambiarClienteDelivery() {
    const sel = document.getElementById('select-del-cliente');
    const id = sel.value;
    if (!id) return;
    const cl = clientesDelivery.find(c => c.id_cliente === parseInt(id));
    if (cl) {
        document.getElementById('txt-del-nombre').value = cl.nombre;
        document.getElementById('txt-del-telefono').value = cl.telefono || '';
        document.getElementById('txt-del-direccion').value = cl.direccion || '';
    }
}

function alCambiarMetodoPagoDelivery() {
    const metodo = parseInt(document.getElementById('select-del-metodo-pago').value);
    const grpBanco = document.getElementById('group-del-banco');
    const grpRef = document.getElementById('group-del-referencia');
    if (metodo === 2) {
        grpBanco.style.display = 'block';
        grpRef.style.display = 'block';
    } else {
        grpBanco.style.display = 'none';
        grpRef.style.display = 'none';
    }
}

function agregarItemADelivery() {
    const sel = document.getElementById('select-del-producto');
    const idProd = parseInt(sel.value);
    const cant = parseInt(document.getElementById('txt-del-prod-cant').value) || 1;
    const producto = productosDelivery.find(p => p.id_producto === idProd);
    if (!producto) return;

    const idx = itemsNuevoPedido.findIndex(i => i.id_producto === idProd);
    if (idx !== -1) {
        itemsNuevoPedido[idx].cantidad += cant;
    } else {
        itemsNuevoPedido.push({
            id_producto: producto.id_producto,
            nombre: producto.nombre,
            precio: parseFloat(producto.precio),
            cantidad: cant
        });
    }

    renderizarItemsNuevoPedido();
    calcularTotalesModalDelivery();
}

function eliminarItemDelivery(idx) {
    itemsNuevoPedido.splice(idx, 1);
    renderizarItemsNuevoPedido();
    calcularTotalesModalDelivery();
}

function renderizarItemsNuevoPedido() {
    const tbody = document.getElementById('del-items-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (itemsNuevoPedido.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#94A3B8; padding:15px;">Agregue platillos al pedido</td></tr>';
        return;
    }

    itemsNuevoPedido.forEach((it, idx) => {
        const sub = it.precio * it.cantidad;
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${it.nombre}</strong></td>
            <td style="text-align:center;">${it.cantidad}</td>
            <td style="text-align:right;">C$ ${it.precio.toFixed(2)}</td>
            <td style="text-align:right; font-weight:700;">C$ ${sub.toFixed(2)}</td>
            <td style="text-align:center;">
                <button type="button" class="cart-del-btn" onclick="eliminarItemDelivery(${idx})">&times;</button>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function calcularTotalesModalDelivery() {
    const subtotal = itemsNuevoPedido.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
    const envio = parseFloat(document.getElementById('txt-del-costo-envio').value) || 0;
    const total = parseFloat((subtotal + envio).toFixed(2));

    document.getElementById('del-lbl-subtotal').innerText = `C$ ${subtotal.toFixed(2)}`;
    document.getElementById('del-lbl-envio').innerText = `C$ ${envio.toFixed(2)}`;
    const lblIva = document.getElementById('del-lbl-iva');
    if (lblIva) lblIva.innerText = `C$ 0.00`;
    document.getElementById('del-lbl-total').innerText = `C$ ${total.toFixed(2)}`;
}

async function guardarPedidoDelivery(e) {
    e.preventDefault();
    if (itemsNuevoPedido.length === 0) {
        alert('Debe agregar al menos un platillo o combo a la orden de delivery.');
        return;
    }

    const clienteNombre = document.getElementById('txt-del-nombre').value.trim();
    const telefono = document.getElementById('txt-del-telefono').value.trim();
    const direccion = document.getElementById('txt-del-direccion').value.trim();
    const origen = document.getElementById('txt-del-origen').value;
    const repartidor = document.getElementById('select-del-repartidor').value;
    const costoEnvio = parseFloat(document.getElementById('txt-del-costo-envio').value) || 0;
    const notas = document.getElementById('txt-del-notas').value.trim();
    const idMetodo = parseInt(document.getElementById('select-del-metodo-pago').value);
    const banco = idMetodo === 2 ? document.getElementById('select-del-banco').value : null;
    const referencia = idMetodo === 2 ? document.getElementById('txt-del-referencia').value.trim() : null;

    const selCl = document.getElementById('select-del-cliente');
    const idCliente = selCl.value ? parseInt(selCl.value) : null;
    const usuario = obtenerUsuarioActual();

    const payload = {
        id_cliente: idCliente,
        cliente_nombre: clienteNombre,
        telefono,
        direccion,
        origen,
        repartidor: repartidor || null,
        notas,
        costo_delivery: costoEnvio,
        items: itemsNuevoPedido,
        id_metodo_pago: idMetodo,
        banco,
        referencia_transferencia: referencia,
        id_usuario: usuario ? usuario.id_usuario : 1
    };

    try {
        const res = await fetch('/api/delivery/pedidos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Pedido de delivery registrado y enviado a cocina.');
            cerrarModalNuevoPedidoDelivery();
            await cargarTableroDelivery();
        } else {
            alert('Error al guardar: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión al registrar pedido.');
    }
}

// Vista de Ticket de Cocina y Despacho
async function verTicketCocina(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/ticket`);
        const data = await res.json();
        if (data.success) {
            ticketActual = data.ticket;
            document.getElementById('preview-ticket-cocina').innerText = data.ticket;
            document.getElementById('modal-ticket-cocina').classList.add('open');
        }
    } catch (e) {
        alert('Error al cargar ticket de cocina.');
    }
}

function imprimirTicketCocina() {
    if (!ticketActual) return;
    let printArea = document.getElementById('printable-thermal-ticket');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'printable-thermal-ticket';
        document.body.appendChild(printArea);
    }
    printArea.innerHTML = `<pre style="font-family: monospace; font-size:12px; margin:0;">${ticketActual}</pre>`;
    window.print();
}

function cerrarModalTicketCocina() {
    document.getElementById('modal-ticket-cocina').classList.remove('open');
}

// Vista de Factura Comercial Delivery con QR
async function verFacturaDelivery(idPedido) {
    const p = pedidosDelivery.find(item => item.id_pedido === idPedido);
    if (!p) return;
    pedidoFacturaActual = p;

    document.getElementById('fac-del-num').innerText = `#${p.numero_pedido}`;
    document.getElementById('fac-del-fecha').innerText = new Date(p.fecha_creacion).toLocaleString('es-NI');
    document.getElementById('fac-del-cliente').innerText = p.cliente_nombre;
    document.getElementById('fac-del-telefono').innerText = p.telefono || 'Sin teléfono';
    document.getElementById('fac-del-repartidor').innerText = p.repartidor || 'Por asignar';
    document.getElementById('fac-del-direccion').innerText = p.direccion;

    const tbody = document.getElementById('fac-del-items-body');
    tbody.innerHTML = '';
    (p.items || []).forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">${it.cantidad}</td>
            <td><strong>${it.producto_nombre || it.nombre}</strong></td>
            <td style="text-align:right;">C$ ${parseFloat(it.precio_unitario || it.precio).toFixed(2)}</td>
            <td style="text-align:right; font-weight:700;">C$ ${parseFloat(it.subtotal).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('fac-del-subtotal').innerText = `C$ ${parseFloat(p.subtotal).toFixed(2)}`;
    document.getElementById('fac-del-costo-envio').innerText = `C$ ${parseFloat(p.costo_delivery).toFixed(2)}`;
    document.getElementById('fac-del-iva').innerText = `C$ ${parseFloat(p.impuesto).toFixed(2)}`;
    document.getElementById('fac-del-total').innerText = `C$ ${parseFloat(p.total).toFixed(2)}`;

    const pagoLabel = p.id_metodo_pago === 1 ? 'Efectivo contra entrega' : `Transferencia ${p.banco || ''} ${p.referencia_transferencia ? '(' + p.referencia_transferencia + ')' : ''}`;
    document.getElementById('fac-del-pago-info').innerText = `Pago: ${pagoLabel}`;

    // Generar código QR offline nítido que apunta directamente a la Factura Digital (idéntica al PDF)
    const qrContainer = document.getElementById('factura-del-qr');
    qrContainer.innerHTML = '';

    let baseUrl = window.location.origin;
    try {
        const resInfo = await fetch('/api/server-info');
        const sInfo = await resInfo.json();
        if (sInfo && sInfo.baseUrl) {
            baseUrl = sInfo.baseUrl;
        }
    } catch (e) {
        // Fallback a window.location.origin
    }

    const digitalInvoiceUrl = `${baseUrl}/comprobante.html?fac=${encodeURIComponent(p.numero_pedido)}`;

    if (window.QRCode) {
        new QRCode(qrContainer, {
            text: digitalInvoiceUrl,
            width: 150,
            height: 150,
            margin: 2
        });
    }

    const lnkProbarDel = document.getElementById('lnk-probar-qr-del');
    if (lnkProbarDel) {
        lnkProbarDel.href = digitalInvoiceUrl;
    }

    document.getElementById('modal-factura-delivery').classList.add('open');
}

function imprimirFacturaDeliveryPDF() {
    window.print();
}

// Impresión de Ticket Térmico para Delivery (Impresora física 58mm / 80mm)
async function imprimirTicketDeliveryTermico(idPedido = null) {
    let p = idPedido ? pedidosDelivery.find(item => item.id_pedido === idPedido) : pedidoFacturaActual;
    if (!p) {
        alert('No se encontró la información del pedido.');
        return;
    }

    if (idPedido && (!pedidoFacturaActual || pedidoFacturaActual.id_pedido !== idPedido)) {
        await verFacturaDelivery(idPedido);
        p = pedidoFacturaActual;
    }

    const numPedido = p.numero_pedido || `DEL-${p.id_pedido}`;
    const fecha = p.fecha_creacion ? new Date(p.fecha_creacion).toLocaleString('es-NI') : new Date().toLocaleString('es-NI');

    let ticketTexto = `================================\n`;
    ticketTexto += `       EL GUSTAZO POS\n`;
    ticketTexto += `  El Buen Gusto A Tu Paladar\n`;
    ticketTexto += `   Sierra Maestra, Managua\n`;
    ticketTexto += `================================\n`;
    ticketTexto += `TICKET ENTREGA A DOMICILIO\n`;
    ticketTexto += `Pedido: #${numPedido}\n`;
    ticketTexto += `Fecha: ${fecha}\n`;
    ticketTexto += `Cliente: ${p.cliente_nombre || 'Consumidor Final'}\n`;
    ticketTexto += `Teléfono: ${p.telefono || '--'}\n`;
    ticketTexto += `Dirección: ${p.direccion || '--'}\n`;
    if (p.repartidor) {
        ticketTexto += `Repartidor: ${p.repartidor}\n`;
    }
    if (p.notas) {
        ticketTexto += `Notas: ${p.notas}\n`;
    }
    ticketTexto += `--------------------------------\n`;
    ticketTexto += `CANT  DESCRIPCION       TOTAL\n`;
    ticketTexto += `--------------------------------\n`;

    (p.items || []).forEach(it => {
        const cant = (it.cantidad || 1).toString().padEnd(4, ' ');
        const nom = (it.producto_nombre || it.nombre || 'Item').substring(0, 16).padEnd(16, ' ');
        const sub = `C$ ${(parseFloat(it.subtotal || (it.precio_unitario * it.cantidad) || 0)).toFixed(2)}`.padStart(10, ' ');
        ticketTexto += `${cant} ${nom} ${sub}\n`;
    });

    ticketTexto += `--------------------------------\n`;
    ticketTexto += `Subtotal:       C$ ${parseFloat(p.subtotal || 0).toFixed(2)}\n`;
    if (parseFloat(p.costo_delivery || 0) > 0) {
        ticketTexto += `Envío Delivery: C$ ${parseFloat(p.costo_delivery).toFixed(2)}\n`;
    }
    ticketTexto += `TOTAL A PAGAR:  C$ ${parseFloat(p.total || 0).toFixed(2)}\n`;
    ticketTexto += `Pago: ${p.metodo_pago_nombre || 'Efectivo'}\n`;
    ticketTexto += `================================\n`;
    ticketTexto += `  ¡Gracias por su preferencia!\n`;
    ticketTexto += `    El Gustazo - Sierra Maestra\n`;
    ticketTexto += `================================\n\n\n`;

    let printArea = document.getElementById('printable-thermal-ticket');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'printable-thermal-ticket';
        document.body.appendChild(printArea);
    }
    printArea.className = 'activo';
    document.body.classList.add('imprimiendo-ticket');
    printArea.innerHTML = `<pre>${ticketTexto}</pre>`;
    window.print();
    setTimeout(() => {
        document.body.classList.remove('imprimiendo-ticket');
        if (printArea) printArea.classList.remove('activo');
    }, 1000);
}

function cerrarModalFacturaDelivery() {
    document.getElementById('modal-factura-delivery').classList.remove('open');
}

// Utilidades globales requeridas
function obtenerUsuarioActual() {
    try {
        const userJson = localStorage.getItem('elgustazo_user');
        return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
        return null;
    }
}

function verificarAutenticacion() {
    const usuario = obtenerUsuarioActual();
    if (!usuario) {
        window.location.href = 'login.html';
        return null;
    }
    return usuario;
}

// Función global para peticiones HTTP con credenciales y rol (RBAC)
function fetchAuth(url, options = {}) {
    const usuario = obtenerUsuarioActual();
    const headers = options.headers ? { ...options.headers } : {};
    if (usuario) {
        headers['x-user-id'] = String(usuario.id_usuario);
        headers['x-user-role'] = String(usuario.id_rol);
    }
    return fetch(url, { ...options, headers });
}

function inicializarHeaderComun() {
    const usuario = obtenerUsuarioActual();
    if (!usuario) return;

    const spanUser = document.getElementById('header-user-name');
    const spanRol = document.getElementById('header-user-role');
    if (spanUser) spanUser.innerText = usuario.nombre;
    if (spanRol) spanRol.innerText = usuario.rol;

    if (usuario.id_rol !== 1) {
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
    }
}

function cerrarSesion() {
    localStorage.removeItem('elgustazo_user');
    window.location.href = 'login.html';
}

function mostrarToast(mensaje, tipo = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.position = 'fixed';
        container.style.bottom = '20px';
        container.style.right = '20px';
        container.style.zIndex = '9999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.fontWeight = 'bold';
    toast.style.color = '#FFFFFF';
    toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.15)';
    toast.style.fontSize = '0.9rem';
    toast.style.transition = 'all 0.3s';
    toast.innerText = mensaje;

    if (tipo === 'success') toast.style.background = '#16A34A';
    else if (tipo === 'danger') toast.style.background = '#DC2626';
    else if (tipo === 'warning') toast.style.background = '#D97706';
    else toast.style.background = '#0284C7';

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// =========================================================
// GESTIÓN Y LIBRE ALBEDRÍO DE REPARTIDORES (CRUD & REASIGNACIÓN)
// =========================================================
function abrirModalGestionRepartidores() {
    renderizarTablaRepartidores();
    cancelarEdicionRepartidor();
    document.getElementById('modal-gestion-repartidores').classList.add('open');
}

function cerrarModalGestionRepartidores() {
    document.getElementById('modal-gestion-repartidores').classList.remove('open');
}

function renderizarTablaRepartidores() {
    const tbody = document.getElementById('tabla-repartidores-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!repartidoresDelivery || repartidoresDelivery.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#94A3B8;">No hay repartidores registrados.</td></tr>';
        return;
    }

    const usuarioActual = obtenerUsuarioActual();
    const esAdmin = usuarioActual && usuarioActual.id_rol === 1;

    repartidoresDelivery.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${r.nombre}</strong></td>
            <td>${r.telefono || '--'}</td>
            <td>${r.vehiculo || 'Moto'}</td>
            <td>${r.placa || '--'}</td>
            <td style="text-align:center; white-space:nowrap;">
                <button type="button" class="btn-small" style="background:#0284C7; padding:3px 8px; font-size:0.75rem;" onclick="editarRepartidor(${r.id_repartidor})">
                    Editar
                </button>
                ${esAdmin ? `
                <button type="button" class="btn-small" style="background:#EF4444; padding:3px 8px; font-size:0.75rem;" onclick="eliminarRepartidor(${r.id_repartidor}, '${r.nombre}')">
                    Eliminar
                </button>` : ''}
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function editarRepartidor(id) {
    const rep = repartidoresDelivery.find(r => r.id_repartidor === id);
    if (!rep) return;

    document.getElementById('txt-rep-id').value = rep.id_repartidor;
    document.getElementById('txt-rep-nombre').value = rep.nombre;
    document.getElementById('txt-rep-telefono').value = rep.telefono || '';
    document.getElementById('txt-rep-vehiculo').value = rep.vehiculo || 'Moto';
    document.getElementById('txt-rep-placa').value = rep.placa || '';

    document.getElementById('lbl-rep-form-title').innerText = `Editar Repartidor: ${rep.nombre}`;
    document.getElementById('btn-rep-guardar').innerText = 'Guardar Cambios';
    document.getElementById('btn-rep-cancelar-edit').style.display = 'inline-block';
    document.getElementById('txt-rep-nombre').focus();
}

function cancelarEdicionRepartidor() {
    document.getElementById('txt-rep-id').value = '';
    document.getElementById('txt-rep-nombre').value = '';
    document.getElementById('txt-rep-telefono').value = '';
    document.getElementById('txt-rep-vehiculo').value = 'Moto';
    document.getElementById('txt-rep-placa').value = '';

    document.getElementById('lbl-rep-form-title').innerText = 'Registrar Nuevo Repartidor';
    document.getElementById('btn-rep-guardar').innerText = 'Guardar Repartidor';
    document.getElementById('btn-rep-cancelar-edit').style.display = 'none';
}

async function guardarRepartidor(e) {
    e.preventDefault();
    const id = document.getElementById('txt-rep-id').value;
    const nombre = document.getElementById('txt-rep-nombre').value.trim();
    const telefono = document.getElementById('txt-rep-telefono').value.trim();
    const vehiculo = document.getElementById('txt-rep-vehiculo').value;
    const placa = document.getElementById('txt-rep-placa').value.trim();

    if (!nombre) {
        alert('Ingrese el nombre del repartidor.');
        return;
    }

    const payload = { nombre, telefono, vehiculo, placa };
    const url = id ? `/api/delivery/repartidores/${id}` : '/api/delivery/repartidores';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(id ? 'Repartidor actualizado con éxito.' : 'Repartidor registrado con éxito.');
            cancelarEdicionRepartidor();
            await cargarDatosAuxiliares();
            renderizarTablaRepartidores();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión al guardar repartidor.');
    }
}

async function eliminarRepartidor(id, nombre) {
    if (!confirm(`¿Está seguro de eliminar o desactivar al repartidor "${nombre}"?`)) return;

    try {
        const res = await fetchAuth(`/api/delivery/repartidores/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            if (res.status === 403) {
                alert('Acceso Denegado: Solo el Administrador tiene autorización para eliminar o desactivar repartidores.');
                return;
            }
            if (res.status === 404) {
                alert('El servidor aún no ha cargado la nueva ruta de eliminación en memoria. Por favor reinicia tu terminal con Ctrl+C y ejecuta nuevamente "node src/server.js", luego recarga la página.');
                return;
            }
            const errData = await res.json().catch(() => ({ error: 'Error del servidor' }));
            alert('Error al eliminar: ' + (errData.error || `Código HTTP ${res.status}`));
            return;
        }
        const data = await res.json();
        if (data.success) {
            mostrarToast('Repartidor desactivado.');
            await cargarDatosAuxiliares();
            renderizarTablaRepartidores();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión al eliminar repartidor.');
    }
}

// Reasignación rápida en pedidos
function abrirModalReasignarRepartidor(idPedido, repartidorActual) {
    document.getElementById('txt-reasignar-id-pedido').value = idPedido;
    const select = document.getElementById('select-nuevo-repartidor');
    select.innerHTML = '<option value="">-- Por asignar / Sin repartidor --</option>';

    repartidoresDelivery.forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.nombre;
        opt.innerText = `${r.nombre} (${r.vehiculo} ${r.placa || ''})`;
        if (r.nombre === repartidorActual) opt.selected = true;
        select.appendChild(opt);
    });

    document.getElementById('modal-reasignar-repartidor').classList.add('open');
}

function cerrarModalReasignarRepartidor() {
    document.getElementById('modal-reasignar-repartidor').classList.remove('open');
}

async function guardarReasignacionRepartidor(e) {
    e.preventDefault();
    const idPedido = document.getElementById('txt-reasignar-id-pedido').value;
    const nuevoRep = document.getElementById('select-nuevo-repartidor').value;

    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/repartidor`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ repartidor: nuevoRep })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(`Repartidor asignado a pedido #${idPedido}: ${nuevoRep || 'Sin asignar'}`);
            cerrarModalReasignarRepartidor();
            await cargarTableroDelivery();
        } else {
            alert('Error al reasignar: ' + data.error);
        }
    } catch (err) {
        alert('Error de conexión al reasignar repartidor.');
    }
}

// ==========================================
// ARCHIVADO Y GESTIÓN LIMPIA DE PEDIDOS ENTREGADOS
// ==========================================

// Archivar todos los pedidos entregados con un solo clic para despejar el tablero
async function archivarPedidosEntregados() {
    const confirmacion = confirm('¿Desea archivar todos los pedidos entregados para despejar el tablero?\n\nLos pedidos quedarán 100% guardados en el sistema, facturación y reportes, pero ya no saturarán la pantalla.');
    if (!confirmacion) return;

    try {
        const res = await fetch('/api/delivery/pedidos/archivar-entregados', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(data.mensaje || 'Pedidos entregados archivados correctamente.');
            await cargarTableroDelivery();
        } else {
            alert('Error al archivar: ' + (data.error || 'No se pudo completar la operación.'));
        }
    } catch (e) {
        alert('Error de conexión al archivar pedidos entregados.');
    }
}

// Archivar pedido individual
async function archivarPedidoIndividual(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/archivar`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archivado: 1 })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Pedido archivado del tablero.');
            await cargarTableroDelivery();
        } else {
            alert('Error al archivar pedido: ' + (data.error || 'No se pudo completar'));
        }
    } catch (e) {
        alert('Error de conexión al archivar pedido.');
    }
}

// Eliminar pedido permanentemente (Exclusivo Administrador)
async function eliminarPedidoDelivery(idPedido, numeroPedido) {
    const usuario = typeof obtenerUsuarioActual === 'function' ? obtenerUsuarioActual() : null;
    if (!usuario || usuario.id_rol !== 1) {
        alert('Solo el Administrador tiene permiso para eliminar pedidos.');
        return;
    }

    const conf = confirm(`¿Está seguro de eliminar permanentemente el pedido #${numeroPedido}?\n\nEsta acción solo debe usarse para pedidos de prueba erróneos.`);
    if (!conf) return;

    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
                'x-user-role': String(usuario.id_rol)
            }
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(`Pedido #${numeroPedido} eliminado permanentemente.`);
            await cargarTableroDelivery();
        } else {
            alert('Error al eliminar pedido: ' + (data.error || 'No se pudo eliminar'));
        }
    } catch (e) {
        alert('Error de conexión al eliminar pedido.');
    }
}

// Modal Historial de Pedidos Delivery Archivados
function abrirModalHistorialArchivados() {
    const modal = document.getElementById('modal-historial-archivados');
    if (!modal) return;
    modal.classList.add('open');
    cargarPedidosArchivados();
}

function cerrarModalHistorialArchivados() {
    const modal = document.getElementById('modal-historial-archivados');
    if (modal) modal.classList.remove('open');
}

async function cargarPedidosArchivados() {
    const tbody = document.getElementById('tabla-archivados-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#64748B;">Cargando pedidos archivados...</td></tr>';

    try {
        const res = await fetch('/api/delivery/pedidos?ver_archivados=1');
        const archivados = await res.json();

        if (!archivados || archivados.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:25px; color:#94A3B8;">No hay pedidos archivados en el historial.</td></tr>';
            return;
        }

        tbody.innerHTML = '';
        archivados.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>#${p.numero_pedido}</strong></td>
                <td>${new Date(p.fecha_creacion).toLocaleDateString('es-NI')} ${new Date(p.fecha_creacion).toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' })}</td>
                <td><strong>${p.cliente_nombre}</strong><br><small style="color:#64748B;">Tel: ${p.telefono || '--'}</small></td>
                <td>${p.direccion}</td>
                <td><strong>C$ ${parseFloat(p.total).toFixed(2)}</strong></td>
                <td style="text-align:center; white-space:nowrap;">
                    <button type="button" class="btn-small" style="background:#0284C7; padding:3px 8px; font-size:0.75rem;" onclick="verFacturaDelivery(${p.id_pedido})" title="Ver factura y QR del pedido">
                        Factura & QR
                    </button>
                    <button type="button" class="btn-small" style="background:#16A34A; padding:3px 8px; font-size:0.75rem;" onclick="desarchivarPedido(${p.id_pedido})" title="Restaurar al tablero Kanban">
                        Restaurar
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (e) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:20px; color:#EF4444;">Error al cargar historial de pedidos archivados.</td></tr>';
    }
}

async function desarchivarPedido(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/archivar`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ archivado: 0 })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Pedido restaurado al tablero Kanban.');
            await cargarPedidosArchivados();
            await cargarTableroDelivery();
        } else {
            alert('Error al restaurar: ' + (data.error || 'No se pudo restaurar'));
        }
    } catch (e) {
        alert('Error al desarchivar pedido.');
    }
}

