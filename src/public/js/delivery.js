/**
 * =============================================================================
 * EL BUEN GUSTO - EL GUSTAZO POS & GESTIÓN INTEGRAL
 * Módulo de Gestión de Pedidos a Domicilio (Delivery)
 * Sierra Maestra, Managua - Operación 100% Offline
 * =============================================================================
 * 
 * ¿POR QUÉ EXISTE ESTE ARCHIVO (delivery.js)?
 * Este archivo gestiona el flujo operativo completo de pedidos para entrega a domicilio
 * desde que son recibidos (vía WhatsApp o llamada telefónica), pasando por la cocina,
 * asignación de repartidores motorizados, hasta la entrega y cobro final.
 * 
 * RAZONES ARQUITECTÓNICAS Y DE NEGOCIO:
 * 1. Tablero Kanban Visual en Tiempo Real: Organiza los pedidos en 5 columnas
 *    (Pendiente, En Preparación, Listo, En Camino, Entregado) para que la cocina
 *    y el despachador sepan con exactitud el estado de cada comanda.
 * 2. Auto-refresco Periódico (Polling Local): Se actualiza automáticamente cada
 *    25 segundos para reflejar pedidos registrados desde el POS o desde otros
 *    dispositivos conectados a la red local (Wi-Fi del restaurante).
 * 3. Alerta de Tiempo Inteligente (Sin Estrés): No muestra un cronómetro segundo a
 *    segundo que estrese a los cocineros, sino un discreto aviso amarillo si un
 *    pedido supera los 30 minutos desde su recepción para recordarle al personal revisarlo.
 * 4. Gestión Libre de Repartidores: Permite registrar, editar y reasignar motorizados
 *    fácilmente entre pedidos sin trabas burocráticas.
 * 5. Impresión de Tickets Térmicos de Entrega: Genera tickets con dirección clara,
 *    referencias y desglose financiero para que el motorizado entregue sin perderse
 *    en los barrios de Managua.
 * 6. Eliminación de Códigos QR Locales: Se eliminó la generación de códigos QR de red
 *    local en las facturas de delivery, ya que los clientes en sus casas intentaban
 *    escanearlos con sus datos móviles (LTE) y no podían acceder a la IP interna (192.168.x.x).
 * =============================================================================
 */

// =============================================================================
// SECCIÓN 1: ESTADO GLOBAL DEL MÓDULO DE DELIVERY
// =============================================================================

let pedidosDelivery = [];        // Lista de pedidos activos cargados en el tablero Kanban
let clientesDelivery = [];       // Directorio de clientes registrados con dirección y teléfono
let productosDelivery = [];      // Catálogo de platillos para agregar a nuevos pedidos
let repartidoresDelivery = [];   // Plantilla de repartidores/motorizados disponibles
let itemsNuevoPedido = [];       // Ítems temporales agregados al modal de nuevo pedido
let ticketActual = null;         // Texto en formato ESC/POS del ticket de cocina seleccionado
let pedidoFacturaActual = null;  // Objeto del pedido actualmente visualizado en el modal de factura

/**
 * Evento de arranque al cargar el DOM de delivery.html.
 * 
 * ¿POR QUÉ SE PUSO?
 * Ejecuta la verificación de seguridad, inicializa el encabezado institucional,
 * descarga en paralelo los catálogos auxiliares y monta el tablero Kanban.
 * Además, inicia el intervalo de refresco automático cada 25 segundos para sincronizar
 * con ventas que ingresen desde el mostrador (POS).
 */
document.addEventListener('DOMContentLoaded', async () => {
    verificarAutenticacion(false);
    inicializarHeaderComun();
    await cargarDatosAuxiliares();
    await cargarTableroDelivery();

    // Auto-refresco cada 25 segundos para sincronización en red local
    setInterval(cargarTableroDelivery, 25000);
});


// =============================================================================
// SECCIÓN 2: CARGA DE DATOS AUXILIARES Y SELECTS
// =============================================================================

/**
 * Carga clientes, platillos y repartidores en paralelo desde el servidor Node.js.
 * 
 * ¿POR QUÉ SE PUSO?
 * Utiliza `Promise.all` para ejecutar las 3 peticiones HTTP simultáneamente,
 * reduciendo el tiempo de espera del usuario al abrir la pantalla de Delivery.
 */
let tiemposEntregaDelivery = []; // Catálogo de tiempos y zonas de entrega

/**
 * Carga clientes, platillos, repartidores y zonas de entrega en paralelo.
 * 
 * ¿POR QUÉ SE PUSO?
 * Utiliza `Promise.all` para ejecutar las peticiones HTTP simultáneamente,
 * reduciendo el tiempo de espera del usuario al abrir la pantalla de Delivery.
 */
