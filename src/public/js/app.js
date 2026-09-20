/**
 * =========================================================
 * EL BUEN GUSTO - EL GUSTAZO POS & GESTIÓN INTEGRAL
 * Lógica Central de Cliente (JavaScript Vanilla)
 * Sierra Maestra, Managua - Operación 100% Offline
 * =========================================================
 */

// 1. SESIÓN Y CONTROL DE ACCESO
function obtenerUsuarioActual() {
    try {
        const userJson = localStorage.getItem('elgustazo_user');
        return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
        return null;
    }
}

function guardarSesionUsuario(userData) {
    localStorage.setItem('elgustazo_user', JSON.stringify(userData));
}

function cerrarSesion() {
    localStorage.removeItem('elgustazo_user');
    window.location.href = 'login.html';
}

function verificarAutenticacion(requiereAdmin = false) {
    const usuario = obtenerUsuarioActual();
    const paginaActual = window.location.pathname.split('/').pop();

    if (!usuario && paginaActual !== 'login.html') {
        window.location.href = 'login.html';
        return null;
    }

    if (requiereAdmin && usuario && usuario.id_rol !== 1) {
        alert('Acceso Restringido: Las funciones administrativas del Módulo 6 (catálogo, recetas BOM, reportes globales, usuarios y respaldos) están reservadas exclusivamente para el Administrador.');
        window.location.href = 'pos.html';
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

// Inicializar cabecera común
function inicializarHeaderComun() {
    const usuario = obtenerUsuarioActual();
    if (!usuario) return;

    const spanUser = document.getElementById('header-user-name');
    const spanRol = document.getElementById('header-user-role');
    if (spanUser) spanUser.innerText = usuario.nombre;
    if (spanRol) spanRol.innerText = usuario.rol;

    if (usuario.id_rol !== 1) {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }

    consultarAlertasStockHeader();
    actualizarConteoDeliveryHeader();
    if (!window._timerConteoDelivery) {
        window._timerConteoDelivery = setInterval(actualizarConteoDeliveryHeader, 25000);
    }
}

async function actualizarConteoDeliveryHeader() {
    try {
        const res = await fetch('/api/delivery/conteo-activos');
        const data = await res.json();
        const badge = document.getElementById('badge-nav-delivery');
        if (badge) {
            const count = data.total_activos || 0;
            badge.innerText = count;
            badge.style.display = count > 0 ? 'inline-flex' : 'none';
            if (count > 0) {
                badge.title = `${count} pedido(s) activo(s) en Delivery (${data.pendientes || 0} pendientes, ${data.preparacion || 0} en preparación, ${data.en_camino || 0} en ruta)`;
            }
        }
    } catch (e) {
        console.warn('Error al verificar conteo delivery:', e);
    }
}

async function consultarAlertasStockHeader() {
    try {
        const res = await fetch('/api/alertas-stock');
        const data = await res.json();
        const btnAlert = document.getElementById('btn-header-alert');
        if (btnAlert) {
            if (data && data.length > 0) {
                btnAlert.style.display = 'inline-flex';
                btnAlert.innerHTML = `Insumos Críticos (${data.length})`;
                btnAlert.onclick = () => {
                    window.location.href = 'inventario.html';
                };
            } else {
                btnAlert.style.display = 'none';
            }
        }
    } catch (e) {
        console.warn('Error al verificar alertas de stock:', e);
    }
}

// 2. UTILIDADES GENERALES
function formatoMoneda(valor) {
    const num = parseFloat(valor) || 0;
    return `C$ ${num.toFixed(2)}`;
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

// 3. ESTADO DEL POS Y COMANDAS
let catalogoProductos = [];
let comandaCarrito = [];
let cajaActivaActual = null;
let metodoPagoSeleccionado = 1; // 1: Efectivo, 2: Transferencia
let bancoSeleccionado = 'BAC'; // BAC, Banpro, Lafise, BDF, Ficohsa
let tipoServicioActual = 'LOCAL'; // 'LOCAL', 'LLEVAR', 'DELIVERY'
let repartidoresPOS = [];
let clientesRegistradosPOS = [];
let ultimaVentaProcesada = null;

async function inicializarPOS() {
    const usuario = verificarAutenticacion(false);
    if (!usuario) return;
    inicializarHeaderComun();

    const btnNuevoPlatillo = document.getElementById('btn-admin-nuevo-platillo');
    if (btnNuevoPlatillo) {
        btnNuevoPlatillo.style.display = (usuario && usuario.id_rol === 1) ? 'inline-flex' : 'none';
    }

    await verificarCajaChicaActiva();
    await cargarCatalogoPOS();
    await cargarClientesPOS();
    await cargarRepartidoresPOS();
}

async function verificarCajaChicaActiva() {
    try {
        const res = await fetch('/api/caja/activa');
        const data = await res.json();

        if (data.abierta) {
            cajaActivaActual = data.caja;
            const badgeCaja = document.getElementById('pos-shift-badge');
            if (badgeCaja) {
                badgeCaja.className = 'status-badge success';
                badgeCaja.innerText = `Caja Abierta (Fondo: ${formatoMoneda(cajaActivaActual.monto_inicial)})`;
            }
        } else {
            cajaActivaActual = null;
            const badgeCaja = document.getElementById('pos-shift-badge');
            if (badgeCaja) {
                badgeCaja.className = 'status-badge danger';
                badgeCaja.innerText = 'Caja Cerrada';
            }
            abrirModalAperturaCaja();
        }
    } catch (e) {
        console.error('Error al consultar caja activa:', e);
    }
}

function abrirModalAperturaCaja() {
    const modal = document.getElementById('modal-apertura-caja');
    if (modal) modal.classList.add('open');
}

async function procesarAperturaCajaDesdePOS(e) {
    e.preventDefault();
    const monto = document.getElementById('txt-fondo-inicial').value;
    const usuario = obtenerUsuarioActual();

    try {
        const res = await fetch('/api/caja/abrir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                monto_inicial: monto,
                id_usuario: usuario ? usuario.id_usuario : 1,
                notas: 'Apertura desde pantalla POS'
            })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Caja chica abierta exitosamente.');
            document.getElementById('modal-apertura-caja').classList.remove('open');
            verificarCajaChicaActiva();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (e) {
        alert('Error de conexión con el servidor.');
    }
}

// Catálogo de Productos y Filtros
async function cargarCatalogoPOS() {
    try {
        const res = await fetch('/api/productos');
        catalogoProductos = await res.json();
        renderizarCatalogo(catalogoProductos);
    } catch (e) {
        console.error('Error cargando catálogo:', e);
    }
}

// Audio sintetizado táctil con Web Audio API (100% offline, cero dependencias externas)
function reproducirSonidoPOS(tipo = 'pop') {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;
        if (!window._posAudioCtx) {
            window._posAudioCtx = new AudioCtx();
        }
        if (window._posAudioCtx.state === 'suspended') {
            window._posAudioCtx.resume();
        }
        const ctx = window._posAudioCtx;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        const now = ctx.currentTime;
        if (tipo === 'pop') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(840, now + 0.06);
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
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (tipo === 'click') {
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            osc.start(now);
            osc.stop(now + 0.04);
        }
    } catch (e) {
        // Silencioso si el navegador no permite audio
    }
}

// Micro-interacción: Animación de ítem volando desde tarjeta hacia la comanda
function animarItemVolando(card) {
    if (!card) return;
    try {
        const rect = card.getBoundingClientRect();
        const target = document.getElementById('val-total') || document.getElementById('cart-items-body');
        if (!target) return;
        const targetRect = target.getBoundingClientRect();

        const flyer = document.createElement('div');
        flyer.className = 'flyer-item';
        flyer.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span>+1</span>
        `;
        flyer.style.left = `${rect.left + rect.width / 2 - 20}px`;
        flyer.style.top = `${rect.top + 30}px`;
        document.body.appendChild(flyer);

        const dx = (targetRect.left + targetRect.width / 2) - (rect.left + rect.width / 2);
        const dy = (targetRect.top + targetRect.height / 2) - (rect.top + 30);

        requestAnimationFrame(() => {
            flyer.style.transform = `translate(${dx}px, ${dy}px) scale(0.6)`;
            flyer.style.opacity = '0.2';
        });

        setTimeout(() => {
            flyer.remove();
        }, 450);
    } catch (e) {
        // Silencioso
    }
}

// Fotografía gastronómica de alta definición según categoría y platillo
function obtenerImagenPlatillo(p) {
    if (p.imagen && p.imagen.trim() !== '') {
        return p.imagen;
    }
    const nom = (p.nombre || '').toLowerCase();
    const desc = (p.descripcion || '').toLowerCase();

    if (p.es_combo || nom.includes('combo')) {
        return 'img/combo_papas.jpg';
    }
    if (nom.includes('alita') || nom.includes('wing') || desc.includes('alita')) {
        return 'img/alitas_bbq.jpg';
    }
    if (nom.includes('filete') || nom.includes('pollo')) {
        return 'img/alitas_bbq.jpg';
    }
    if (nom.includes('hamburguesa') || nom.includes('burger')) {
        return 'img/burger_artesanal.jpg';
    }
    if (nom.includes('papas') || nom.includes('quesadilla') || nom.includes('hot dog') || nom.includes('burrito')) {
        return 'img/burger_combo.jpg';
    }
    return 'img/burger_combo.jpg';
}

function renderizarCatalogo(productos) {
    const grid = document.getElementById('grid-productos');
    if (!grid) return;
    grid.innerHTML = '';

    const countElem = document.getElementById('txt-contador-platillos');
    if (countElem) {
        countElem.innerText = `(${productos.length} disponible${productos.length === 1 ? '' : 's'})`;
    }

    if (productos.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 40px; color:#64748B; font-weight:600;">No se encontraron platillos con los criterios seleccionados.</p>';
        return;
    }

    const usuarioActual = obtenerUsuarioActual();
    const esAdmin = usuarioActual && usuarioActual.id_rol === 1;

    productos.forEach(p => {
        const card = document.createElement('div');
        card.className = `product-card ${p.es_combo ? 'is-combo' : ''}`;
        card.setAttribute('data-id', p.id_producto);
        card.onclick = () => agregarAlCarrito(p, card);

        const itemEnCarrito = comandaCarrito.find(c => c.id_producto === p.id_producto);
        const qtyEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;

        card.innerHTML = `
            <div class="product-card-top-bar">
                <div class="product-tags-wrap">
                    ${p.es_combo ? '<span class="product-badge-combo">COMBO</span>' : ''}
                    <span class="product-badge-cart-qty" id="card-qty-${p.id_producto}" style="${qtyEnCarrito > 0 ? 'display:inline-flex;' : 'display:none;'}">
                        ${qtyEnCarrito} en orden
                    </span>
                </div>
                ${esAdmin ? `
                <button type="button" class="btn-card-edit" title="Modificar platillo (Solo Administrador)" onclick="abrirModalEditarPlatilloPOS(event, ${p.id_producto})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    Editar
                </button>` : ''}
            </div>
            <div class="product-card-body">
                <h3 class="product-title">${p.nombre}</h3>
                <p class="desc">${p.descripcion || ''}</p>
            </div>
            <div class="price-row">
                <span class="price">${formatoMoneda(p.precio)}</span>
                <span class="add-btn" title="Agregar a comanda">+</span>
            </div>
        `;
        grid.appendChild(card);
    });

    actualizarContadoresCategorias();
}

function actualizarBadgesComandaEnTarjetas() {
    if (!catalogoProductos) return;
    catalogoProductos.forEach(p => {
        const badge = document.getElementById(`card-qty-${p.id_producto}`);
        if (!badge) return;
        const item = comandaCarrito.find(c => c.id_producto === p.id_producto);
        if (item && item.cantidad > 0) {
            badge.innerText = `${item.cantidad} en orden`;
            badge.style.display = 'inline-flex';
        } else {
            badge.style.display = 'none';
        }
    });
}

function actualizarContadoresCategorias() {
    if (!catalogoProductos) return;
    document.querySelectorAll('.cat-btn').forEach(btn => {
        const cat = btn.getAttribute('data-cat');
        let count = 0;
        if (cat === 'todos') {
            count = catalogoProductos.length;
        } else {
            count = catalogoProductos.filter(p => p.id_categoria === parseInt(cat)).length;
        }
        const baseName = btn.getAttribute('data-name') || btn.innerText.replace(/\s*\(\d+\)$/, '').trim();
        btn.setAttribute('data-name', baseName);
        btn.innerText = `${baseName} (${count})`;
    });
}

function filtrarPorCategoria(idCategoria, btn, esDeBuscador = false) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    
    if (btn) {
        btn.classList.add('active');
    } else {
        const matchingBtn = document.querySelector(`.cat-btn[data-cat="${idCategoria}"]`);
        if (matchingBtn) matchingBtn.classList.add('active');
    }

    // Si se presiona "Todos" directamente, limpiar el texto del buscador
    if (idCategoria === 'todos' && !esDeBuscador) {
        limpiarBusquedaPlatillo(false);
    }

    const txtBusqueda = (document.getElementById('txt-buscar-producto').value || '').toLowerCase();

    let filtrados = catalogoProductos;
    if (idCategoria !== 'todos') {
        filtrados = filtrados.filter(p => p.id_categoria === parseInt(idCategoria));
    }
    if (txtBusqueda) {
        filtrados = filtrados.filter(p => 
            p.nombre.toLowerCase().includes(txtBusqueda) || 
            (p.descripcion && p.descripcion.toLowerCase().includes(txtBusqueda))
        );
    }
    renderizarCatalogo(filtrados);

    // Reiniciar scroll vertical del catálogo hacia arriba
    const gridWrap = document.querySelector('.product-grid-wrap');
    if (gridWrap) gridWrap.scrollTop = 0;
}

function buscarPlatilloEnVivo() {
    const input = document.getElementById('txt-buscar-producto');
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (btnLimpiar && input) {
        btnLimpiar.style.display = input.value.trim() ? 'block' : 'none';
    }
    const catActiva = document.querySelector('.cat-btn.active');
    const idCat = catActiva ? catActiva.getAttribute('data-cat') : 'todos';
    filtrarPorCategoria(idCat, catActiva || document.querySelector('.cat-btn'), true);
}

function limpiarBusquedaPlatillo(filtrar = true) {
    const input = document.getElementById('txt-buscar-producto');
    const btnLimpiar = document.getElementById('btn-limpiar-busqueda');
    if (input) input.value = '';
    if (btnLimpiar) btnLimpiar.style.display = 'none';
    if (filtrar) {
        const catActiva = document.querySelector('.cat-btn.active');
        const idCat = catActiva ? catActiva.getAttribute('data-cat') : 'todos';
        filtrarPorCategoria(idCat, catActiva || document.querySelector('.cat-btn'), true);
        if (input) input.focus();
    }
}

// Modalidad de Servicio (Local, Llevar, Delivery)
function cambiarTipoServicio(tipo, btn) {
    tipoServicioActual = tipo;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const boxDel = document.getElementById('box-pos-delivery');
    const rowEnvio = document.getElementById('row-envio-delivery');

    if (tipo === 'DELIVERY') {
        if (boxDel) boxDel.style.display = 'block';
        if (rowEnvio) rowEnvio.style.display = 'flex';
        alSeleccionarClientePOS();
    } else {
        if (boxDel) boxDel.style.display = 'none';
        if (rowEnvio) rowEnvio.style.display = 'none';
    }

    actualizarCarritoUI();
}

// Clientes y Repartidores
async function cargarClientesPOS() {
    try {
        const res = await fetch('/api/clientes');
        clientesRegistradosPOS = await res.json();
        const select = document.getElementById('select-cliente-pos');
        if (select) {
            select.innerHTML = '';
            clientesRegistradosPOS.forEach(cl => {
                const opt = document.createElement('option');
                opt.value = cl.id_cliente;
                opt.innerText = `${cl.nombre} ${cl.telefono ? '(' + cl.telefono + ')' : ''} - [${cl.categoria}]`;
                select.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Error cargando clientes:', e);
    }
}

async function cargarRepartidoresPOS() {
    try {
        const res = await fetch('/api/delivery/repartidores');
        repartidoresPOS = await res.json();
        const selRep = document.getElementById('select-pos-repartidor');
        if (selRep) {
            selRep.innerHTML = '<option value="">Por asignar</option>';
            repartidoresPOS.forEach(r => {
                const opt = document.createElement('option');
                opt.value = r.nombre;
                opt.innerText = `${r.nombre} (${r.vehiculo})`;
                selRep.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Error cargando repartidores:', e);
    }
}

function alSeleccionarClientePOS() {
    const sel = document.getElementById('select-cliente-pos');
    if (!sel) return;
    const id = parseInt(sel.value);
    const cl = clientesRegistradosPOS.find(c => c.id_cliente === id);
    const txtDir = document.getElementById('txt-pos-direccion-delivery');
    if (txtDir && cl && cl.direccion && cl.id_cliente !== 1) {
        txtDir.value = cl.direccion;
    }
}

// Despacho directo a tablero de Delivery para cobro contra entrega (Sin retrabajo)
async function enviarComandaADeliveryContraEntrega() {
    if (comandaCarrito.length === 0) {
        mostrarToast('Agregue platillos o combos a la orden antes de registrar en delivery.', 'warning');
        return;
    }

    const selectCliente = document.getElementById('select-cliente-pos');
    const idCliente = selectCliente ? parseInt(selectCliente.value) : 1;
    const clSeleccionado = (clientesRegistradosPOS || []).find(c => c.id_cliente === idCliente);
    const clienteNombre = clSeleccionado ? clSeleccionado.nombre : 'Cliente Delivery';
    const telefono = clSeleccionado ? (clSeleccionado.telefono || '') : '';

    const dirInput = document.getElementById('txt-pos-direccion-delivery');
    const direccion = dirInput ? dirInput.value.trim() : '';

    if (!direccion) {
        alert('Por favor ingrese la dirección exacta de entrega en Sierra Maestra o zonas cercanas antes de registrar en el tablero de Delivery.');
        if (dirInput) dirInput.focus();
        return;
    }

    const costoEnvio = parseFloat(document.getElementById('txt-pos-costo-delivery').value) || 0;
    const repartidor = document.getElementById('select-pos-repartidor').value || null;
    const usuario = obtenerUsuarioActual();

    const payload = {
        id_cliente: idCliente,
        cliente_nombre: clienteNombre,
        telefono: telefono,
        direccion: direccion,
        origen: 'POS',
        repartidor: repartidor || null,
        notas: 'Registrado desde Comanda POS - Cobro Contra Entrega',
        costo_delivery: costoEnvio,
        items: comandaCarrito,
        id_metodo_pago: 1, // Efectivo / Contra entrega
        banco: null,
        referencia_transferencia: null,
        id_caja: cajaActivaActual ? cajaActivaActual.id_caja : null,
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
            mostrarToast(`¡Pedido ${data.numero_pedido} registrado en Tablero de Delivery!`, 'success');
            vaciarCarrito();
            actualizarConteoDeliveryHeader();

            const deseaIr = confirm(`¡Pedido #${data.numero_pedido} enviado al módulo de Delivery con éxito!\n\nSe ha colocado en estado PENDIENTE en el tablero de cocina y despacho.\n\n¿Desea abrir la pantalla de Delivery ahora para ver el pedido y su ticket?`);
            if (deseaIr) {
                window.location.href = 'delivery.html';
            }
        } else {
            alert('Error al registrar pedido de delivery: ' + data.error);
        }
    } catch (err) {
        console.error('Error al despachar a delivery:', err);
        alert('Error de conexión con el servidor local al registrar pedido.');
    }
}

// 4. CARRITO Y TOTALES
function agregarAlCarrito(producto, elCard = null) {
    const index = comandaCarrito.findIndex(item => item.id_producto === producto.id_producto);
    if (index !== -1) {
        comandaCarrito[index].cantidad += 1;
    } else {
        comandaCarrito.push({
            id_producto: producto.id_producto,
            nombre: producto.nombre,
            precio: parseFloat(producto.precio),
            cantidad: 1
        });
    }

    reproducirSonidoPOS('pop');

    if (elCard) {
        elCard.classList.add('clicked');
        animarItemVolando(elCard);
        setTimeout(() => elCard.classList.remove('clicked'), 350);
    }

    const totalElem = document.getElementById('val-total');
    if (totalElem) {
        totalElem.classList.remove('cart-bounce-feedback');
        void totalElem.offsetWidth;
        totalElem.classList.add('cart-bounce-feedback');
    }

    actualizarCarritoUI();
}

function modificarCantidad(index, delta) {
    comandaCarrito[index].cantidad += delta;
    if (comandaCarrito[index].cantidad <= 0) {
        comandaCarrito.splice(index, 1);
    }
    actualizarCarritoUI();
}

function eliminarDelCarrito(index) {
    comandaCarrito.splice(index, 1);
    actualizarCarritoUI();
}

function vaciarCarrito() {
    comandaCarrito = [];
    actualizarCarritoUI();
}

function actualizarCarritoUI() {
    const tbody = document.getElementById('cart-items-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    let subtotal = 0;

    if (comandaCarrito.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="4" class="cart-empty-placeholder">
                    <div class="empty-icon-wrap">
                        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#CBD5E1" stroke-width="1.5">
                            <circle cx="9" cy="21" r="1"></circle>
                            <circle cx="20" cy="21" r="1"></circle>
                            <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"></path>
                        </svg>
                    </div>
                    <div class="empty-title">Comanda Vacía</div>
                    <div class="empty-sub">Seleccione platillos o combos del menú</div>
                </td>
            </tr>
        `;
    } else {
        comandaCarrito.forEach((item, idx) => {
            const itemSubtotal = item.precio * item.cantidad;
            subtotal += itemSubtotal;

            const tr = document.createElement('tr');
            tr.className = 'cart-item-row';
            tr.innerHTML = `
                <td>
                    <div class="cart-item-title">${item.nombre}</div>
                    <span class="cart-item-unit-price">${formatoMoneda(item.precio)} c/u</span>
                </td>
                <td style="text-align:center;">
                    <div class="cart-qty-ctrl">
                        <button type="button" class="qty-btn" onclick="modificarCantidad(${idx}, -1)" title="Reducir">-</button>
                        <span class="qty-display">${item.cantidad}</span>
                        <button type="button" class="qty-btn" onclick="modificarCantidad(${idx}, 1)" title="Aumentar">+</button>
                    </div>
                </td>
                <td class="cart-item-price-col">${formatoMoneda(itemSubtotal)}</td>
                <td style="text-align:right;">
                    <button type="button" class="cart-del-btn" onclick="eliminarDelCarrito(${idx})" title="Quitar platillo">&times;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    }

    // Envío si es delivery
    let costoEnvio = 0;
    if (tipoServicioActual === 'DELIVERY') {
        const txtEnvio = document.getElementById('txt-pos-costo-delivery');
        costoEnvio = parseFloat(txtEnvio ? txtEnvio.value : 0) || 0;
    }

    const impuesto = 0.00;
    const total = parseFloat((subtotal + costoEnvio).toFixed(2));

    document.getElementById('val-subtotal').innerText = formatoMoneda(subtotal);
    const elemEnvio = document.getElementById('val-envio');
    if (elemEnvio) elemEnvio.innerText = formatoMoneda(costoEnvio);
    const elemImp = document.getElementById('val-impuesto');
    if (elemImp) elemImp.innerText = formatoMoneda(0);
    document.getElementById('val-total').innerText = formatoMoneda(total);

    actualizarBadgesComandaEnTarjetas();
    calcularVueltoEnVivo();
}

// Métodos de Pago
function seleccionarMetodoPago(metodo) {
    metodoPagoSeleccionado = metodo;
    const btnEf = document.getElementById('btn-metodo-efectivo');
    const btnTr = document.getElementById('btn-metodo-transferencia');
    const boxEf = document.getElementById('box-pago-efectivo');
    const boxTr = document.getElementById('box-pago-transferencia');

    if (metodo === 1) {
        btnEf.classList.add('active');
        btnTr.classList.remove('active');
        boxEf.style.display = 'flex';
        boxTr.style.display = 'none';
        calcularVueltoEnVivo();
    } else {
        btnTr.classList.add('active');
        btnEf.classList.remove('active');
        boxEf.style.display = 'none';
        boxTr.style.display = 'flex';
    }
}

function seleccionarBanco(banco, elem) {
    bancoSeleccionado = banco;
    document.querySelectorAll('.bank-card-btn').forEach(el => el.classList.remove('active'));
    elem.classList.add('active');
}

function calcularVueltoEnVivo() {
    const totalTxt = document.getElementById('val-total').innerText.replace('C$', '').trim();
    const total = parseFloat(totalTxt) || 0;
    const recibidoInput = document.getElementById('txt-monto-recibido');
    const recibido = parseFloat(recibidoInput ? recibidoInput.value : 0) || 0;

    let vuelto = 0;
    if (recibido >= total) {
        vuelto = recibido - total;
    }
    const elemVuelto = document.getElementById('val-vuelto');
    if (elemVuelto) elemVuelto.innerText = formatoMoneda(vuelto);

    const boxVuelto = document.getElementById('box-vuelto-display');
    if (boxVuelto) {
        if (vuelto > 0 && recibido > total) {
            boxVuelto.classList.add('has-change');
        } else {
            boxVuelto.classList.remove('has-change');
        }
    }
}

function establecerMontoRecibidoRapido(monto) {
    const totalTxt = document.getElementById('val-total').innerText.replace('C$', '').trim();
    const total = parseFloat(totalTxt) || 0;
    const recibidoInput = document.getElementById('txt-monto-recibido');
    if (!recibidoInput) return;

    if (monto === 'EXACTO') {
        recibidoInput.value = total > 0 ? total.toFixed(2) : '';
    } else {
        recibidoInput.value = parseFloat(monto).toFixed(2);
    }
    calcularVueltoEnVivo();
}

// -------------------------------------------------------------
// GESTIÓN DIRECTA DE PLATILLOS DESDE POS (SOLO ADMINISTRADOR)
// -------------------------------------------------------------
let categoriasPOS = [];

async function cargarCategoriasPOS() {
    try {
        const res = await fetchAuth('/api/categorias');
        categoriasPOS = await res.json();
        const sel = document.getElementById('select-pos-prod-categoria');
        if (sel) {
            sel.innerHTML = '';
            categoriasPOS.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id_categoria;
                opt.innerText = c.nombre;
                sel.appendChild(opt);
            });
        }
    } catch (e) {
        console.error('Error cargando categorías en POS:', e);
    }
}

