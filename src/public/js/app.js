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
        alert('Acceso Denegado: Esta sección requiere perfil de Administrador.');
        window.location.href = 'pos.html';
        return null;
    }

    return usuario;
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

function renderizarCatalogo(productos) {
    const grid = document.getElementById('grid-productos');
    if (!grid) return;
    grid.innerHTML = '';

    if (productos.length === 0) {
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 30px; color:#64748B;">No se encontraron platillos en esta sección.</p>';
        return;
    }

    productos.forEach(p => {
        const card = document.createElement('div');
        card.className = `product-card ${p.es_combo ? 'is-combo' : ''}`;
        card.onclick = () => agregarAlCarrito(p);

        card.innerHTML = `
            ${p.es_combo ? '<span class="product-badge-combo">COMBO</span>' : ''}
            <div>
                <h3>${p.nombre}</h3>
                <p class="desc">${p.descripcion || ''}</p>
            </div>
            <div class="price-row">
                <span class="price">${formatoMoneda(p.precio)}</span>
                <span class="add-btn">+</span>
            </div>
        `;
        grid.appendChild(card);
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
        const searchInput = document.getElementById('txt-buscar-producto');
        if (searchInput) searchInput.value = '';
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
    const catActiva = document.querySelector('.cat-btn.active');
    const idCat = catActiva ? catActiva.getAttribute('data-cat') : 'todos';
    filtrarPorCategoria(idCat, catActiva || document.querySelector('.cat-btn'), true);
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

// 4. CARRITO Y TOTALES
function agregarAlCarrito(producto) {
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
            mostrarToast('Venta procesada y factura generada con éxito.');

            mostrarModalComprobante(data);

            vaciarCarrito();
            if (document.getElementById('txt-monto-recibido')) document.getElementById('txt-monto-recibido').value = '';
            if (document.getElementById('txt-referencia-transferencia')) document.getElementById('txt-referencia-transferencia').value = '';

            consultarAlertasStockHeader();
        } else {
            alert('Error al facturar: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Error conectando con el servidor local.');
    }
}

// Modal de Factura Comercial y Ticket con QR
function mostrarModalComprobante(data) {
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

    // Generar Código QR Dinámico Nítido (Universal para Celulares)
    const qrWrap = document.getElementById('factura-qr-code');
    qrWrap.innerHTML = '';
    const qrTexto = data.whatsapp_link || data.qr_payload || `https://wa.me/?text=${encodeURIComponent(`*EL GUSTAZO*\nFactura: ${v.numero_factura}\nTotal: C$ ${parseFloat(v.total).toFixed(2)}\nCliente: ${v.cliente_nombre}`)}`;

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

    // 3. WhatsApp Link
    const btnWa = document.getElementById('btn-enviar-whatsapp');
    if (btnWa) {
        btnWa.href = data.whatsapp_link;
        btnWa.target = '_blank';
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
    printArea.innerHTML = `<pre style="font-family: monospace; font-size:12px; margin:0;">${ultimaVentaProcesada.ticket_esc_pos}</pre>`;
    window.print();
}

function copiarResumenWhatsApp() {
    if (!ultimaVentaProcesada) return;
    navigator.clipboard.writeText(ultimaVentaProcesada.whatsapp_mensaje).then(() => {
        mostrarToast('Resumen de factura copiado al portapapeles.');
    }).catch(() => {
        alert('No se pudo copiar automáticamente.');
    });
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