async function cargarDatosAuxiliares() {
    try {
        const [resCl, resPr, resRep, resTiempos] = await Promise.all([
            fetch('/api/clientes'),
            fetch('/api/productos'),
            fetch('/api/delivery/repartidores'),
            fetch('/api/delivery/tiempos')
        ]);
        clientesDelivery = await resCl.json();
        productosDelivery = await resPr.json();
        repartidoresDelivery = await resRep.json();
        tiemposEntregaDelivery = await resTiempos.json();

        poblarSelectsAuxiliares();
    } catch (e) {
        console.error('Error cargando datos auxiliares de delivery:', e);
    }
}

/**
 * Rellena los desplegables (<select>) de clientes, platillos, repartidores y zonas.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite que los formularios modales cuenten con las opciones actualizadas directamente.
 */
function poblarSelectsAuxiliares() {
    // 1. Desplegable de Clientes
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

    // 2. Desplegable de Platillos
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

    // 3. Desplegable de Repartidores
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

    // 4. Desplegable de Zonas & Tiempos de Entrega
    const selZonas = document.getElementById('select-del-zona-tiempo');
    if (selZonas) {
        selZonas.innerHTML = '';
        tiemposEntregaDelivery.filter(z => z.activo !== 0).forEach(z => {
            const opt = document.createElement('option');
            opt.value = z.id_tiempo_entrega;
            opt.innerText = `${z.nombre_zona} (~${z.tiempo_estimado_min} min - C$ ${parseFloat(z.costo_envio).toFixed(2)})`;
            selZonas.appendChild(opt);
        });
        if (tiemposEntregaDelivery.length > 0) {
            alSeleccionarZonaDelivery();
        }
    }
}

/**
 * Actualiza el tiempo estimado y el costo de delivery al cambiar la zona seleccionada.
 */
function alSeleccionarZonaDelivery() {
    const selZonas = document.getElementById('select-del-zona-tiempo');
    if (!selZonas) return;
    const idZona = parseInt(selZonas.value);
    const zona = tiemposEntregaDelivery.find(z => z.id_tiempo_entrega === idZona);
    if (zona) {
        const inpTiempo = document.getElementById('txt-del-tiempo-est');
        const inpCosto = document.getElementById('txt-del-costo-envio');
        if (inpTiempo) inpTiempo.value = zona.tiempo_estimado_min;
        if (inpCosto) {
            inpCosto.value = zona.costo_envio;
            calcularTotalesModalDelivery();
        }
    }
}


// =============================================================================
// SECCIÓN 3: TABLERO KANBAN Y MÉTRICAS OPERATIVAS (KPIS)
// =============================================================================

/**
 * Consulta la lista de pedidos de delivery y los dibuja en las 5 columnas Kanban.
 * 
 * ¿POR QUÉ SE PUSO?
 * Mantiene la vista sincronizada con el estado real de la cocina y el despacho.
 */
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

/**
 * Botón de actualización manual con feedback visual instantáneo (animación de giro).
 * 
 * ¿POR QUÉ SE PUSO?
 * Aunque existe auto-refresco cada 25s, el cajero o despachador puede querer
 * forzar la sincronización inmediata al recibir una llamada telefónica urgente.
 */
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

/**
 * Actualiza los contadores de pedidos en las tarjetas superiores (KPIs) y columnas.
 * 
 * ¿POR QUÉ SE PUSO?
 * Ofrece métricas instantáneas del flujo de trabajo: cuántos pedidos hay pendientes,
 * en cocina, listos para empacar, en ruta con motorizados y entregados en el turno.
 * 
 * @param {Array} pedidos - Lista de pedidos recuperada del backend.
 */
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

    // Actualizar badge de la cabecera general con el total de órdenes activas
    const activos = pendientes + preparacion + listos + camino;
    const badgeHeader = document.getElementById('badge-nav-delivery');
    if (badgeHeader) {
        badgeHeader.innerText = activos;
        badgeHeader.style.display = activos > 0 ? 'inline-flex' : 'none';
    }
}

/**
 * Síntesis de sonido acústico para transiciones de estado de delivery.
 * 
 * ¿POR QUÉ SE PUSO?
 * Emite un sonido mediante la Web Audio API cuando una orden avanza de etapa o se entrega,
 * confirmando la acción sin depender de archivos de audio externos (100% offline).
 * 
 * @param {string} tipo - 'pop' o 'success'.
 */
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