async function abrirModalPlatilloPOS() {
    const usuario = obtenerUsuarioActual();
    if (!usuario || usuario.id_rol !== 1) {
        alert('Acceso Denegado: Solo el Administrador puede crear o modificar platillos.');
        return;
    }

    await cargarCategoriasPOS();
    document.getElementById('modal-platillo-pos-title').innerText = 'Nuevo Platillo o Combo';
    document.getElementById('txt-pos-prod-id').value = '';
    document.getElementById('txt-pos-prod-nombre').value = '';
    document.getElementById('txt-pos-prod-precio').value = '';
    document.getElementById('txt-pos-prod-desc').value = '';
    document.getElementById('chk-pos-prod-combo').checked = false;
    document.getElementById('wrap-chk-pos-prod-activo').style.display = 'none';
    document.getElementById('btn-pos-eliminar-prod').style.display = 'none';
    document.getElementById('modal-platillo-pos').classList.add('open');
}

async function abrirModalEditarPlatilloPOS(event, id) {
    if (event) event.stopPropagation();

    const usuario = obtenerUsuarioActual();
    if (!usuario || usuario.id_rol !== 1) {
        alert('Acceso Denegado: Solo el Administrador puede modificar platillos.');
        return;
    }

    const prod = catalogoProductos.find(p => p.id_producto === id);
    if (!prod) return;

    await cargarCategoriasPOS();
    document.getElementById('modal-platillo-pos-title').innerText = `Modificar: ${prod.nombre}`;
    document.getElementById('txt-pos-prod-id').value = prod.id_producto;
    document.getElementById('txt-pos-prod-nombre').value = prod.nombre;
    document.getElementById('select-pos-prod-categoria').value = prod.id_categoria;
    document.getElementById('txt-pos-prod-precio').value = prod.precio;
    document.getElementById('txt-pos-prod-desc').value = prod.descripcion || '';
    document.getElementById('chk-pos-prod-combo').checked = !!prod.es_combo;
    document.getElementById('chk-pos-prod-activo').checked = prod.estado !== 0;
    document.getElementById('wrap-chk-pos-prod-activo').style.display = 'inline-flex';
    document.getElementById('btn-pos-eliminar-prod').style.display = 'inline-block';
    document.getElementById('modal-platillo-pos').classList.add('open');
}

