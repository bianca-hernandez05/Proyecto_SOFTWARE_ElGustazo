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
            botonAvance = `<span class="badge-status-completed">Entregado con Éxito</span>`;
        }

        const telLink = p.telefono ? (p.telefono || '').replace(/\D/g, '') : '';

        card.innerHTML = `
            <div class="card-header-row">
                <strong class="card-pedido-num">#${p.numero_pedido}</strong>
                <span class="card-origen-badge ${p.origen === 'WHATSAPP' ? 'badge-wa' : 'badge-tel'}">
                    ${p.origen === 'WHATSAPP' ? 'WhatsApp' : 'Llamada'}
                </span>
            </div>

            <div class="card-cliente-title">${p.cliente_nombre}</div>
            <div class="card-tel">Tel: <a href="tel:${p.telefono}">${p.telefono || 'Sin teléfono'}</a></div>
            <div class="card-direccion"><span style="font-weight:700; color:#0284C7;">Dir:</span> ${p.direccion}</div>
            
            ${p.repartidor ? `<div class="card-repartidor"><span style="font-weight:700; color:#1E293B;">Repartidor:</span> <strong>${p.repartidor}</strong></div>` : ''}
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
                ${p.estado === 'LISTO' ? `
                    <button type="button" class="card-btn-wa" onclick="notificarClienteListo(${p.id_pedido})">
                        Avisar Listo
                    </button>
                ` : ''}
                ${p.estado === 'EN_CAMINO' ? `
                    <button type="button" class="card-btn-wa" onclick="notificarClienteEnCamino(${p.id_pedido})">
                        Avisar en Camino
                    </button>
                    <button type="button" class="card-btn-mini btn-ficha-moto" onclick="enviarFichaAMotorizado(${p.id_pedido})">
                        Ficha Motorizado
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

// Avisos de WhatsApp con 1 clic
async function notificarClienteListo(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/mensajes-whatsapp`);
        const data = await res.json();
        if (data.cliente_listo && data.cliente_listo.link) {
            window.open(data.cliente_listo.link, '_blank');
        }
    } catch (e) {
        alert('Error generando enlace de WhatsApp.');
    }
}

async function notificarClienteEnCamino(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/mensajes-whatsapp`);
        const data = await res.json();
        if (data.cliente_en_camino && data.cliente_en_camino.link) {
            window.open(data.cliente_en_camino.link, '_blank');
        }
    } catch (e) {
        alert('Error generando enlace de WhatsApp.');
    }
}

async function enviarFichaAMotorizado(idPedido) {
    try {
        const res = await fetch(`/api/delivery/pedidos/${idPedido}/mensajes-whatsapp`);
        const data = await res.json();
        if (data.repartidor && data.repartidor.link) {
            window.open(data.repartidor.link, '_blank');
        }
    } catch (e) {
        alert('Error generando enlace para repartidor.');
    }
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

    // Generar código QR offline nítido y universal
    const qrContainer = document.getElementById('factura-del-qr');
    qrContainer.innerHTML = '';

    const telClean = (p.telefono || '').replace(/\D/g, '');
    const waPhone = telClean.length === 8 ? '505' + telClean : telClean;
    const waText = `*EL BUEN GUSTO - EL GUSTAZO (DELIVERY)*\n` +
        `Pedido: ${p.numero_pedido}\n` +
        `Cliente: ${p.cliente_nombre}\n` +
        `Dirección: ${p.direccion}\n` +
        `Total: C$ ${parseFloat(p.total).toFixed(2)}\n` +
        `Repartidor: ${p.repartidor || 'Por asignar'}\n` +
        `¡Muchas gracias por su preferencia!`;
    const waLink = waPhone ? `https://wa.me/${waPhone}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`;

    if (window.QRCode) {
        new QRCode(qrContainer, {
            text: waLink,
            width: 150,
            height: 150,
            margin: 2
        });
    }

    const lnkProbarDel = document.getElementById('lnk-probar-qr-del');
    if (lnkProbarDel) {
        lnkProbarDel.href = waLink;
    }

    document.getElementById('modal-factura-delivery').classList.add('open');
}

function imprimirFacturaDeliveryPDF() {
    window.print();
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