/**
 * Evalúa el tiempo transcurrido desde la creación del pedido.
 * 
 * ¿POR QUÉ SE PUSO?
 * En lugar de un cronómetro parpadeante que cause estrés al personal de cocina,
 * solo muestra un indicador sutil cuando la orden supera los 30 minutos para
 * recordar al despachador consultar con cocina o con el motorizado.
 * 
 * @param {string} fechaStr - Fecha y hora de creación de la orden.
 * @param {string} estado - Estado actual de la orden ('PENDIENTE', 'ENTREGADO', etc.).
 * @returns {Object|null} Objeto con texto y clase CSS, o null si no amerita alerta.
 */
function obtenerAlertaTiempo(fechaStr, estado) {
    // Si ya fue entregado o cancelado, nunca mostrar alertas de demora
    if (!fechaStr || estado === 'ENTREGADO' || estado === 'CANCELADO') {
        return null;
    }

    try {
        const fecha = new Date(fechaStr.replace(' ', 'T'));
        const ahora = new Date();
        const diffMs = ahora.getTime() - fecha.getTime();
        const diffMin = Math.max(0, Math.floor(diffMs / 60000));

        if (isNaN(diffMin)) return null;

        // Alerta preventiva si supera los 30 minutos
        if (diffMin > 30) {
            return {
                texto: `Revisar (+30 min)`,
                clase: 'time-alerta-monitoreo',
                minutos: diffMin
            };
        }

        return null;
    } catch (e) {
        return null;
    }
}

/**
 * Genera la barra gráfica de 5 pasos en el pipeline de la tarjeta Kanban.
 * 
 * ¿POR QUÉ SE PUSO?
 * Muestra visualmente el progreso de la orden (Pendiente > Cocina > Listo > En Camino > Entregado)
 * para que cualquier persona del equipo entienda la etapa con un simple vistazo cromático.
 * 
 * @param {string} estado - Estado actual del pedido.
 * @returns {string} Fragmento HTML con las clases CSS correspondientes.
 */
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

/**
 * Renderiza las tarjetas de los pedidos en las 5 columnas del tablero Kanban.
 * 
 * ¿POR QUÉ SE PUSO?
 * Construye cada tarjeta con su número de orden, origen (WhatsApp o Llamada),
 * cliente, teléfono con enlace para marcar, dirección exacta, motorizado asignado
 * (con botón para reasignar rápidamente), lista de platillos, totales financieros
 * y los botones de acción para avanzar el estado o imprimir tickets.
 * 
 * @param {Array} pedidos - Lista de pedidos a renderizar.
 */