function cerrarModalPlatilloPOS() {
    const modal = document.getElementById('modal-platillo-pos');
    if (modal) modal.classList.remove('open');
}

async function guardarPlatilloDesdePOS(e) {
    e.preventDefault();
    const id = document.getElementById('txt-pos-prod-id').value;
    const nombre = document.getElementById('txt-pos-prod-nombre').value.trim();
    const id_categoria = document.getElementById('select-pos-prod-categoria').value;
    const precio = document.getElementById('txt-pos-prod-precio').value;
    const descripcion = document.getElementById('txt-pos-prod-desc').value.trim();
    const es_combo = document.getElementById('chk-pos-prod-combo').checked;
    const estado = document.getElementById('chk-pos-prod-activo').checked ? 1 : 0;

    const url = id ? `/api/productos/${id}` : '/api/productos';
    const method = id ? 'PUT' : 'POST';
    const payload = { nombre, id_categoria, precio, descripcion, es_combo, estado };

    try {
        const res = await fetchAuth(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast(id ? `Platillo "${nombre}" actualizado exitosamente.` : `Platillo "${nombre}" agregado al menú.`);
            cerrarModalPlatilloPOS();
            await cargarCatalogoPOS();
        } else {
            alert('Error: ' + (data.error || 'No se pudo guardar el platillo.'));
        }
    } catch (err) {
        alert('Error de conexión al guardar platillo.');
    }
}

