/**
 * =========================================================
 * EL BUEN GUSTO - EL GUSTAZO POS & GESTIÓN INTEGRAL
 * Lógica Central de Cliente (JavaScript Vanilla)
 * Sierra Maestra, Managua - Operación 100% Offline
 * =========================================================
 */

// =========================================================
// 1. SESIÓN Y CONTROL DE ACCESO BASADO EN ROLES (RBAC) (RF-21, RNF-04)
// =========================================================
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

// Inicializar cabecera común y estado de usuario
function inicializarHeaderComun() {
    const usuario = obtenerUsuarioActual();
    if (!usuario) return;

    // Actualizar nombre y rol en la cabecera
    const spanUser = document.getElementById('header-user-name');
    const spanRol = document.getElementById('header-user-role');
    if (spanUser) spanUser.innerText = usuario.nombre;
    if (spanRol) spanRol.innerText = usuario.rol;

    // Ocultar enlaces de Admin para el rol Cajero
    if (usuario.id_rol !== 1) {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Comprobar alertas de stock bajo inmediatamente
    consultarAlertasStockHeader();
}

// Consultar alertas de stock para la insignia del header (RF-10)
async function consultarAlertasStockHeader() {
    try {
        const res = await fetch('/api/alertas-stock');
        const data = await res.json();
        const btnAlert = document.getElementById('btn-header-alert');
        if (btnAlert) {
            if (data && data.length > 0) {
                btnAlert.style.display = 'inline-flex';
                btnAlert.innerHTML = `⚠️ Insumos Críticos (${data.length})`;
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

// =========================================================
// 2. UTILIDADES GENERALES
// =========================================================
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

// =========================================================
// 3. LÓGICA DEL MÓDULO POS Y FACTURACIÓN (RF-01 a RF-08)
// =========================================================
let catalogoProductos = [];
let comandaCarrito = [];
let cajaActivaActual = null;
let metodoPagoSeleccionado = 1; // 1: Efectivo, 2: Transferencia
let bancoSeleccionado = 'BAC'; // BAC, Banpro, Lafise, BDF, Ficohsa
let ultimaVentaProcesada = null;

// Cargar estado inicial del POS
async function inicializarPOS() {
    const usuario = verificarAutenticacion(false);
    if (!usuario) return;
    inicializarHeaderComun();

    // 1. Verificar caja activa (RF-16)
    await verificarCajaChicaActiva();

    // 2. Cargar catálogo de productos y combos (RF-02)
    await cargarCatalogoPOS();

    // 3. Cargar lista de clientes registrados (RF-13, RF-14)
    await cargarClientesPOS();
}

// Verificar caja chica activa (RF-16)
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
            // Abrir modal obligatorio de apertura
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

// Cargar catálogo de platillos y combos (RF-02)
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
        grid.innerHTML = '<p style="grid-column: 1/-1; text-align:center; padding: 30px; color:#64748B;">No se encontraron platillos o combos en esta sección.</p>';
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

// Filtro por categorías y buscador dinámico (RF-02)
function filtrarPorCategoria(idCategoria, btn) {
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    const txtBusqueda = (document.getElementById('txt-buscar-producto').value || '').toLowerCase();

    let filtrados = catalogoProductos;
    if (idCategoria !== 'todos') {
        filtrados = filtrados.filter(p => p.id_categoria === parseInt(idCategoria));
    }
    if (txtBusqueda) {
        filtrados = filtrados.filter(p => p.nombre.toLowerCase().includes(txtBusqueda) || (p.descripcion && p.descripcion.toLowerCase().includes(txtBusqueda)));
    }
    renderizarCatalogo(filtrados);
}

function buscarPlatilloEnVivo() {
    const catActiva = document.querySelector('.cat-btn.active');
    const idCat = catActiva ? catActiva.getAttribute('data-cat') : 'todos';
    filtrarPorCategoria(idCat, catActiva || document.querySelector('.cat-btn'));
}

// Cargar clientes registrados en el POS (RF-13, RF-14)
async function cargarClientesPOS() {
    try {
        const res = await fetch('/api/clientes');
        const clientes = await res.json();
        const select = document.getElementById('select-cliente-pos');
        if (select) {
            select.innerHTML = '';
            clientes.forEach(cl => {
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

// =========================================================
// 4. GESTIÓN DEL CARRITO / COMANDA (RF-01, RF-03)
// =========================================================
function agregarAlCarrito(producto) {
    const index = comandaCarrito.findIndex(item => item.id_producto === producto.id_producto);
    if (index !== -1) {
        comandaCarrito[index].cantidad += 1;
    } else {
        comandaCarrito.push({
            id_producto: producto.id_producto,
            nombre: producto.nombre,
            precio: producto.precio,
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
    comandaCarrito.forEach((item, idx) => {
        const itemSubtotal = item.precio * item.cantidad;
        subtotal += itemSubtotal;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="cart-item-title">${item.nombre}</div>
                <small style="color:#64748B;">${formatoMoneda(item.precio)} c/u</small>
            </td>
            <td>
                <div class="cart-qty-ctrl">
                    <button class="qty-btn" onclick="modificarCantidad(${idx}, -1)">-</button>
                    <span class="qty-display">${item.cantidad}</span>
                    <button class="qty-btn" onclick="modificarCantidad(${idx}, 1)">+</button>
                </div>
            </td>
            <td style="font-weight:700; color:#0F172A;">${formatoMoneda(itemSubtotal)}</td>
            <td style="text-align:right;">
                <button class="cart-del-btn" onclick="eliminarDelCarrito(${idx})" title="Eliminar">&times;</button>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Cálculo automático de la venta (RF-03)
    const impuesto = parseFloat((subtotal * 0.15).toFixed(2)); // IVA 15%
    const total = parseFloat((subtotal + impuesto).toFixed(2));

    document.getElementById('val-subtotal').innerText = formatoMoneda(subtotal);
    document.getElementById('val-impuesto').innerText = formatoMoneda(impuesto);
    document.getElementById('val-total').innerText = formatoMoneda(total);

    calcularVueltoEnVivo();
}

// Métodos de pago permitidos: Efectivo y Transferencia (RF-06)
function seleccionarMetodoPago(metodo) {
    metodoPagoSeleccionado = metodo;
    const btnEf = document.getElementById('btn-metodo-efectivo');
    const btnTr = document.getElementById('btn-metodo-transferencia');
    const boxEf = document.getElementById('box-pago-efectivo');
    const boxTr = document.getElementById('box-pago-transferencia');

    if (metodo === 1) { // Efectivo
        btnEf.classList.add('active');
        btnTr.classList.remove('active');
        boxEf.style.display = 'flex';
        boxTr.style.display = 'none';
        calcularVueltoEnVivo();
    } else { // Transferencia Bancaria
        btnTr.classList.add('active');
        btnEf.classList.remove('active');
        boxEf.style.display = 'none';
        boxTr.style.display = 'flex';
    }
}

// Selección visual de banco de destino (RF-07)
function seleccionarBanco(banco, elem) {
    bancoSeleccionado = banco;
    document.querySelectorAll('.bank-card-btn').forEach(el => el.classList.remove('active'));
    elem.classList.add('active');
}

// Cálculo en vivo del vuelto (RF-03)
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

// =========================================================
// 5. PROCESAMIENTO DE FACTURACIÓN Y EMISIÓN DE COMPROBANTES (RF-01 a RF-09)
// =========================================================
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
    const clienteNombre = selectCliente ? selectCliente.options[selectCliente.selectedIndex].text.split(' - ')[0] : 'Consumidor Final';

    let montoRecibido = total;
    let banco = null;
    let referencia = null;

    if (metodoPagoSeleccionado === 1) { // Efectivo
        const txtRecibido = document.getElementById('txt-monto-recibido').value;
        montoRecibido = parseFloat(txtRecibido);
        if (isNaN(montoRecibido) || montoRecibido < total) {
            alert(`El efectivo recibido (${formatoMoneda(montoRecibido || 0)}) no cubre el total de la orden (${formatoMoneda(total)}).`);
            return;
        }
    } else { // Transferencia Bancaria (RF-07, RF-08)
        banco = bancoSeleccionado;
        const refInput = document.getElementById('txt-referencia-transferencia');
        referencia = refInput ? refInput.value.trim() : '';
        if (!referencia) {
            alert('Debe ingresar el número de referencia o confirmación emitido por la app bancaria (' + banco + ').');
            if (refInput) refInput.focus();
            return;
        }
        montoRecibido = total;
    }

    const payload = {
        items: comandaCarrito,
        id_metodo_pago: metodoPagoSeleccionado,
        id_usuario: usuario ? usuario.id_usuario : 1,
        id_caja: cajaActivaActual.id_caja,
        monto_recibido: montoRecibido,
        id_cliente: idCliente,
        cliente_nombre: clienteNombre,
        banco: banco,
        referencia_transferencia: referencia
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
            mostrarToast('¡Venta realizada y comandada con éxito!', 'success');

            // Abrir Modal de Comprobantes (Físico ESC/POS y Digital WhatsApp)
            mostrarModalComprobante(data);

            // Limpiar carrito y campos
            vaciarCarrito();
            if (document.getElementById('txt-monto-recibido')) document.getElementById('txt-monto-recibido').value = '';
            if (document.getElementById('txt-referencia-transferencia')) document.getElementById('txt-referencia-transferencia').value = '';

            // Refrescar alertas de stock
            consultarAlertasStockHeader();
        } else {
            alert('Error al facturar: ' + data.error);
        }
    } catch (e) {
        console.error(e);
        alert('Error conectando con el servidor local.');
    }
}

// Mostrar modal de comprobantes (RF-04, RF-05)
function mostrarModalComprobante(data) {
    const modal = document.getElementById('modal-comprobante-exito');
    if (!modal) return;

    // Llenar vista previa del ticket térmico
    const elemTicket = document.getElementById('preview-ticket-escpos');
    if (elemTicket) elemTicket.innerText = data.ticket_esc_pos;

    // Configurar botón de WhatsApp
    const btnWa = document.getElementById('btn-enviar-whatsapp');
    if (btnWa) {
        btnWa.href = data.whatsapp_link;
        btnWa.target = '_blank';
    }

    modal.classList.add('open');
}

// Imprimir comprobante térmico ESC/POS mediante diálogo de impresora portátil (RF-04)
function imprimirTicketTermico() {
    if (!ultimaVentaProcesada) return;

    let printArea = document.getElementById('printable-thermal-ticket');
    if (!printArea) {
        printArea = document.createElement('div');
        printArea.id = 'printable-thermal-ticket';
        document.body.appendChild(printArea);
    }
    printArea.innerHTML = `<pre style="font-family: monospace; font-size:12px; margin:0;">${ultimaVentaProcesada.ticket_esc_pos}</pre>`;
    window.print();
}

// Copiar texto para WhatsApp al portapapeles (RF-05)
function copiarResumenWhatsApp() {
    if (!ultimaVentaProcesada) return;
    navigator.clipboard.writeText(ultimaVentaProcesada.whatsapp_mensaje).then(() => {
        mostrarToast('Resumen de factura copiado al portapapeles.');
    }).catch(() => {
        alert('No se pudo copiar automáticamente. Puedes seleccionar el texto.');
    });
}

function cerrarModalComprobante() {
    const modal = document.getElementById('modal-comprobante-exito');
    if (modal) modal.classList.remove('open');
}

// Modal para agregar rápido un cliente desde el POS
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
    const nombre = document.getElementById('txt-nc-nombre').value;
    const telefono = document.getElementById('txt-nc-telefono').value;
    const direccion = document.getElementById('txt-nc-direccion').value;
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
            // Seleccionar automáticamente al nuevo cliente
            const select = document.getElementById('select-cliente-pos');
            if (select) select.value = data.id_cliente;
        } else {
            alert('Error: ' + data.error);
        }
    } catch (err) {
        alert('Error al guardar cliente.');
    }
}