function renderizarTableroKanban(pedidos) {
    const cols = {
        'PENDIENTE': document.getElementById('col-cards-pendiente'),
        'EN_PREPARACION': document.getElementById('col-cards-preparacion'),
        'LISTO': document.getElementById('col-cards-listo'),
        'EN_CAMINO': document.getElementById('col-cards-camino'),
        'ENTREGADO': document.getElementById('col-cards-entregado')
    };

    // Limpiar contenido previo de las columnas
    Object.values(cols).forEach(col => {
        if (col) col.innerHTML = '';
    });

    const usuarioActual = typeof obtenerUsuarioActual === 'function' ? obtenerUsuarioActual() : null;
    const esAdmin = usuarioActual && (usuarioActual.id_rol === 1 || usuarioActual.id_rol === 3);

    pedidos.forEach(p => {
        const colElem = cols[p.estado];
        if (!colElem) return;

        const card = document.createElement('div');
        card.className = `kanban-card card-${p.estado.toLowerCase()}`;

        let itemsHtml = '';
        (p.items || []).forEach(it => {
            itemsHtml += `<div>• ${it.cantidad}x ${it.producto_nombre || it.nombre}</div>`;
        });

        // Botón principal de avance en el flujo operativo
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

        // Cronómetro / Monitoreo del tiempo de entrega con alertas cromáticas
        let badgeTiempoHtml = '';
        if (p.estado === 'ENTREGADO') {
            const minFinal = p.tiempo_total_minutos || '--';
            badgeTiempoHtml = `
                <span style="font-size:0.72rem; font-weight:700; color:#15803D; background:#DCFCE7; padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;">
                    [ENTREGADO] ${minFinal} min
                </span>
            `;
        } else if (p.fecha_creacion) {
            const fechaCrea = new Date(p.fecha_creacion.replace(' ', 'T'));
            const diffMin = Math.max(0, Math.floor((Date.now() - fechaCrea.getTime()) / 60000));
            const estMin = p.tiempo_estimado_min || 25;
            let bg = '#DCFCE7', fg = '#15803D', icon = '';
            if (diffMin > 35) {
                bg = '#FEE2E2'; fg = '#B91C1C'; icon = ' Demorado:'; // Demorado > 35 min
            } else if (diffMin >= 20) {
                bg = '#FEF3C7'; fg = '#B45309'; icon = ''; // 20 - 35 min
            }
            badgeTiempoHtml = `
                <span style="font-size:0.72rem; font-weight:700; color:${fg}; background:${bg}; padding:2px 7px; border-radius:4px; display:inline-flex; align-items:center; gap:4px;" title="Tiempo transcurrido: ${diffMin} min / Tiempo estimado: ${estMin} min">
                    ${icon} ${diffMin} min / est ${estMin} min
                </span>
            `;
        }

        const pipelineHtml = generarPipelineSteps(p.estado);

        card.innerHTML = `
            <div class="card-header-row">
                <div style="display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
                    <strong class="card-pedido-num">#${p.numero_pedido}</strong>
                    ${badgeTiempoHtml}
                </div>
                <span class="card-origen-badge ${p.origen === 'WHATSAPP' ? 'badge-wa' : 'badge-tel'}">
                    ${p.origen === 'WHATSAPP' ? 'WhatsApp' : 'Llamada'}
                </span>
            </div>
            ${pipelineHtml}

            <div class="card-cliente-title">${p.cliente_nombre}</div>
            <div class="card-tel">Tel: <a href="tel:${p.telefono}">${p.telefono || 'Sin teléfono'}</a></div>
            <div class="card-direccion"><span style="font-weight:700; color:#EA580C;">Dir:</span> ${p.direccion}</div>
            
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
                <button type="button" class="card-btn-mini btn-factura-qr" onclick="verFacturaDelivery(${p.id_pedido})" title="Ver Factura Comercial">
                    Ver Factura
                </button>
                <button type="button" class="card-btn-mini" style="background:#B45309; color:#FFFFFF; font-weight:700;" onclick="imprimirTicketDeliveryTermico(${p.id_pedido})" title="Imprimir Ticket Térmico para Repartidor">
                    Ticket Térmico
                </button>
                <button type="button" class="card-btn-mini" style="background:#25D366; color:#FFFFFF; font-weight:700;" onclick="enviarWhatsAppClienteDelivery(${p.id_pedido})" title="Enviar actualización al WhatsApp del cliente">
                    WA Cliente
                </button>
                <button type="button" class="card-btn-mini" style="background:#059669; color:#FFFFFF; font-weight:700;" onclick="enviarWhatsAppRepartidorDelivery(${p.id_pedido})" title="Enviar hoja de ruta al WhatsApp del repartidor">
                    WA Motorizado
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

/**
 * Cambia el estado de un pedido en la base de datos (PATCH /api/delivery/pedidos/:id/estado).
 * 
 * ¿POR QUÉ SE PUSO?
 * Maneja la máquina de estados. Si el nuevo estado es 'ENTREGADO', el backend
 * auto-vincula la venta en la caja chica activa y descuenta los insumos correspondientes.
 * 
 * @param {number} idPedido - ID del pedido.
 * @param {string} nuevoEstado - Nuevo estado operativo.
 * @param {string|null} repartidor - Nombre del repartidor asignado (opcional).
 */
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

/**
 * Despacha un pedido a la columna "EN CAMINO", solicitando el repartidor si aún no está asignado.
 * 
 * @param {number} idPedido - ID del pedido a despachar.
 */
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


// =============================================================================
// SECCIÓN 4: CREACIÓN DE NUEVOS PEDIDOS DE DELIVERY DESDE MODAL
// =============================================================================

/**
 * Abre el formulario modal para registrar un pedido de delivery (WhatsApp o Teléfono).
 */
function abrirModalNuevoPedidoDelivery() {
    itemsNuevoPedido = [];
    document.getElementById('txt-del-costo-envio').value = '30'; // Tarifa base estándar en Sierra Maestra
    document.getElementById('txt-del-notas').value = '';
    document.getElementById('txt-del-nombre').value = '';
    document.getElementById('txt-del-telefono').value = '';
    document.getElementById('txt-del-direccion').value = '';
    renderizarItemsNuevoPedido();
    calcularTotalesModalDelivery();
    document.getElementById('modal-nuevo-delivery').classList.add('open');
}

/**
 * Cierra la ventana modal de nuevo pedido de delivery.
 */
function cerrarModalNuevoPedidoDelivery() {
    document.getElementById('modal-nuevo-delivery').classList.remove('open');
}

/**
 * Autocompleta los datos del cliente al seleccionarlo en el desplegable.
 */
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

/**
 * Alterna la visibilidad de los campos de banco y referencia según la forma de pago.
 */
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

/**
 * Agrega un platillo a la lista temporal del nuevo pedido de delivery.
 */
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

/**
 * Elimina una línea de producto en el modal de nuevo pedido.
 * 
 * @param {number} idx - Índice del elemento en itemsNuevoPedido.
 */
function eliminarItemDelivery(idx) {
    itemsNuevoPedido.splice(idx, 1);
    renderizarItemsNuevoPedido();
    calcularTotalesModalDelivery();
}

/**
 * Renderiza la tabla de platillos dentro del modal de nuevo pedido.
 */
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

/**
 * Recalcula Subtotal, Costo de Envío y Total en el modal de nuevo pedido.
 */
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

/**
 * Guarda el pedido de delivery en SQLite y lo coloca en estado PENDIENTE en el tablero.
 * 
 * @param {Event} e - Evento submit del formulario.
 */
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
    const selZona = document.getElementById('select-del-zona-tiempo');
    const idTiempoEntrega = selZona && selZona.value ? parseInt(selZona.value) : null;
    const tiempoEstMin = parseInt(document.getElementById('txt-del-tiempo-est').value) || 25;
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
        id_tiempo_entrega: idTiempoEntrega,
        tiempo_estimado_min: tiempoEstMin,
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


// =============================================================================
// SECCIÓN 5: TICKETS DE COCINA Y FACTURA COMERCIAL FORMAL (SIN QR LOCAL)
// =============================================================================

/**
 * Consulta y muestra la comanda de cocina / ticket de preparación de un pedido.
 * 
 * @param {number} idPedido - ID del pedido.
 */
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

/**
 * Imprime la comanda de cocina en la impresora térmica del área de cocina.
 */
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

/**
 * Cierra la ventana modal del ticket de cocina.
 */
function cerrarModalTicketCocina() {
    document.getElementById('modal-ticket-cocina').classList.remove('open');
}

/**
 * Muestra el modal de Factura Comercial de Delivery.
 * 
 * ¿POR QUÉ SE PUSO Y POR QUÉ SE ELIMINÓ EL CÓDIGO QR?
 * - Despliega la información formal del pedido: número de comanda, fecha, cliente, teléfono,
 *   dirección de entrega, repartidor asignado, desglose de platillos, costo de envío y total.
 * - Se eliminó la generación de códigos QR de red local ya que un cliente con datos móviles
 *   no puede resolver URLs internas como http://192.168.1.x:3000 fuera del Wi-Fi del restaurante.
 *   Esto simplifica la factura y evita que el cliente piense que la factura está rota.
 * 
 * @param {number} idPedido - ID del pedido a visualizar.
 */
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

    document.getElementById('modal-factura-delivery').classList.add('open');
}

/**
 * Lanza la impresión de la Factura Comercial de Delivery en PDF o impresora estándar.
 */
function imprimirFacturaDeliveryPDF() {
    window.print();
}

/**
 * Genera e imprime un ticket térmico de entrega portátil para el motorizado (58mm/80mm).
 * 
 * ¿POR QUÉ SE PUSO?
 * El repartidor necesita llevar en mano un comprobante físico resistente y compacto con:
 * - Teléfono del cliente para llamarlo al llegar.
 * - Dirección exacta con referencias en Managua.
 * - Monto exacto a cobrar en efectivo o banco al cual se transfirió.
 * 
 * @param {number|null} idPedido - ID del pedido a imprimir (opcional).
 */
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
    ticketTexto += `          EL GUSTAZO\n`;
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

/**
 * Cierra la ventana modal de Factura Comercial de Delivery.
 */
function cerrarModalFacturaDelivery() {
    document.getElementById('modal-factura-delivery').classList.remove('open');
}


// =============================================================================
// SECCIÓN 6: GESTIÓN Y LIBRE ALBEDRÍO DE REPARTIDORES (CRUD & REASIGNACIÓN)
// =============================================================================

/**
 * Abre la ventana modal de gestión general de repartidores.
 */
function abrirModalGestionRepartidores() {
    renderizarTablaRepartidores();
    cancelarEdicionRepartidor();
    document.getElementById('modal-gestion-repartidores').classList.add('open');
}

/**
 * Cierra el modal de gestión de repartidores.
 */
function cerrarModalGestionRepartidores() {
    document.getElementById('modal-gestion-repartidores').classList.remove('open');
}

/**
 * Renderiza la lista de repartidores en la tabla modal con botones de editar y eliminar.
 */
function renderizarTablaRepartidores() {
    const tbody = document.getElementById('tabla-repartidores-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!repartidoresDelivery || repartidoresDelivery.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:15px; color:#94A3B8;">No hay repartidores registrados.</td></tr>';
        return;
    }

    const usuarioActual = obtenerUsuarioActual();
    const esAdmin = usuarioActual && (usuarioActual.id_rol === 1 || usuarioActual.id_rol === 3);

    repartidoresDelivery.forEach(r => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${r.nombre}</strong></td>
            <td>${r.telefono || '--'}</td>
            <td>${r.vehiculo || 'Moto'}</td>
            <td>${r.placa || '--'}</td>
            <td style="text-align:center; white-space:nowrap;">
                <button type="button" class="btn-small" style="background:#EA580C; padding:3px 8px; font-size:0.75rem;" onclick="editarRepartidor(${r.id_repartidor})">
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

/**
 * Pasa los datos de un repartidor al formulario superior para editar su teléfono, vehículo o placa.
 * 
 * @param {number} id - ID del repartidor.
 */
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

/**
 * Limpia el formulario de repartidor volviendo al modo de registro nuevo.
 */
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

/**
 * Guarda los cambios de un repartidor (nuevo o editado) en SQLite.
 * 
 * @param {Event} e - Evento submit del formulario.
 */
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

/**
 * Desactiva o elimina un repartidor (Exclusivo Administrador).
 * 
 * @param {number} id - ID del repartidor.
 * @param {string} nombre - Nombre del repartidor para confirmación.
 */
async function eliminarRepartidor(id, nombre) {
    if (!confirm(`¿Está seguro de eliminar o desactivar al repartidor "${nombre}"?`)) return;

    try {
        const res = await fetchAuth(`/api/delivery/repartidores/${id}`, { method: 'DELETE' });
        if (!res.ok) {
            if (res.status === 403) {
                alert('Acceso Denegado: Solo el Administrador tiene autorización para eliminar o desactivar repartidores.');
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

/**
 * Abre el diálogo de reasignación rápida de repartidor para un pedido específico.
 * 
 * @param {number} idPedido - ID del pedido.
 * @param {string} repartidorActual - Nombre del repartidor actual asignado.
 */
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

/**
 * Cierra la ventana modal de reasignación rápida.
 */
function cerrarModalReasignarRepartidor() {
    document.getElementById('modal-reasignar-repartidor').classList.remove('open');
}

/**
 * Guarda el nuevo repartidor asignado al pedido en SQLite.
 * 
 * @param {Event} e - Evento submit.
 */
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


// =============================================================================
// SECCIÓN 7: ARCHIVADO LIMPIO Y GESTIÓN DE PEDIDOS ENTREGADOS
// =============================================================================

/**
 * Archiva todos los pedidos entregados del tablero con un solo clic.
 * 
 * ¿POR QUÉ SE PUSO?
 * Al final de horas pico, la columna "ENTREGADO" puede tener 20 o 30 tarjetas.
 * Este botón limpia la pantalla para mayor comodidad del personal, manteniendo
 * todos los pedidos guardados intactos en el historial de ventas y reportes.
 */
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

/**
 * Archiva un pedido individual para sacarlo del tablero.
 * 
 * @param {number} idPedido - ID del pedido.
 */
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

/**
 * Elimina un pedido permanentemente de la base de datos (Exclusivo Administrador).
 * 
 * @param {number} idPedido - ID del pedido.
 * @param {string} numeroPedido - Número visible del pedido.
 */
async function eliminarPedidoDelivery(idPedido, numeroPedido) {
    const usuario = typeof obtenerUsuarioActual === 'function' ? obtenerUsuarioActual() : null;
    if (!usuario || (usuario.id_rol !== 1 && usuario.id_rol !== 3)) {
        alert('Solo el Administrador y Gerente General tienen permiso para eliminar pedidos.');
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

/**
 * Abre el modal del historial de pedidos archivados.
 */
function abrirModalHistorialArchivados() {
    const modal = document.getElementById('modal-historial-archivados');
    if (!modal) return;
    modal.classList.add('open');
    cargarPedidosArchivados();
}

/**
 * Cierra el modal del historial de archivados.
 */
function cerrarModalHistorialArchivados() {
    const modal = document.getElementById('modal-historial-archivados');
    if (modal) modal.classList.remove('open');
}

/**
 * Carga los pedidos archivados desde el backend y los renderiza en la tabla modal.
 */
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
                    <button type="button" class="btn-small" style="background:#EA580C; padding:3px 8px; font-size:0.75rem;" onclick="verFacturaDelivery(${p.id_pedido})" title="Ver factura del pedido">
                        Ver Factura
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

/**
 * Restaura un pedido archivado devolviéndolo al tablero Kanban.
 * 
 * @param {number} idPedido - ID del pedido a restaurar.
 */
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


// =============================================================================
// SECCIÓN 8: UTILIDADES COMPARTIDAS (SESIÓN Y RBAC)
// =============================================================================

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

    if (usuario.id_rol !== 1 && usuario.id_rol !== 3) {
        document.querySelectorAll('.admin-only, .btn-order-delete').forEach(el => el.style.display = 'none');
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
    else toast.style.background = '#0F172A';

    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// =============================================================================
// SECCIÓN 9: TIEMPOS DE ENTREGA, ZONAS Y MÉTRICAS
// =============================================================================

async function abrirModalTiemposEntrega() {
    const modal = document.getElementById('modal-tiempos-entrega');
    if (!modal) return;
    await cargarTiemposYZonas();
    modal.classList.add('open');
}

function cerrarModalTiemposEntrega() {
    const modal = document.getElementById('modal-tiempos-entrega');
    if (modal) modal.classList.remove('open');
    cancelarEdicionZonaTiempo();
}

async function cargarTiemposYZonas() {
    try {
        const [resZonas, resMetricas] = await Promise.all([
            fetch('/api/delivery/tiempos'),
            fetch('/api/delivery/metricas-tiempos')
        ]);
        tiemposEntregaDelivery = await resZonas.json();
        const metricas = await resMetricas.json();

        // Actualizar KPIs
        const elProm = document.getElementById('kpi-tiempo-promedio');
        const elPuntual = document.getElementById('kpi-entregas-a-tiempo');
        const elDemorados = document.getElementById('kpi-pedidos-demorados');
        if (elProm) elProm.innerText = `${metricas.tiempo_promedio_min || 0} min`;
        if (elPuntual) elPuntual.innerText = `${metricas.porcentaje_a_tiempo || 100}%`;
        if (elDemorados) elDemorados.innerText = metricas.total_demorados || 0;

        // Renderizar tabla
        const tbody = document.getElementById('tabla-tiempos-entrega-body');
        if (!tbody) return;
        tbody.innerHTML = '';
        if (tiemposEntregaDelivery.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:15px; color:#94A3B8;">No hay zonas configuradas.</td></tr>';
            return;
        }

        tiemposEntregaDelivery.forEach(z => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${z.nombre_zona}</strong></td>
                <td style="text-align:center; font-weight:700; color:#0F172A;">${z.tiempo_estimado_min} min</td>
                <td style="text-align:right; font-weight:700; color:#EA580C;">C$ ${parseFloat(z.costo_envio).toFixed(2)}</td>
                <td style="color:#64748B; font-size:0.8rem;">${z.descripcion || 'Cobertura general'}</td>
                <td style="text-align:center;">
                    <span class="status-badge ${z.activo ? 'success' : 'danger'}">${z.activo ? 'Activo' : 'Inactivo'}</span>
                </td>
                <td style="text-align:center;">
                    <div style="display:flex; gap:6px; justify-content:center;">
                        <button type="button" class="btn-small" style="padding:3px 8px; font-size:0.75rem;" onclick="editarZonaTiempo(${z.id_tiempo_entrega})">Editar</button>
                        <button type="button" class="btn-small" style="background:${z.activo ? '#DC2626' : '#16A34A'}; padding:3px 8px; font-size:0.75rem;" onclick="toggleEstadoZonaTiempo(${z.id_tiempo_entrega}, ${z.activo})">
                            ${z.activo ? 'Desactivar' : 'Activar'}
                        </button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        poblarSelectsAuxiliares();
    } catch (e) {
        console.error('Error cargando zonas de entrega:', e);
    }
}

async function guardarZonaTiempo(e) {
    e.preventDefault();
    const id = document.getElementById('txt-zte-id').value;
    const nombre_zona = document.getElementById('txt-zte-nombre').value.trim();
    const tiempo_estimado_min = parseInt(document.getElementById('txt-zte-minutos').value) || 25;
    const costo_envio = parseFloat(document.getElementById('txt-zte-costo').value) || 0;
    const descripcion = document.getElementById('txt-zte-desc').value.trim();

    const url = id ? `/api/delivery/tiempos/${id}` : '/api/delivery/tiempos';
    const method = id ? 'PUT' : 'POST';

    try {
        const res = await fetchAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre_zona, tiempo_estimado_min, costo_envio, descripcion })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(id ? 'Zona de entrega actualizada.' : 'Nueva zona de entrega registrada.');
            cancelarEdicionZonaTiempo();
            await cargarTiemposYZonas();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error al guardar zona de entrega.');
    }
}

function editarZonaTiempo(id) {
    const z = tiemposEntregaDelivery.find(item => item.id_tiempo_entrega === id);
    if (!z) return;
    document.getElementById('txt-zte-id').value = z.id_tiempo_entrega;
    document.getElementById('txt-zte-nombre').value = z.nombre_zona;
    document.getElementById('txt-zte-minutos').value = z.tiempo_estimado_min;
    document.getElementById('txt-zte-costo').value = z.costo_envio;
    document.getElementById('txt-zte-desc').value = z.descripcion || '';
    document.getElementById('lbl-zte-form-title').innerText = `Editar Zona: ${z.nombre_zona}`;
    document.getElementById('btn-zte-guardar').innerText = 'Actualizar Zona';
    document.getElementById('btn-zte-cancelar').style.display = 'inline-block';
}

function cancelarEdicionZonaTiempo() {
    document.getElementById('txt-zte-id').value = '';
    document.getElementById('txt-zte-nombre').value = '';
    document.getElementById('txt-zte-minutos').value = '25';
    document.getElementById('txt-zte-costo').value = '30';
    document.getElementById('txt-zte-desc').value = '';
    document.getElementById('lbl-zte-form-title').innerText = 'Registrar Nueva Zona / Tiempo de Entrega';
    document.getElementById('btn-zte-guardar').innerText = 'Guardar Zona';
    document.getElementById('btn-zte-cancelar').style.display = 'none';
}

async function toggleEstadoZonaTiempo(id, estadoActual) {
    try {
        const nuevoEstado = estadoActual ? 0 : 1;
        const res = await fetchAuth(`/api/delivery/tiempos/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activo: nuevoEstado })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(nuevoEstado ? 'Zona activada.' : 'Zona desactivada.');
            await cargarTiemposYZonas();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        alert('Error al actualizar estado de la zona.');
    }
}