async function eliminarPlatilloDesdePOS() {
    const id = document.getElementById('txt-pos-prod-id').value;
    const nombre = document.getElementById('txt-pos-prod-nombre').value;
    if (!id) return;

    if (!confirm(`¿Está seguro de que desea eliminar el platillo "${nombre}" del menú de ventas?`)) {
        return;
    }

    try {
        const res = await fetchAuth(`/api/productos/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
            mostrarToast(`Platillo "${nombre}" eliminado del catálogo.`);
            cerrarModalPlatilloPOS();
            await cargarCatalogoPOS();
        } else {
            alert('Error: ' + (data.error || 'No se pudo eliminar el platillo.'));
        }
    } catch (err) {
        alert('Error de conexión al eliminar platillo.');
    }
}

// 5. PROCESAMIENTO DE FACTURACIÓN
async function procesarFacturacion() {
    if (comandaCarrito.length === 0) {
        mostrarToast('Agregue platillos o combos a la orden antes de facturar.', 'warning');
        return;
    }

    if (!cajaActivaActual) {
        mostrarToast('Debe abrir la caja chica con su fondo inicial antes de vender.', 'danger');
        abrirModalAperturaCaja();
        return;
    }

    const totalTxt = document.getElementById('val-total').innerText.replace('C$', '').trim();
    const total = parseFloat(totalTxt) || 0;
    const usuario = obtenerUsuarioActual();
    const selectCliente = document.getElementById('select-cliente-pos');
    const idCliente = selectCliente ? parseInt(selectCliente.value) : 1;
    const clSeleccionado = clientesRegistradosPOS.find(c => c.id_cliente === idCliente);
    const clienteNombre = clSeleccionado ? clSeleccionado.nombre : 'Consumidor Final';
    const clienteTelefono = clSeleccionado ? clSeleccionado.telefono : '';

    let montoRecibido = total;
    let banco = null;
    let referencia = null;

    if (metodoPagoSeleccionado === 1) {
        const txtRecibido = document.getElementById('txt-monto-recibido').value;
        montoRecibido = parseFloat(txtRecibido);
        if (isNaN(montoRecibido) || montoRecibido < total) {
            alert(`El efectivo recibido (${formatoMoneda(montoRecibido || 0)}) no cubre el total (${formatoMoneda(total)}).`);
            return;
        }
    } else {
        banco = bancoSeleccionado;
        const refInput = document.getElementById('txt-referencia-transferencia');
        referencia = refInput ? refInput.value.trim() : '';
        if (!referencia) {
            alert('Debe ingresar el número de referencia bancaria emitida por ' + banco + '.');
            if (refInput) refInput.focus();
            return;
        }
        montoRecibido = total;
    }

    // Datos de delivery si aplica
    let costoEnvio = 0;
    let repartidor = null;
    let direccionEntrega = null;

    if (tipoServicioActual === 'DELIVERY') {
        costoEnvio = parseFloat(document.getElementById('txt-pos-costo-delivery').value) || 0;
        repartidor = document.getElementById('select-pos-repartidor').value || null;
        direccionEntrega = document.getElementById('txt-pos-direccion-delivery').value.trim();
        if (!direccionEntrega) {
            alert('Por favor ingrese la dirección exacta de entrega en Sierra Maestra o zonas cercanas.');
            document.getElementById('txt-pos-direccion-delivery').focus();
            return;
        }
    }

    const payload = {
        items: comandaCarrito,
        id_metodo_pago: metodoPagoSeleccionado,
        id_usuario: usuario ? usuario.id_usuario : 1,
        id_caja: cajaActivaActual.id_caja,
        monto_recibido: montoRecibido,
        id_cliente: idCliente,
        cliente_nombre: clienteNombre,
        telefono_cliente: clienteTelefono,
        banco: banco,
        referencia_transferencia: referencia,
        tipo_entrega: tipoServicioActual,
        costo_delivery: costoEnvio,
        repartidor: repartidor,
        direccion_entrega: direccionEntrega
    };

    try {
        const res = await fetch('/api/ventas', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json();

        if (data.success) {
            ultimaVentaProcesada = data;
            reproducirSonidoPOS('success');
            mostrarToast('Venta procesada y factura generada con éxito.');

            mostrarModalComprobante(data);

            vaciarCarrito();
            if (document.getElementById('txt-monto-recibido')) document.getElementById('txt-monto-recibido').value = '';
            if (document.getElementById('txt-referencia-transferencia')) document.getElementById('txt-referencia-transferencia').value = '';

            consultarAlertasStockHeader();
            actualizarConteoDeliveryHeader();
        } else {
            alert('Error al facturar: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Error conectando con el servidor local.');
    }
}

// Modal de Factura Comercial y Ticket con QR
async function mostrarModalComprobante(data) {
    const modal = document.getElementById('modal-comprobante-exito');
    if (!modal) return;

    const v = data.venta;

    // 1. Factura Comercial Formal
    document.getElementById('fac-numero').innerText = v.numero_factura;
    document.getElementById('fac-fecha').innerText = v.fecha;
    document.getElementById('fac-cliente-nombre').innerText = v.cliente_nombre;
    document.getElementById('fac-cliente-telefono').innerText = v.cliente_telefono || '--';
    document.getElementById('fac-tipo-entrega').innerText = v.tipo_entrega === 'DELIVERY' ? 'A Domicilio' : (v.tipo_entrega === 'LLEVAR' ? 'Para Llevar' : 'En Local');
    document.getElementById('fac-direccion').innerText = v.direccion_entrega || 'En Local / Mostrador';

    const tbody = document.getElementById('fac-items-body');
    tbody.innerHTML = '';
    (v.items || []).forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-align:center;">${it.cantidad}</td>
            <td><strong>${it.nombre}</strong></td>
            <td style="text-align:right;">C$ ${parseFloat(it.precio).toFixed(2)}</td>
            <td style="text-align:right; font-weight:700;">C$ ${(it.precio * it.cantidad).toFixed(2)}</td>
        `;
        tbody.appendChild(tr);
    });

    document.getElementById('fac-subtotal').innerText = formatoMoneda(v.subtotal);
    const rowDel = document.getElementById('fac-row-delivery');
    if (v.costo_delivery > 0) {
        rowDel.style.display = 'flex';
        document.getElementById('fac-delivery').innerText = formatoMoneda(v.costo_delivery);
    } else {
        rowDel.style.display = 'none';
    }
    document.getElementById('fac-iva').innerText = formatoMoneda(v.impuesto);
    document.getElementById('fac-total').innerText = formatoMoneda(v.total);

    const pagoTxt = v.metodo_pago + (v.referencia ? ' (Ref: ' + v.referencia + ')' : '');
    document.getElementById('fac-metodo-info').innerText = `Pago: ${pagoTxt}`;

    // Obtener IP real del servidor para escaneo QR móvil sin depender de localhost
    let sBaseUrl = window.location.origin;
    try {
        const resInfo = await fetch('/api/server-info');
        const sInfo = await resInfo.json();
        if (sInfo && sInfo.baseUrl) {
            sBaseUrl = sInfo.baseUrl;
        }
    } catch (e) {
        // Fallback
    }

    // Generar Código QR Dinámico Nítido (Apunta directamente a la Factura Digital / PDF con IP real)
    const qrWrap = document.getElementById('factura-qr-code');
    qrWrap.innerHTML = '';

    let qrTexto = data.digital_link || data.qr_payload;
    if (!qrTexto || qrTexto.includes('localhost') || qrTexto.includes('wa.me')) {
        qrTexto = `${sBaseUrl}/comprobante.html?fac=${encodeURIComponent(v.numero_factura)}`;
    } else if (sBaseUrl && !sBaseUrl.includes('localhost') && qrTexto.includes('localhost')) {
        qrTexto = qrTexto.replace(/https?:\/\/localhost:\d+/, sBaseUrl);
    }

    if (window.QRCode) {
        new QRCode(qrWrap, {
            text: qrTexto,
            width: 150,
            height: 150,
            margin: 2
        });
    }

    const lnkProbar = document.getElementById('lnk-probar-qr');
    if (lnkProbar) {
        lnkProbar.href = qrTexto;
    }

    // 2. Ticket Térmico Portátil
    const elemTicket = document.getElementById('preview-ticket-escpos');
    if (elemTicket) elemTicket.innerText = data.ticket_esc_pos;



    // 4. Botón Ver en Delivery si la venta fue modalidad DELIVERY
    const btnVerDelivery = document.getElementById('btn-ver-en-delivery');
    if (btnVerDelivery) {
        if (v.tipo_entrega === 'DELIVERY' || data.es_delivery) {
            btnVerDelivery.style.display = 'inline-flex';
            btnVerDelivery.href = 'delivery.html';
            btnVerDelivery.title = 'Abrir tablero de delivery para dar seguimiento a este pedido';
        } else {
            btnVerDelivery.style.display = 'none';
        }
    }

    cambiarVistaComprobante('factura');
    modal.classList.add('open');
}