// =============================================================================
// SECCIÓN 10: INTEGRACIÓN DE WHATSAPP PARA CLIENTES Y REPARTIDORES
// =============================================================================

function enviarWhatsAppClienteDelivery(idPedido) {
    const p = pedidosDelivery.find(item => item.id_pedido === idPedido);
    if (!p) return;

    let tel = (p.telefono || '').replace(/\D/g, '');
    if (!tel) {
        tel = prompt('Ingrese el numero de WhatsApp del cliente (8 digitos):', '');
        if (!tel) return;
        tel = tel.replace(/\D/g, '');
    }

    const estadoLabels = {
        'PENDIENTE': 'Registrado y en espera de preparacion',
        'EN_PREPARACION': 'En proceso de elaboracion en cocina',
        'LISTO': 'Empacado y listo para despacho',
        'EN_CAMINO': `En ruta de entrega con el repartidor (${p.repartidor || 'Personal de Turno'})`,
        'ENTREGADO': 'Entregado conforme a la orden'
    };

    let itemsTxt = '';
    (p.items || []).forEach(it => {
        itemsTxt += `  * ${it.cantidad}x ${it.producto_nombre || it.nombre}\n`;
    });

    const mensaje = 
`================================================
EL GUSTAZO - ESTADO DE PEDIDO DELIVERY
Sierra Maestra, Managua
================================================
Estimado(a) ${p.cliente_nombre}:
Le informamos el estado actual de su orden:

Numero de Pedido: #${p.numero_pedido}
Estado: ${estadoLabels[p.estado] || p.estado}
Direccion de Destino: ${p.direccion}
Total a Liquidar: C$ ${parseFloat(p.total).toFixed(2)} (${p.id_metodo_pago === 1 ? 'Efectivo contra entrega' : 'Transferencia Bancaria'})
------------------------------------------------
Detalle de Productos:
${itemsTxt}------------------------------------------------
Agradecemos su confianza en El Gustazo.
Para consultas operativas, contactenos directamente.`;

    if (typeof WhatsAppService !== 'undefined') {
        WhatsAppService.enviarMensaje(tel, mensaje);
    } else {
        if (tel.length === 8) tel = '505' + tel;
        window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
    }
}