function cambiarVistaComprobante(vista) {
    const tabFac = document.getElementById('tab-btn-factura');
    const tabTic = document.getElementById('tab-btn-ticket');
    const secFac = document.getElementById('vista-factura-comercial');
    const secTic = document.getElementById('vista-ticket-termico');

    if (vista === 'factura') {
        tabFac.classList.add('active');
        tabTic.classList.remove('active');
        secFac.style.display = 'block';
        secTic.style.display = 'none';
    } else {
        tabTic.classList.add('active');
        tabFac.classList.remove('active');
        secTic.style.display = 'block';
        secFac.style.display = 'none';
    }
}

function imprimirFacturaPDF() {
    cambiarVistaComprobante('factura');
    window.print();
}



function imprimirTicketTermico() {
    if (!ultimaVentaProcesada) return;
    cambiarVistaComprobante('ticket');
    let printArea = document.getElementById('printable-thermal-ticket');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'printable-thermal-ticket';
        document.body.appendChild(printArea);
    }
    printArea.className = 'activo';
    document.body.classList.add('imprimiendo-ticket');
    printArea.innerHTML = `<pre>${ultimaVentaProcesada.ticket_esc_pos}</pre>`;
    window.print();
    setTimeout(() => {
        document.body.classList.remove('imprimiendo-ticket');
        if (printArea) printArea.classList.remove('activo');
    }, 1000);
}



function cerrarModalComprobante() {
    const modal = document.getElementById('modal-comprobante-exito');
    if (modal) modal.classList.remove('open');
}

// Modal Nuevo Cliente
function abrirModalNuevoCliente() {
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) modal.classList.add('open');
}

function cerrarModalNuevoCliente() {
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) modal.classList.remove('open');
}

async function guardarClienteDesdePOS(e) {
    e.preventDefault();
    const nombre = document.getElementById('txt-nc-nombre').value.trim();
    const telefono = document.getElementById('txt-nc-telefono').value.trim();
    const direccion = document.getElementById('txt-nc-direccion').value.trim();
    const categoria = document.getElementById('txt-nc-categoria').value;

    try {
        const res = await fetch('/api/clientes', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ nombre, telefono, direccion, categoria })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Cliente guardado y seleccionado.');
            cerrarModalNuevoCliente();
            await cargarClientesPOS();
            const select = document.getElementById('select-cliente-pos');
            if (select) select.value = data.id_cliente;
            alSeleccionarClientePOS();
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error al guardar cliente.');
    }
}