function enviarWhatsAppRepartidorDelivery(idPedido) {
    const p = pedidosDelivery.find(item => item.id_pedido === idPedido);
    if (!p) return;

    const repObj = repartidoresDelivery.find(r => r.nombre === p.repartidor);
    let tel = repObj && repObj.telefono ? repObj.telefono.replace(/\D/g, '') : '';
    if (!tel) {
        tel = prompt(`Ingrese el WhatsApp de ${p.repartidor || 'el repartidor'} (8 digitos):`, '');
        if (!tel) return;
        tel = tel.replace(/\D/g, '');
    }

    if (typeof WhatsAppService !== 'undefined') {
        const mensaje = WhatsAppService.generarHojaRutaRepartidor(p);
        WhatsAppService.enviarMensaje(tel, mensaje);
    } else {
        if (tel.length === 8) tel = '505' + tel;
        let itemsTxt = '';
        (p.items || []).forEach(it => {
            itemsTxt += `  * ${it.cantidad}x ${it.producto_nombre || it.nombre}\n`;
        });
        const mensaje = 
`EL GUSTAZO - HOJA DE RUTA DELIVERY
Orden: #${p.numero_pedido}
Cliente: ${p.cliente_nombre}
Telefono: ${p.telefono || 'Sin telefono'}
Direccion: ${p.direccion}
${itemsTxt}
Cobro: C$ ${parseFloat(p.total).toFixed(2)}`;
        window.open(`https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`, '_blank');
    }
}
