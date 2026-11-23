/**
 * =============================================================================
 * EL BUEN GUSTO - EL GUSTAZO POS & GESTIÓN INTEGRAL
 * Lógica Central de Cliente (JavaScript Vanilla)
 * Sierra Maestra, Managua - Operación 100% Offline
 * =============================================================================
 * 
 * ¿POR QUÉ EXISTE ESTE ARCHIVO (app.js)?
 * Este archivo centraliza la interactividad y la lógica de negocio del frontend
 * para el Punto de Venta (POS) y las operaciones compartidas de la aplicación.
 * 
 * RAZONES ARQUITECTÓNICAS Y DE NEGOCIO:
 * 1. Operación 100% Offline: Todo el código está escrito en Vanilla JavaScript
 *    puro, sin frameworks pesados (como React o Angular) ni dependencias externas
 *    vía CDN. Esto garantiza que si se cae el servicio de internet en Managua,
 *    el restaurante puede seguir facturando, cobrando y gestionando su inventario
 *    sin ninguna interrupción.
 * 2. Control de Acceso Basado en Roles (RBAC): Valida en el navegador los permisos
 *    del Cajero vs. Administrador, ocultando o habilitando botones según corresponda.
 * 3. Reactividad en Tiempo Real: Maneja el estado en memoria de la comanda/carrito,
 *    calculando subtotales, vuelto de billetes en efectivo y costos de delivery
 *    instantáneamente mientras el cajero interactúa con la pantalla táctil.
 * 4. Micro-interacciones y Feedback Acústico: Sintetiza sonidos mediante la Web Audio API
 *    (sin archivos MP3 externos) para confirmar al cajero que un platillo se agregó
 *    o que una venta fue procesada exitosamente.
 * 5. Facturación Limpia sin QR Innecesario: Genera la vista de factura comercial
 *    y tickets térmicos listos para imprimir (58mm/80mm), prescindiendo de códigos QR
 *    locales que confundirían al cliente si este no cuenta con conexión a la red Wi-Fi
 *    del local.
 * =============================================================================
 */

// =============================================================================
// SECCIÓN 1: SESIÓN, SEGURIDAD Y CONTROL DE ACCESO (RBAC)
// =============================================================================

/**
 * Recupera los datos del usuario autenticado guardados en el almacenamiento local.
 * 
 * ¿POR QUÉ SE PUSO?
 * El sistema funciona en navegadores táctiles de mostrador. Para evitar solicitar
 * usuario y contraseña en cada cambio de página (POS -> Inventario -> Delivery),
 * se guarda una sesión ligera en localStorage. Si los datos están corruptos o no existen,
 * retorna null para forzar un inicio de sesión seguro.
 * 
 * @returns {Object|null} Objeto con datos del usuario (id, nombre, id_rol) o null.
 */
function obtenerUsuarioActual() {
    try {
        const userJson = localStorage.getItem('elgustazo_user');
        return userJson ? JSON.parse(userJson) : null;
    } catch (e) {
        console.error('Error al recuperar sesión del usuario:', e);
        return null;
    }
}

/**
 * Guarda los datos de autenticación del usuario en localStorage tras un login exitoso.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite persistir la identidad del usuario actual (nombre, rol, id) durante toda
 * su jornada de trabajo sin necesidad de consultar el servidor en cada interacción.
 * 
 * @param {Object} userData - Información del usuario devuelta por el servidor.
 */
function guardarSesionUsuario(userData) {
    localStorage.setItem('elgustazo_user', JSON.stringify(userData));
}

/**
 * Destruye la sesión del usuario actual y redirige a la pantalla de login.
 * 
 * ¿POR QUÉ SE PUSO?
 * Garantiza que cuando un cajero o administrador termina su turno, sus credenciales
 * sean eliminadas inmediatamente del navegador para evitar que otra persona facture
 * a su nombre.
 */
function cerrarSesion() {
    localStorage.removeItem('elgustazo_user');
    window.location.href = 'login.html';
}

/**
 * Verifica si el usuario cuenta con una sesión válida y con los permisos necesarios.
 * 
 * ¿POR QUÉ SE PUSO?
 * Actúa como un guardián de ruta en el cliente (Client-side Route Guard).
 * Si un usuario intenta acceder directamente a una pantalla restringida (como administración
 * de platillos, recetas BOM o reportes globales) sin ser Administrador (id_rol = 1),
 * se le notifica y se le redirige al POS para proteger la integridad operativa.
 * 
 * @param {boolean} requiereAdmin - Si es true, exige id_rol === 1 (Administrador).
 * @returns {Object|null} El objeto de usuario si la verificación es exitosa; redirige y retorna null si no.
 */
function verificarAutenticacion(requiereAdmin = false) {
    const usuario = obtenerUsuarioActual();
    const paginaActual = window.location.pathname.split('/').pop();

    // Si no hay usuario y no estamos ya en el login, redirigir inmediatamente
    if (!usuario && paginaActual !== 'login.html') {
        window.location.href = 'login.html';
        return null;
    }

    // Validación de privilegios administrativos para módulos críticos
    if (requiereAdmin && usuario && usuario.id_rol !== 1 && usuario.id_rol !== 3) {
        alert('Acceso Restringido: Las funciones administrativas y de auditoría están reservadas para el Administrador o Gerente General.');
        window.location.href = 'pos.html';
        return null;
    }

    return usuario;
}

/**
 * Wrapper de peticiones HTTP (fetch) que inyecta automáticamente los encabezados RBAC.
 * 
 * ¿POR QUÉ SE PUSO?
 * El servidor Node.js/Express valida en sus endpoints protegidos los encabezados
 * 'x-user-id' y 'x-user-role'. Esta función evita tener que escribir manualmente
 * esos encabezados en cada llamada a la API, garantizando que todas las solicitudes
 * viajen firmadas con la identidad del operador actual.
 * 
 * @param {string} url - Dirección del endpoint a consultar.
 * @param {Object} options - Opciones de configuración de fetch (method, body, headers, etc.).
 * @returns {Promise<Response>} Promesa de la respuesta HTTP.
 */
function fetchAuth(url, options = {}) {
    const usuario = obtenerUsuarioActual();
    const headers = options.headers ? { ...options.headers } : {};
    if (usuario) {
        headers['x-user-id'] = String(usuario.id_usuario);
        headers['x-user-role'] = String(usuario.id_rol);
        headers['x-user-role-name'] = String(usuario.rol || '');
    }
    return fetch(url, { ...options, headers });
}

/**
 * Inicializa la barra superior (Header) compartida en todas las páginas.
 * 
 * ¿POR QUÉ SE PUSO?
 * Muestra el nombre y rol del usuario conectado en la esquina superior, oculta
 * los elementos con clase '.admin-only' a los cajeros y activa los indicadores
 * en vivo de pedidos de delivery activos y alertas de inventario crítico.
 */
function inicializarHeaderComun() {
    const usuario = obtenerUsuarioActual();
    if (!usuario) return;

    // Mostrar nombre y rol del operador (sin duplicar si el nombre incluye el rol)
    const spanUser = document.getElementById('header-user-name');
    const spanRol = document.getElementById('header-user-role');
    if (spanUser) {
        spanUser.innerText = usuario.nombre || '';
        if ((usuario.nombre || '').trim().toLowerCase().includes((usuario.rol || '').trim().toLowerCase())) {
            spanUser.style.display = 'none';
        } else {
            spanUser.style.display = '';
        }
    }
    if (spanRol) {
        spanRol.innerText = usuario.rol;
        spanRol.title = usuario.nombre || '';
        if (usuario.id_rol === 3) {
            spanRol.style.background = '#0F172A';
            spanRol.style.border = '1px solid #F59E0B';
            spanRol.style.color = '#F59E0B';
        } else if (usuario.id_rol === 1) {
            spanRol.style.background = '#EA580C';
            spanRol.style.color = '#FFFFFF';
        } else {
            spanRol.style.background = '#16A34A';
            spanRol.style.color = '#FFFFFF';
        }
    }

    // Ocultar opciones reservadas para Administrador o Gerente si el usuario es Cajero u operativo
    if (usuario.id_rol !== 1 && usuario.id_rol !== 3) {
        document.querySelectorAll('.admin-only').forEach(el => {
            el.style.display = 'none';
        });
    }

    // Consultas periódicas de estado general (alertas de stock y delivery)
    consultarAlertasStockHeader();
    actualizarConteoDeliveryHeader();
    if (!window._timerConteoDelivery) {
        // Polling cada 25 segundos para mantener actualizado el conteo de delivery
        window._timerConteoDelivery = setInterval(actualizarConteoDeliveryHeader, 25000);
    }
}

/**
 * Consulta la cantidad de pedidos de delivery activos en cocina y en camino.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite que el cajero en la pantalla de POS sepa en todo momento cuántos pedidos
 * están pendientes o en ruta sin tener que cambiar de pantalla a delivery.html.
 */
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
        console.warn('Error al verificar conteo delivery en cabecera:', e);
    }
}

/**
 * Consulta insumos con existencias por debajo del mínimo reglamentario.
 * 
 * ¿POR QUÉ SE PUSO?
 * El restaurante maneja recetas basadas en insumos (pan, pollo, salsas, etc.).
 * Si un insumo se agota, el sistema avisa visualmente en la cabecera para que
 * el personal realice compras antes de que se afecte el servicio.
 */
async function consultarAlertasStockHeader() {
    try {
        const res = await fetch('/api/alertas-stock');
        const data = await res.json();
        const btnAlert = document.getElementById('btn-header-alert');
        if (btnAlert) {
            if (data && data.length > 0) {
                btnAlert.style.display = 'inline-flex';
                btnAlert.innerHTML = `Insumos (${data.length})`;
                btnAlert.onclick = () => {
                    window.location.href = 'inventario.html';
                };
            } else {
                btnAlert.style.display = 'none';
            }
        }
    } catch (e) {
        console.warn('Error al verificar alertas de stock en cabecera:', e);
    }
}


// =============================================================================
// SECCIÓN 2: UTILIDADES GENERALES (MONEDA, TOASTS Y AUDIO SINTETIZADO)
// =============================================================================

/**
 * Formatea un valor numérico a la moneda nacional de Nicaragua (Córdobas - C$).
 * 
 * ¿POR QUÉ SE PUSO?
 * Estandariza la presentación financiera en toda la aplicación con 2 decimales
 * y el prefijo oficial 'C$', evitando inconsistencias visuales en precios y totales.
 * 
 * @param {number|string} valor - Cantidad numérica a formatear.
 * @returns {string} Texto formateado (ej. "C$ 150.00").
 */
function formatoMoneda(valor) {
    const num = parseFloat(valor) || 0;
    return `C$ ${num.toFixed(2)}`;
}

/**
 * Muestra notificaciones flotantes temporales (Toast notifications) en pantalla.
 * 
 * ¿POR QUÉ SE PUSO?
 * Reemplaza los molestos `alert()` nativos del navegador por mensajes visuales
 * modernos que no bloquean la pantalla táctil del cajero, mejorando la agilidad en caja.
 * 
 * @param {string} mensaje - Texto a mostrar.
 * @param {string} tipo - 'success' (verde), 'danger' (rojo), 'warning' (naranja), 'info' (azul).
 */
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

    // Asignación de colores semánticos según el tipo de mensaje
    if (tipo === 'success') toast.style.background = '#16A34A';
    else if (tipo === 'danger') toast.style.background = '#DC2626';
    else if (tipo === 'warning') toast.style.background = '#D97706';
    else toast.style.background = '#0F172A';

    container.appendChild(toast);

    // Animación de salida y auto-eliminación tras 3.5 segundos
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

/**
 * Sintetizador acústico táctil usando Web Audio API nativa.
 * 
 * ¿POR QUÉ SE PUSO?
 * En un entorno con ruido de cocina y mostrador rápido, el cajero necesita
 * confirmación auditiva inmediata al tocar la pantalla táctil para saber si el platillo
 * se agregó a la orden o si la venta finalizó. Al generarse directamente con
 * osciladores matemáticos de la Web Audio API:
 * - NO requiere archivos de audio .mp3/.wav externos (cero latencia y 100% offline).
 * - No consume ancho de banda ni falla por rutas rotas.
 * 
 * @param {string} tipo - 'pop' (agregar ítem), 'success' (venta exitosa), 'click' (toque genérico).
 */
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
            // Tono corto ascendente tipo burbuja (520Hz -> 840Hz)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(520, now);
            osc.frequency.exponentialRampToValueAtTime(840, now + 0.06);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
            osc.start(now);
            osc.stop(now + 0.08);
        } else if (tipo === 'success') {
            // Acorde triunfal ascendente de 3 notas (A4 440Hz -> C#5 554Hz -> E5 659Hz)
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(440, now);
            osc.frequency.setValueAtTime(554.37, now + 0.08);
            osc.frequency.setValueAtTime(659.25, now + 0.16);
            gain.gain.setValueAtTime(0.15, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc.start(now);
            osc.stop(now + 0.35);
        } else if (tipo === 'click') {
            // Tono sutil de pulsación táctil (300Hz)
            osc.type = 'sine';
            osc.frequency.setValueAtTime(300, now);
            gain.gain.setValueAtTime(0.08, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);
            osc.start(now);
            osc.stop(now + 0.04);
        }
    } catch (e) {
        // Silencioso si la directiva de medios del navegador bloquea el audio previo al primer gesto
    }
}

/**
 * Micro-interacción: Animación de ítem volando desde la tarjeta hacia la comanda.
 * 
 * ¿POR QUÉ SE PUSO?
 * Brinda una respuesta visual intuitiva que guía el ojo del cajero desde el catálogo
 * hacia la tabla de la comanda en la derecha, confirmando que el platillo fue recibido
 * correctamente sin necesidad de desviar la mirada.
 * 
 * @param {HTMLElement} card - Elemento DOM de la tarjeta presionada.
 */
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
        // Silencioso en caso de navegadores antiguos sin soporte de getBoundingClientRect
    }
}


// =============================================================================
// SECCIÓN 3: ESTADO GLOBAL DEL POS Y CONTROL DE CAJA CHICA
// =============================================================================

// Variables de estado en memoria para el Punto de Venta
let catalogoProductos = [];          // Lista completa de platillos y combos activos
let comandaCarrito = [];             // Lista de ítems en la comanda actual del cliente
let cajaActivaActual = null;         // Datos de la sesión de caja abierta (id_caja, fondo inicial, etc.)
let metodoPagoSeleccionado = 1;       // 1: Efectivo (por defecto), 2: Transferencia bancaria
let bancoSeleccionado = 'BAC';       // Banco seleccionado en transferencias (BAC, Banpro, Lafise, etc.)
let tipoServicioActual = 'LOCAL';    // Modalidad de servicio: 'LOCAL', 'LLEVAR' o 'DELIVERY'
let repartidoresPOS = [];            // Repartidores disponibles para pedidos de entrega a domicilio
let clientesRegistradosPOS = [];     // Catálogo de clientes registrados (frecuentes / consumidor final)
let ultimaVentaProcesada = null;     // Última venta confirmada para reimpresión inmediata de tickets

/**
 * Función principal de arranque del módulo POS.
 * 
 * ¿POR QUÉ SE PUSO?
 * Coordina la secuencia obligatoria de inicialización:
 * 1. Verifica autenticación del usuario.
 * 2. Carga datos de la barra superior.
 * 3. Valida si la caja chica está abierta (requisito indispensable para facturar).
 * 4. Descarga el catálogo de platillos, clientes y repartidores en paralelo.
 */
async function inicializarPOS() {
    const usuario = verificarAutenticacion(false);
    if (!usuario) return;
    inicializarHeaderComun();

    // Botón para crear platillo rápido (visible solo para Administrador)
    const btnNuevoPlatillo = document.getElementById('btn-admin-nuevo-platillo');
    if (btnNuevoPlatillo) {
        btnNuevoPlatillo.style.display = (usuario && (usuario.id_rol === 1 || usuario.id_rol === 3)) ? 'inline-flex' : 'none';
    }

    await verificarCajaChicaActiva();
    await cargarCatalogoPOS();
    await cargarClientesPOS();
    await cargarRepartidoresPOS();
    await cargarBannerPromocionesPOS();
}

async function cargarBannerPromocionesPOS() {
    const banner = document.getElementById('banner-promociones-pos');
    if (!banner) return;
    try {
        const res = await fetch('/api/promociones?activas=1');
        const promos = await res.json();
        if (Array.isArray(promos) && promos.length > 0) {
            promocionesActivasPOS = promos;
            let pillsHtml = promos.map(p => {
                const val = p.tipo === 'PORCENTAJE' ? `${p.valor}% OFF` : (p.tipo === 'MONTO_FIJO' ? `C$ ${p.valor} OFF` : '2x1');
                return `<button type="button" class="promo-item-pill" onclick="aplicarPromocionDesdeBanner(${p.id_promocion})" title="Haga clic para aplicar esta promoción a la comanda actual">
                    <strong>${p.codigo}</strong>: ${p.nombre} (${val})
                </button>`;
            }).join('');
            banner.innerHTML = `<span class="banner-label">Promociones Activas:</span><div class="promo-chips-list">${pillsHtml}</div>`;
            banner.style.display = 'flex';
        } else {
            banner.style.display = 'none';
        }
    } catch (e) {
        banner.style.display = 'none';
    }
}

function aplicarPromocionDesdeBanner(idPromocion) {
    if (!comandaCarrito || comandaCarrito.length === 0) {
        mostrarToast('Agregue primero productos a la comanda antes de aplicar la promoción seleccionada.', 'warning');
        return;
    }
    const promo = promocionesActivasPOS.find(p => p.id_promocion === parseInt(idPromocion));
    if (!promo) {
        mostrarToast('No se encontró la promoción seleccionada.', 'danger');
        return;
    }
    seleccionarPromocionPOS(promo);
}
window.aplicarPromocionDesdeBanner = aplicarPromocionDesdeBanner;


/**
 * Consulta al servidor si existe un turno de caja chica abierto actualmente.
 * 
 * ¿POR QUÉ SE PUSO?
 * Cumple con la regla de negocio de control fiscal y arqueo de caja (Módulo 3):
 * Ningún cajero puede procesar ventas si no ha declarado el fondo inicial de cambio.
 * Si la caja está cerrada, se abre automáticamente el modal de apertura.
 */
async function verificarCajaChicaActiva() {
    try {
        const res = await fetch('/api/caja/activa?auto=1');
        const data = await res.json();

        const badgeCaja = document.getElementById('pos-shift-badge');
        if (badgeCaja) {
            badgeCaja.style.display = 'none';
        }

        if (data.abierta && data.caja) {
            cajaActivaActual = data.caja;
        } else {
            cajaActivaActual = { id_caja: null, monto_inicial: 1000 };
        }
    } catch (e) {
        console.error('Error al consultar caja activa:', e);
    }
}

/**
 * Abre la ventana modal para declarar el monto inicial de apertura de caja.
 * 
 * ¿POR QUÉ SE PUSO?
 * Exige al cajero ingresar el conteo físico de monedas y billetes antes de operar.
 */
function abrirModalAperturaCaja() {
    const modal = document.getElementById('modal-apertura-caja');
    if (modal) modal.classList.add('open');
}

/**
 * Envía la apertura de caja chica al servidor con el monto inicial ingresado.
 * 
 * ¿POR QUÉ SE PUSO?
 * Registra el movimiento en la base de datos SQLite y asocia las ventas subsecuentes
 * al id_caja creado, permitiendo un cuadre perfecto en el corte Z.
 * 
 * @param {Event} e - Evento submit del formulario.
 */
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


// =============================================================================
// SECCIÓN 4: CATÁLOGO DE PLATILLOS, BÚSQUEDA Y FILTRADO POR CATEGORÍAS
// =============================================================================

/**
 * Carga la lista de platillos y combos desde la API y los renderiza en la grilla.
 * 
 * ¿POR QUÉ SE PUSO?
 * Mantiene el catálogo en memoria para permitir búsquedas instantáneas y filtrados
 * sin latencia cada vez que el cajero toca una categoría o escribe en el buscador.
 */
async function cargarCatalogoPOS() {
    try {
        const res = await fetch('/api/productos');
        catalogoProductos = await res.json();
        renderizarCatalogo(catalogoProductos);
    } catch (e) {
        console.error('Error cargando catálogo:', e);
    }
}

/**
 * Determina la imagen gastronómica correspondiente a un platillo.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite que los platillos tengan una presentación visual atractiva basada en su
 * categoría gastronómica (hamburguesas, alitas, combos, etc.) incluso si el usuario
 * no ha cargado una foto específica, manteniendo la interfaz profesional.
 * 
 * @param {Object} p - Objeto platillo.
 * @returns {string} Ruta de la imagen local.
 */
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

/**
 * Renderiza las tarjetas de platillos en la grilla visual del POS.
 * 
 * ¿POR QUÉ SE PUSO?
 * Construye dinámicamente el HTML de cada tarjeta con:
 * - Badge de "COMBO" si es un paquete promocional.
 * - Contador de cantidad actual en orden (para saber cuántas veces se ha añadido).
 * - Botón "Editar" (exclusivo para el Administrador para ajustar precios al vuelo).
 * - Título, descripción y precio oficial en Córdobas.
 * 
 * @param {Array} productos - Lista de platillos a mostrar.
 */
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
    const esAdmin = usuarioActual && (usuarioActual.id_rol === 1 || usuarioActual.id_rol === 3);

    productos.forEach(p => {
        const bloqueadoStock = !!p.bloqueado_por_stock;
        const card = document.createElement('div');
        card.className = `product-card ${p.es_combo ? 'is-combo' : ''} ${bloqueadoStock ? 'sin-stock-bom' : ''}`;
        card.setAttribute('data-id', p.id_producto);
        if (bloqueadoStock) {
            card.style.borderColor = '#FCA5A5';
            card.style.background = '#FFF5F5';
        }
        card.onclick = () => agregarAlCarrito(p, card);

        const itemEnCarrito = comandaCarrito.find(c => c.id_producto === p.id_producto);
        const qtyEnCarrito = itemEnCarrito ? itemEnCarrito.cantidad : 0;

        const badgeStockHtml = bloqueadoStock
            ? `<span style="background:#DC2626; color:#FFFFFF; font-size:0.64rem; font-weight:800; padding:2px 6px; border-radius:4px; text-transform:uppercase; letter-spacing:0.2px;" title="Insumos con poco producto. Requiere reabastecer en Inventario.">Reabastecer Insumos</span>`
            : '';

        card.innerHTML = `
            <div class="product-card-top-bar">
                <div class="product-tags-wrap">
                    ${p.es_combo ? '<span class="product-badge-combo">COMBO</span>' : ''}
                    ${badgeStockHtml}
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
                <span class="add-btn" style="${bloqueadoStock ? 'background:#DC2626; color:#FFFFFF; border-color:#DC2626;' : ''}" title="${bloqueadoStock ? 'Requiere reabastecer insumos' : 'Agregar a comanda'}">${bloqueadoStock ? '!' : '+'}</span>
            </div>
        `;
        grid.appendChild(card);
    });

    actualizarContadoresCategorias();
}

/**
 * Actualiza los badges de "X en orden" en las tarjetas del catálogo.
 * 
 * ¿POR QUÉ SE PUSO?
 * Sincroniza la vista de las tarjetas con el estado real de la comanda para que
 * el cajero sepa de un vistazo qué platillos ya fueron agregados.
 */
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

/**
 * Cuenta cuántos platillos pertenecen a cada categoría y lo muestra en los botones.
 * 
 * ¿POR QUÉ SE PUSO?
 * Informa al personal la cantidad exacta de productos disponibles en cada sección
 * (Hamburguesas, Alitas, Bebidas, etc.) para mayor comodidad visual.
 */
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

/**
 * Filtra los platillos mostrados por su categoría gastronómica o término de búsqueda.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite encontrar rápidamente un platillo entre docenas de opciones mediante un solo toque,
 * acelerando la atención en horas pico.
 * 
 * @param {string|number} idCategoria - ID de la categoría o 'todos'.
 * @param {HTMLElement} btn - Botón presionado para marcar la clase activa.
 * @param {boolean} esDeBuscador - Indica si la llamada provino del input de texto.
 */
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

    // Reiniciar scroll vertical del catálogo hacia arriba para ver los primeros resultados
    const gridWrap = document.querySelector('.product-grid-wrap');
    if (gridWrap) gridWrap.scrollTop = 0;
}

/**
 * Ejecuta el filtrado en tiempo real mientras el operador escribe en el buscador.
 * 
 * ¿POR QUÉ SE PUSO?
 * Facilita encontrar platillos específicos por nombre o ingredientes sin importar
 * en qué categoría se encuentre el cajero.
 */
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

/**
 * Limpia el texto del buscador de platillos y restaura la vista general.
 * 
 * ¿POR QUÉ SE PUSO?
 * Proporciona un botón rápido con icono "X" para borrar el texto con un solo toque táctil.
 * 
 * @param {boolean} filtrar - Si es true, re-ejecuta el filtro sobre la categoría activa.
 */
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


// =============================================================================
// SECCIÓN 5: MODALIDAD DE SERVICIO, CLIENTES Y DESPACHO DIRECTO A DELIVERY
// =============================================================================

/**
 * Cambia la modalidad de entrega del pedido: LOCAL, LLEVAR o DELIVERY.
 * 
 * ¿POR QUÉ SE PUSO?
 * Adapta dinámicamente la comanda:
 * - Si es DELIVERY, muestra los campos de costo de envío, dirección y repartidor,
 *   y suma el costo del flete al total general.
 * - Si es LOCAL o LLEVAR, oculta dichos campos y recalcula el total sin flete.
 * 
 * @param {string} tipo - 'LOCAL', 'LLEVAR' o 'DELIVERY'.
 * @param {HTMLElement} btn - Botón presionado para marcar la clase 'active'.
 */
function cambiarTipoServicio(tipo, btn) {
    const usuario = obtenerUsuarioActual();
    const idRol = usuario ? parseInt(usuario.id_rol, 10) : 2;
    if (tipo === 'DELIVERY' && idRol !== 1 && idRol !== 3) {
        mostrarToast('El perfil de Cajero solo está autorizado para facturar en modalidad Local y Para Llevar.', 'warning');
        return;
    }

    tipoServicioActual = tipo;
    document.querySelectorAll('.type-btn').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

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

/**
 * Carga el catálogo de clientes registrados desde el backend.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite seleccionar clientes frecuentes para autocompletar su teléfono,
 * categoría (ej. VIP, Frecuente, Regular) y dirección en Sierra Maestra.
 */
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

/**
 * Carga la lista de repartidores activos para asignación de pedidos a domicilio.
 * 
 * ¿POR QUÉ SE PUSO?
 * Facilita asignar de inmediato al motorizado responsable desde la comanda del POS.
 */
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

/**
 * Evento disparado al seleccionar un cliente en el dropdown del POS.
 * 
 * ¿POR QUÉ SE PUSO?
 * Si el cliente tiene una dirección registrada en su ficha y la modalidad es DELIVERY,
 * rellena automáticamente el campo de dirección para ahorrar tiempo al cajero.
 */
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

/**
 * Despacha directamente la orden actual al tablero de Delivery para cobro contra entrega.
 * 
 * ¿POR QUÉ SE PUSO?
 * Elimina el retrabajo operativo: si un cliente llama por teléfono para un pedido
 * a domicilio que se cobrará contra entrega, el cajero puede armar la comanda en el POS
 * y enviarla directamente al tablero Kanban de cocina y motorizados sin cobrarla aún,
 * colocándola en estado PENDIENTE.
 */
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


// =============================================================================
// SECCIÓN 6: GESTIÓN DE LA COMANDA / CARRITO DE COMPRAS Y TOTALES REACTIVOS
// =============================================================================

/**
 * Agrega un platillo o combo a la comanda activa.
 * 
 * ¿POR QUÉ SE PUSO?
 * Maneja la lógica de incremento en memoria: si el ítem ya existe en la comanda,
 * simplemente incrementa su cantidad; si no, lo inserta con cantidad 1.
 * Dispara el sonido 'pop' y la micro-interacción visual para confirmación táctil.
 * 
 * @param {Object} producto - Datos del platillo (id_producto, nombre, precio).
 * @param {HTMLElement|null} elCard - Elemento DOM de la tarjeta presionada (opcional).
 */
/**
 * Muestra un modal de alerta de reabastecimiento cuando un platillo no puede seguir vendiéndose
 * porque uno o más de sus insumos en receta (BOM) tienen poco producto o están agotados.
 */
function mostrarModalAlertaReabastecimiento(producto, insumosFaltantes = []) {
    let modal = document.getElementById('modal-alerta-reabastecimiento-bom');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-alerta-reabastecimiento-bom';
        modal.className = 'modal-backdrop';
        modal.style.cssText = 'position:fixed; inset:0; background:rgba(15,23,42,0.75); display:none; align-items:center; justify-content:center; z-index:99999; backdrop-filter:blur(3px);';
        document.body.appendChild(modal);
    }

    const usuario = obtenerUsuarioActual();
    const puedeReabastecer = usuario && (usuario.id_rol === 1 || usuario.id_rol === 3);
    const nombreProd = (producto && producto.nombre) ? producto.nombre : 'este artículo del menú';

    let filasHtml = '';
    (insumosFaltantes || []).forEach(ins => {
        const stockAct = parseFloat(ins.stock_actual ?? 0);
        const stockMin = parseFloat(ins.stock_minimo ?? 0);
        const cantReq = parseFloat(ins.cantidad_requerida ?? ins.requerido ?? 1);
        const unidad = ins.unidad_medida || 'und';
        const estadoTxt = stockAct <= 0 ? 'AGOTADO (0)' : 'POCO PRODUCTO / REABASTECER';

        filasHtml += `
            <tr style="border-bottom:1px solid #FEE2E2;">
                <td style="padding:9px 8px; font-weight:800; color:#7F1D1D;">${ins.nombre}</td>
                <td style="padding:9px 8px; text-align:center; font-weight:800; color:#DC2626;">${stockAct} ${unidad}</td>
                <td style="padding:9px 8px; text-align:center; color:#64748B;">${stockMin} ${unidad}</td>
                <td style="padding:9px 8px; text-align:center; font-weight:700; color:#9A3412;">${cantReq} ${unidad}</td>
                <td style="padding:9px 8px; text-align:center;">
                    <span style="background:#DC2626; color:#FFFFFF; font-size:0.7rem; font-weight:800; padding:2px 8px; border-radius:4px;">${estadoTxt}</span>
                </td>
            </tr>
        `;
    });

    modal.innerHTML = `
        <div style="background:#FFFFFF; border-radius:12px; width:95%; max-width:600px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.35); overflow:hidden; border-top:5px solid #DC2626; font-family:Inter,system-ui,sans-serif;">
            <div style="background:#FEF2F2; padding:16px 20px; border-bottom:1px solid #FECACA; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <h3 style="margin:0; font-size:1.08rem; font-weight:800; color:#991B1B;">
                        Alerta de Reabastecimiento: Venta Bloqueada por Stock de Insumos
                    </h3>
                    <p style="margin:3px 0 0 0; font-size:0.82rem; color:#B91C1C; font-weight:600;">
                        Hay poco producto en inventario para seguir vendiendo este artículo del menú.
                    </p>
                </div>
                <button type="button" onclick="document.getElementById('modal-alerta-reabastecimiento-bom').style.display='none'" style="background:none; border:none; font-size:1.5rem; color:#991B1B; cursor:pointer; line-height:1;">&times;</button>
            </div>
            <div style="padding:18px 20px;">
                <div style="background:#FFF7ED; border:1px solid #FDBA74; border-radius:8px; padding:12px 14px; margin-bottom:14px; font-size:0.88rem; color:#7C2D12; line-height:1.45;">
                    No se puede seguir vendiendo <strong>"${nombreProd}"</strong> porque sus insumos alcanzaron el nivel crítico o están agotados. <strong>Se tiene que reabastecer en Inventario</strong> antes de continuar facturando este platillo.
                </div>
                ${filasHtml ? `
                <div style="max-height:220px; overflow-y:auto; border:1px solid #FECACA; border-radius:8px;">
                    <table style="width:100%; border-collapse:collapse; font-size:0.82rem;">
                        <thead>
                            <tr style="background:#FEE2E2; color:#991B1B; text-align:left;">
                                <th style="padding:8px;">Insumo Requerido</th>
                                <th style="padding:8px; text-align:center;">Stock Actual</th>
                                <th style="padding:8px; text-align:center;">Mínimo Seguridad</th>
                                <th style="padding:8px; text-align:center;">Requerido</th>
                                <th style="padding:8px; text-align:center;">Estado</th>
                            </tr>
                        </thead>
                        <tbody>${filasHtml}</tbody>
                    </table>
                </div>` : ''}
            </div>
            <div style="background:#F8FAFC; padding:12px 20px; border-top:1px solid #E2E8F0; display:flex; justify-content:flex-end; gap:10px;">
                <button type="button" onclick="document.getElementById('modal-alerta-reabastecimiento-bom').style.display='none'" style="background:#64748B; color:#FFFFFF; border:none; border-radius:6px; padding:8px 16px; font-weight:700; cursor:pointer; font-size:0.85rem;">
                    Entendido
                </button>
                ${puedeReabastecer ? `
                <button type="button" onclick="window.location.href='inventario.html'" style="background:#EA580C; color:#FFFFFF; border:none; border-radius:6px; padding:8px 16px; font-weight:800; cursor:pointer; font-size:0.85rem;">
                    Ir a Inventario a Reabastecer
                </button>` : ''}
            </div>
        </div>
    `;

    modal.style.display = 'flex';
}
window.mostrarModalAlertaReabastecimiento = mostrarModalAlertaReabastecimiento;

/**
 * Valida si hay suficientes insumos BOM para agregar `deltaCantidad` unidades de un platillo,
 * considerando lo que ya está agregado en `comandaCarrito`.
 */
function validarDisponibilidadStockParaPlatillo(productoBase, deltaCantidad = 1) {
    const prodCatalogo = (catalogoProductos || []).find(p => p.id_producto === productoBase.id_producto) || productoBase;
    const receta = prodCatalogo.insumos_receta || [];
    if (!receta || receta.length === 0) {
        return true;
    }

    // Calcular cuánto de cada insumo ya está comprometido en comandaCarrito
    const consumoActualCarrito = {};
    (comandaCarrito || []).forEach(item => {
        const prodItem = (catalogoProductos || []).find(p => p.id_producto === item.id_producto);
        const recItem = (prodItem && prodItem.insumos_receta) ? prodItem.insumos_receta : [];
        recItem.forEach(ing => {
            consumoActualCarrito[ing.id_insumo] = (consumoActualCarrito[ing.id_insumo] || 0) + (parseFloat(ing.cantidad_requerida || 0) * parseInt(item.cantidad || 1, 10));
        });
    });

    const faltantes = [];
    receta.forEach(ing => {
        const yaUsado = consumoActualCarrito[ing.id_insumo] || 0;
        const nuevoConsumoTotal = yaUsado + (parseFloat(ing.cantidad_requerida || 0) * deltaCantidad);
        const stockActual = parseFloat(ing.stock_actual || 0);
        const stockMinimo = parseFloat(ing.stock_minimo || 0);
        const stockRestante = stockActual - nuevoConsumoTotal;

        if (stockActual <= 0 || stockActual <= stockMinimo || stockRestante < 0) {
            faltantes.push({
                ...ing,
                cantidad_requerida: parseFloat(nuevoConsumoTotal.toFixed(2))
            });
        }
    });

    if (faltantes.length > 0) {
        mostrarModalAlertaReabastecimiento(prodCatalogo, faltantes);
        return false;
    }

    return true;
}
window.validarDisponibilidadStockParaPlatillo = validarDisponibilidadStockParaPlatillo;

function agregarAlCarrito(producto, elCard = null) {
    if (!validarDisponibilidadStockParaPlatillo(producto, 1)) {
        return;
    }

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

    // Feedback visual con rebote sutil en el total financiero
    const totalElem = document.getElementById('val-total');
    if (totalElem) {
        totalElem.classList.remove('cart-bounce-feedback');
        void totalElem.offsetWidth; // Forzar reflow para reiniciar la animación CSS
        totalElem.classList.add('cart-bounce-feedback');
    }

    actualizarCarritoUI();
}

/**
 * Modifica la cantidad de un platillo existente en la comanda (+1 o -1).
 * 
 * @param {number} index - Posición del platillo en el arreglo comandaCarrito.
 * @param {number} delta - Variación numérica (+1 o -1).
 */
function modificarCantidad(index, delta) {
    const item = comandaCarrito[index];
    if (!item) return;
    if (delta > 0 && !validarDisponibilidadStockParaPlatillo(item, delta)) {
        return;
    }
    comandaCarrito[index].cantidad += delta;
    if (comandaCarrito[index].cantidad <= 0) {
        comandaCarrito.splice(index, 1);
    }
    actualizarCarritoUI();
}

/**
 * Elimina completamente una línea de platillo de la comanda.
 * 
 * ¿POR QUÉ SE PUSO?
 * Proporciona un botón rápido con icono "X" para anular un ítem agregado por error.
 * 
 * @param {number} index - Posición del platillo en el arreglo comandaCarrito.
 */
function eliminarDelCarrito(index) {
    comandaCarrito.splice(index, 1);
    actualizarCarritoUI();
}

/**
 * Limpia todos los platillos de la comanda actual.
 * 
 * ¿POR QUÉ SE PUSO?
 * Se utiliza al cancelar una orden o tras procesar exitosamente una venta.
 */
let descuentoAplicado = {
    id_promocion: null,
    nombre: '',
    tipo: null, // 'PORCENTAJE', 'MONTO_FIJO', '2X1'
    valor: 0,
    monto_calculado: 0,
    motivo: '',
    autorizado_por: null
};

/**
 * Limpia todos los platillos de la comanda actual y resetea promociones aplicadas.
 * 
 * ¿POR QUÉ SE PUSO?
 * Se utiliza al cancelar una orden o tras procesar exitosamente una venta.
 */
function vaciarCarrito() {
    comandaCarrito = [];
    const badgeWa = document.getElementById('badge-origen-whatsapp-pos');
    if (badgeWa) badgeWa.style.display = 'none';
    removerDescuentoAplicado();
}

/**
 * Actualiza completamente la interfaz gráfica de la comanda y recalcula totales.
 * 
 * ¿POR QUÉ SE PUSO?
 * Es el motor reactivo del POS:
 * 1. Genera la tabla HTML con cada ítem, precio unitario, botones de cantidad y subtotal.
 * 2. Muestra un placeholder gráfico si la comanda está vacía.
 * 3. Suma el subtotal de productos + costo de delivery (si aplica).
 * 4. Calcula y aplica descuentos o promociones activas (con validación de Gerente General).
 * 5. Actualiza los valores en pantalla de Subtotal, Descuento, Envío y Total a pagar.
 * 6. Dispara el recálculo en vivo del vuelto en efectivo.
 */
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

    // Costo de envío adicional si la orden es modalidad DELIVERY
    let costoEnvio = 0;
    if (tipoServicioActual === 'DELIVERY') {
        const txtEnvio = document.getElementById('txt-pos-costo-delivery');
        costoEnvio = parseFloat(txtEnvio ? txtEnvio.value : 0) || 0;
    }

    // Cálculo y Deducción de Promoción / Descuento
    let montoDescuento = 0;
    if (subtotal > 0 && descuentoAplicado.tipo) {
        if (descuentoAplicado.tipo === 'PORCENTAJE') {
            montoDescuento = subtotal * (descuentoAplicado.valor / 100);
        } else if (descuentoAplicado.tipo === 'MONTO_FIJO') {
            montoDescuento = descuentoAplicado.valor;
        } else if (descuentoAplicado.tipo === 'BONO_ENVIO') {
            montoDescuento = costoEnvio > 0 ? Math.min(costoEnvio, descuentoAplicado.valor) : descuentoAplicado.valor;
        } else if (descuentoAplicado.tipo === '2X1') {
            // Descuenta el ítem de menor valor si hay más de 1 platillo
            if (comandaCarrito.length >= 2) {
                const precios = comandaCarrito.map(i => i.precio);
                montoDescuento = Math.min(...precios);
            } else if (comandaCarrito.length === 1 && comandaCarrito[0].cantidad >= 2) {
                montoDescuento = comandaCarrito[0].precio;
            }
        }
    }
    if (montoDescuento > (subtotal + costoEnvio)) montoDescuento = subtotal + costoEnvio;
    descuentoAplicado.monto_calculado = parseFloat(montoDescuento.toFixed(2));

    const elemValDesc = document.getElementById('val-descuento');
    const elemBtnQuitar = document.getElementById('btn-quitar-descuento');
    const elemBadgePromo = document.getElementById('badge-promo-activa');
    const elemTxtPromo = document.getElementById('txt-promo-activa-nombre');

    if (descuentoAplicado.monto_calculado > 0) {
        if (elemValDesc) elemValDesc.innerText = `- ${formatoMoneda(descuentoAplicado.monto_calculado)}`;
        if (elemBtnQuitar) elemBtnQuitar.style.display = 'inline-block';
        if (elemBadgePromo) {
            elemBadgePromo.style.display = 'block';
            if (elemTxtPromo) elemTxtPromo.innerText = `${descuentoAplicado.nombre || 'Descuento'}${descuentoAplicado.autorizado_por ? ' (Aut: ' + descuentoAplicado.autorizado_por + ')' : ''}`;
        }
    } else {
        if (elemValDesc) elemValDesc.innerText = '- C$ 0.00';
        if (elemBtnQuitar) elemBtnQuitar.style.display = 'none';
        if (elemBadgePromo) elemBadgePromo.style.display = 'none';
    }

    const total = parseFloat(Math.max(0, subtotal - descuentoAplicado.monto_calculado + costoEnvio).toFixed(2));

    document.getElementById('val-subtotal').innerText = formatoMoneda(subtotal);
    const elemEnvio = document.getElementById('val-envio');
    if (elemEnvio) elemEnvio.innerText = formatoMoneda(costoEnvio);
    const elemImp = document.getElementById('val-impuesto');
    if (elemImp) elemImp.innerText = formatoMoneda(0);
    document.getElementById('val-total').innerText = formatoMoneda(total);

    actualizarBadgesComandaEnTarjetas();
    calcularVueltoEnVivo();
}


// =============================================================================
// SECCIÓN 7: MÉTODOS DE PAGO (EFECTIVO Y TRANSFERENCIAS BANCARIAS)
// =============================================================================

/**
 * Alterna la interfaz de cobro entre Efectivo (1) y Transferencia Bancaria (2).
 * 
 * ¿POR QUÉ SE PUSO?
 * Adapta los campos de entrada según la forma de pago:
 * - Si es Efectivo: Muestra atajos de billetes (C$ 50, C$ 100, C$ 500, etc.) y cálculo de vuelto.
 * - Si es Transferencia: Muestra los botones de bancos nicaragüenses (BAC, Banpro, Lafise, BDF, Ficohsa)
 *   y exige el número de confirmación / referencia de la transferencia.
 * 
 * @param {number} metodo - 1 para Efectivo, 2 para Transferencia.
 */
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

/**
 * Selecciona el banco emisor de la transferencia bancaria.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite al cajero registrar exactamente a qué cuenta bancaria ingresó el dinero
 * para facilitar la conciliación bancaria diaria con los estados de cuenta.
 * 
 * @param {string} banco - Nombre del banco ('BAC', 'Banpro', 'Lafise', 'BDF', 'Ficohsa').
 * @param {HTMLElement} elem - Botón presionado.
 */
function seleccionarBanco(banco, elem) {
    bancoSeleccionado = banco;
    document.querySelectorAll('.bank-card-btn').forEach(el => el.classList.remove('active'));
    elem.classList.add('active');
}

/**
 * Calcula en tiempo real el vuelto o cambio a entregar al cliente en efectivo.
 * 
 * ¿POR QUÉ SE PUSO?
 * Evita errores humanos de cálculo mental en el mostrador. Si el monto recibido
 * es mayor que el total de la orden, calcula la diferencia exacta y resalta
 * visualmente la caja de vuelto en color verde brillante.
 */
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

/**
 * Atajo rápido para rellenar el campo de monto recibido con billetes comunes o importe exacto.
 * 
 * ¿POR QUÉ SE PUSO?
 * En pantallas táctiles, escribir con el teclado numérico quita tiempo. Los botones
 * de denominaciones comunes en Nicaragua (C$ 50, C$ 100, C$ 200, C$ 500, C$ 1000 o "EXACTO")
 * permiten registrar el pago con un solo toque.
 * 
 * @param {number|string} monto - Cantidad o 'EXACTO'.
 */
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


// =============================================================================
// SECCIÓN 8: GESTIÓN DIRECTA DE PLATILLOS DESDE POS (SOLO ADMINISTRADOR)
// =============================================================================

let categoriasPOS = [];

/**
 * Carga las categorías existentes para asociar un platillo nuevo o editado.
 * 
 * ¿POR QUÉ SE PUSO?
 * Llena el desplegable de categorías en el modal de gestión rápida de platillos.
 */
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

/**
 * Abre el modal para agregar un nuevo platillo o combo directamente desde el POS.
 * 
 * ¿POR QUÉ SE PUSO?
 * Brinda flexibilidad al Administrador para dar de alta platillos o combos especiales
 * sin tener que salir del Punto de Venta hacia el módulo de administración.
 */
async function abrirModalPlatilloPOS() {
    const usuario = obtenerUsuarioActual();
    if (!usuario || (usuario.id_rol !== 1 && usuario.id_rol !== 3)) {
        alert('Acceso Denegado: Solo el Administrador y Gerente General pueden crear o modificar platillos.');
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

/**
 * Abre el modal con los datos de un platillo existente para modificar su precio o nombre.
 * 
 * ¿POR QUÉ SE PUSO?
 * Permite corregir precios de venta o descripciones en el momento sin detener la operación.
 * 
 * @param {Event} event - Evento click del botón para evitar propagación hacia la tarjeta.
 * @param {number} id - ID del platillo a editar.
 */
async function abrirModalEditarPlatilloPOS(event, id) {
    if (event) event.stopPropagation();

    const usuario = obtenerUsuarioActual();
    if (!usuario || (usuario.id_rol !== 1 && usuario.id_rol !== 3)) {
        alert('Acceso Denegado: Solo el Administrador y Gerente General pueden modificar platillos.');
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
    document.getElementById('btn-pos-eliminar-prod').style.display = (usuario && usuario.id_rol === 3) ? 'inline-block' : 'none';
    document.getElementById('modal-platillo-pos').classList.add('open');
}

/**
 * Cierra la ventana modal de edición/creación de platillos.
 */
function cerrarModalPlatilloPOS() {
    const modal = document.getElementById('modal-platillo-pos');
    if (modal) modal.classList.remove('open');
}

/**
 * Guarda los cambios de un platillo (nuevo o modificado) enviándolo a la API.
 * 
 * @param {Event} e - Evento submit del formulario.
 */
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

/**
 * Elimina o desactiva un platillo del menú de ventas (Exclusivo Administrador).
 */
async function eliminarPlatilloDesdePOS() {
    const usuario = obtenerUsuarioActual();
    if (!usuario || usuario.id_rol !== 3) {
        alert('Acceso Denegado: El borrado de platillos y registros maestros del catálogo está reservado exclusivamente para el Gerente General (Dueño). Los Administradores y Cajeros tienen estrictamente prohibido eliminar registros.');
        return;
    }
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


// =============================================================================
// SECCIÓN 9: PROCESAMIENTO DE FACTURACIÓN Y EMISIÓN DE COMPROBANTES
// =============================================================================

/**
 * Procesa la venta actual: valida caja, comanda, pago y registra la factura en SQLite.
 * 
 * ¿POR QUÉ SE PUSO?
 * Es la función cumbre del Punto de Venta:
 * 1. Valida que haya productos en la orden.
 * 2. Verifica que haya un turno de caja abierta para registrar el dinero.
 * 3. Valida el pago (que el efectivo recibido cubra el total o que se ingrese referencia bancaria).
 * 4. Envía la transacción completa en un solo payload al servidor.
 * 5. Al confirmar el éxito:
 *    - Reproduce el sonido de victoria acústico ('success').
 *    - Descuenta insumos del inventario según las recetas BOM configuradas.
 *    - Limpia la comanda.
 *    - Abre el modal de comprobantes (factura comercial y ticket térmico ESC/POS).
 */
async function procesarFacturacion() {
    if (comandaCarrito.length === 0) {
        mostrarToast('Agregue platillos o combos a la orden antes de facturar.', 'warning');
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

    // Validación de Efectivo
    if (metodoPagoSeleccionado === 1) {
        const txtRecibido = document.getElementById('txt-monto-recibido').value;
        montoRecibido = parseFloat(txtRecibido);
        if (isNaN(montoRecibido) || montoRecibido < total) {
            alert(`El efectivo recibido (${formatoMoneda(montoRecibido || 0)}) no cubre el total (${formatoMoneda(total)}).`);
            return;
        }
    } else {
        // Validación de Transferencia Bancaria
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

    // Datos de entrega si la orden fue marcada como DELIVERY
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
        id_caja: cajaActivaActual ? cajaActivaActual.id_caja : null,
        monto_recibido: montoRecibido,
        id_cliente: idCliente,
        cliente_nombre: clienteNombre,
        telefono_cliente: clienteTelefono,
        banco: banco,
        referencia_transferencia: referencia,
        tipo_entrega: tipoServicioActual,
        costo_delivery: costoEnvio,
        descuento: descuentoAplicado.monto_calculado || 0,
        id_promocion: descuentoAplicado.id_promocion || null,
        motivo_descuento: descuentoAplicado.motivo || null,
        autorizado_por: descuentoAplicado.autorizado_por || null,
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

            // Mostrar el modal de comprobantes (Factura comercial y ticket)
            mostrarModalComprobante(data);

            // Reiniciar la comanda y los campos de pago
            vaciarCarrito();
            if (document.getElementById('txt-monto-recibido')) document.getElementById('txt-monto-recibido').value = '';
            if (document.getElementById('txt-referencia-transferencia')) document.getElementById('txt-referencia-transferencia').value = '';

            // Actualizar catálogo con nuevo stock BOM, alertas de stock y pedidos en el header
            await cargarCatalogoPOS();
            consultarAlertasStockHeader();
            actualizarConteoDeliveryHeader();
        } else {
            if (data.codigo === 'STOCK_INSUFICIENTE_REABASTECER' && typeof mostrarModalAlertaReabastecimiento === 'function') {
                mostrarModalAlertaReabastecimiento({ nombre: 'Comanda Actual' }, data.insumos_faltantes || []);
            } else {
                alert('Error al facturar: ' + data.error);
            }
        }
    } catch (e) {
        console.error(e);
        alert('Error conectando con el servidor local.');
    }
}

/**
 * Muestra el modal de comprobante de venta exitosa (Factura Comercial y Ticket Térmico).
 * 
 * @param {Object} data - Datos de la venta devueltos por el servidor.
 */
async function mostrarModalComprobante(data) {
    const modal = document.getElementById('modal-comprobante-exito');
    if (!modal) return;

    const v = data.venta;

    // 1. Datos de la Factura Comercial Formal
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
    
    // Descuento en factura si aplica
    const rowDesc = document.getElementById('fac-row-descuento');
    if (rowDesc) {
        if (v.descuento > 0) {
            rowDesc.style.display = 'flex';
            const elDesc = document.getElementById('fac-descuento');
            if (elDesc) elDesc.innerText = `- ${formatoMoneda(v.descuento)}`;
        } else {
            rowDesc.style.display = 'none';
        }
    }

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

    // 2. Ticket Térmico Portátil ESC/POS
    const elemTicket = document.getElementById('preview-ticket-escpos');
    if (elemTicket) elemTicket.innerText = data.ticket_esc_pos;

    // 3. Botón de enlace hacia el Tablero de Delivery si la venta fue registrada como DELIVERY
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

    // Por defecto, mostrar la pestaña de Factura Comercial y abrir el modal
    cambiarVistaComprobante('factura');
    modal.classList.add('open');
}

// =============================================================================
// SECCIÓN 9.1: PROMOCIONES, BONOS, DESCUENTOS Y AUTORIZACIÓN DE GERENTE
// =============================================================================

let promocionesActivasPOS = [];
let callbackAutorizacionGerente = null;

async function abrirModalAplicarPromo() {
    if (comandaCarrito.length === 0) {
        mostrarToast('Agregue platillos a la comanda antes de aplicar descuentos.', 'warning');
        return;
    }
    const modal = document.getElementById('modal-aplicar-promo');
    if (!modal) return;
    cambiarModoDescuento('catalogo');
    await cargarPromocionesPOS();
    modal.classList.add('open');
}

function cerrarModalAplicarPromo() {
    const modal = document.getElementById('modal-aplicar-promo');
    if (modal) modal.classList.remove('open');
}

function cambiarModoDescuento(modo) {
    const btnCat = document.getElementById('tab-btn-promo-catalogo');
    const btnMan = document.getElementById('tab-btn-promo-manual');
    const secCat = document.getElementById('sec-promo-catalogo');
    const secMan = document.getElementById('sec-promo-manual');
    if (modo === 'catalogo') {
        if (btnCat) btnCat.classList.add('active');
        if (btnMan) btnMan.classList.remove('active');
        if (secCat) secCat.style.display = 'block';
        if (secMan) secMan.style.display = 'none';
    } else {
        if (btnMan) btnMan.classList.add('active');
        if (btnCat) btnCat.classList.remove('active');
        if (secMan) secMan.style.display = 'block';
        if (secCat) secCat.style.display = 'none';
    }
}

function actualizarPlaceholderManual() {
    const tipo = document.getElementById('select-tipo-desc-manual').value;
    const inp = document.getElementById('txt-valor-desc-manual');
    if (inp) {
        inp.placeholder = tipo === 'PORCENTAJE' ? 'Ej: 10 (%)' : 'Ej: 50.00 (C$)';
        inp.max = tipo === 'PORCENTAJE' ? '100' : '';
    }
}

async function cargarPromocionesPOS() {
    const cont = document.getElementById('lista-promociones-activas');
    if (!cont) return;
    try {
        const res = await fetch('/api/promociones?activas=1');
        promocionesActivasPOS = await res.json();
        cont.innerHTML = '';
        if (promocionesActivasPOS.length === 0) {
            cont.innerHTML = '<div style="text-align:center; padding:15px; color:#94A3B8;">No hay promociones activas registradas en el sistema.</div>';
            return;
        }

        promocionesActivasPOS.forEach(p => {
            const itemDiv = document.createElement('div');
            itemDiv.style = `border:1px solid #E2E8F0; border-radius:8px; padding:12px; display:flex; justify-content:space-between; align-items:center; background:#FFFFFF; cursor:pointer; transition:all 0.2s ease;`;
            itemDiv.onmouseover = () => itemDiv.style.borderColor = '#EA580C';
            itemDiv.onmouseout = () => itemDiv.style.borderColor = '#E2E8F0';

            const valorTxt = p.tipo === 'PORCENTAJE' ? `${p.valor}% OFF` : (p.tipo === 'MONTO_FIJO' ? `C$ ${p.valor} OFF` : (p.tipo === 'BONO_ENVIO' ? `Envío -C$ ${p.valor}` : '2x1'));
            const reqGerente = p.requiere_autorizacion === 1;

            itemDiv.innerHTML = `
                <div>
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="role-pill" style="background:#D97706; color:#FFF; font-size:0.75rem;">${p.codigo}</span>
                        <strong style="color:#0F172A; font-size:0.95rem;">${p.nombre}</strong>
                    </div>
                    <div style="font-size:0.8rem; color:#64748B; margin-top:3px;">
                        ${p.descripcion || 'Aplica a toda la comanda'}
                    </div>
                    ${reqGerente ? '<span style="font-size:0.72rem; color:#92400E; font-weight:700; background:#FEF3C7; border:1px solid #F59E0B; padding:2px 6px; border-radius:4px; display:inline-block; margin-top:4px;">[REQUIERE GERENTE GENERAL]</span>' : ''}
                </div>
                <div style="text-align:right;">
                    <span style="font-size:1.1rem; font-weight:800; color:#EA580C; display:block;">${valorTxt}</span>
                    <button type="button" class="btn-small" style="background:#059669; padding:4px 10px; font-size:0.8rem; margin-top:4px;">
                        Aplicar
                    </button>
                </div>
            `;
            itemDiv.onclick = () => seleccionarPromocionPOS(p);
            cont.appendChild(itemDiv);
        });
    } catch (e) {
        cont.innerHTML = '<div style="color:#DC2626; padding:10px;">Error al cargar promociones.</div>';
    }
}

function seleccionarPromocionPOS(p) {
    if (p.requiere_autorizacion === 1) {
        abrirModalAutorizarGerente(`Aplicar promoción protegida: "${p.nombre}" (${p.tipo === 'PORCENTAJE' ? p.valor + '%' : 'C$ ' + p.valor})`, (nombreAutorizador) => {
            descuentoAplicado = {
                id_promocion: p.id_promocion,
                nombre: p.nombre,
                tipo: p.tipo,
                valor: p.valor,
                monto_calculado: 0,
                motivo: `Promo ${p.codigo} aplicada`,
                autorizado_por: nombreAutorizador
            };
            cerrarModalAplicarPromo();
            actualizarCarritoUI();
            mostrarToast(`Promoción "${p.nombre}" aplicada con autorización de Gerente.`);
        });
    } else {
        descuentoAplicado = {
            id_promocion: p.id_promocion,
            nombre: p.nombre,
            tipo: p.tipo,
            valor: p.valor,
            monto_calculado: 0,
            motivo: `Promo ${p.codigo} aplicada`,
            autorizado_por: null
        };
        cerrarModalAplicarPromo();
        actualizarCarritoUI();
        mostrarToast(`Promoción "${p.nombre}" aplicada a la comanda.`);
    }
}

function aplicarDescuentoManual() {
    const tipo = document.getElementById('select-tipo-desc-manual').value;
    const valor = parseFloat(document.getElementById('txt-valor-desc-manual').value) || 0;
    const motivo = (document.getElementById('txt-motivo-desc-manual').value || '').trim();

    if (valor <= 0) {
        alert('Por favor ingrese un valor de descuento mayor a 0.');
        return;
    }
    if (!motivo) {
        alert('Debe ingresar un motivo o justificación para el descuento manual.');
        document.getElementById('txt-motivo-desc-manual').focus();
        return;
    }

    const requiereGerente = (tipo === 'PORCENTAJE' && valor > 15) || (tipo === 'MONTO_FIJO' && valor >= 150);

    const ejecutarAplicacion = (autorizador = null) => {
        descuentoAplicado = {
            id_promocion: null,
            nombre: `Descuento Manual (${tipo === 'PORCENTAJE' ? valor + '%' : 'C$ ' + valor})`,
            tipo: tipo,
            valor: valor,
            monto_calculado: 0,
            motivo: motivo,
            autorizado_por: autorizador
        };
        cerrarModalAplicarPromo();
        actualizarCarritoUI();
        mostrarToast(`Descuento manual de ${tipo === 'PORCENTAJE' ? valor + '%' : 'C$ ' + valor} aplicado.`);
    };

    if (requiereGerente) {
        abrirModalAutorizarGerente(`Descuento manual del ${tipo === 'PORCENTAJE' ? valor + '%' : 'C$ ' + valor} por motivo: "${motivo}"`, (nombreAutorizador) => {
            ejecutarAplicacion(nombreAutorizador);
        });
    } else {
        ejecutarAplicacion(null);
    }
}

function removerDescuentoAplicado() {
    descuentoAplicado = {
        id_promocion: null,
        nombre: '',
        tipo: null,
        valor: 0,
        monto_calculado: 0,
        motivo: '',
        autorizado_por: null
    };
    actualizarCarritoUI();
}

function abrirModalAutorizarGerente(motivoAccion, onAutorizado) {
    callbackAutorizacionGerente = onAutorizado;
    const modal = document.getElementById('modal-autorizar-gerente');
    if (!modal) return;
    const txtMotivo = document.getElementById('txt-autorizar-motivo-accion');
    if (txtMotivo) txtMotivo.innerText = motivoAccion || 'Esta acción requiere autorización del Gerente General.';
    const txtPin = document.getElementById('txt-gerente-pin');
    if (txtPin) {
        txtPin.value = '';
        setTimeout(() => txtPin.focus(), 150);
    }
    if (document.getElementById('txt-gerente-nota')) document.getElementById('txt-gerente-nota').value = '';
    modal.classList.add('open');
}

function cerrarModalAutorizarGerente() {
    const modal = document.getElementById('modal-autorizar-gerente');
    if (modal) modal.classList.remove('open');
    callbackAutorizacionGerente = null;
}

async function confirmarAutorizacionGerente(e) {
    e.preventDefault();
    const pin = document.getElementById('txt-gerente-pin').value;
    const nota = document.getElementById('txt-gerente-nota').value;

    try {
        const res = await fetch('/api/auth/autorizar-gerente', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credencial: pin, motivo: nota })
        });
        const data = await res.json();
        if (data.success) {
            mostrarToast('Autorización de Gerente General concedida con éxito.', 'success');
            const cb = callbackAutorizacionGerente;
            cerrarModalAutorizarGerente();
            if (typeof cb === 'function') {
                cb(data.autorizado_por || 'Gerente General');
            }
        } else {
            alert('Autorización rechazada: ' + (data.error || 'Credenciales de Gerente inválidas.'));
            const txtPin = document.getElementById('txt-gerente-pin');
            if (txtPin) {
                txtPin.value = '';
                txtPin.focus();
            }
        }
    } catch (err) {
        alert('Error de conexión al validar autorización de Gerente.');
    }
}

// =============================================================================
// SECCIÓN 9.2: COMPARTIR COMPROBANTE Y FACTURAS POR WHATSAPP
// =============================================================================

function compartirFacturaPorWhatsApp() {
    if (!ultimaVentaProcesada || !ultimaVentaProcesada.venta) {
        mostrarToast('No hay una factura activa para compartir.', 'warning');
        return;
    }
    const v = ultimaVentaProcesada.venta;
    let tel = (v.cliente_telefono || '').replace(/\D/g, '');
    if (!tel) {
        tel = prompt('Ingrese el número de WhatsApp del cliente (8 dígitos):', '');
        if (!tel) return;
        tel = tel.replace(/\D/g, '');
    }

    if (typeof WhatsAppService !== 'undefined') {
        const mensaje = WhatsAppService.generarComprobanteCliente(v);
        WhatsAppService.enviarMensaje(tel, mensaje);
        return;
    }

    if (tel.length === 8) tel = '505' + tel;
    let itemsTexto = '';
    (v.items || []).forEach(it => {
        itemsTexto += `  * ${it.cantidad}x ${it.nombre} - C$ ${(it.precio * it.cantidad).toFixed(2)}\n`;
    });

    const mensaje = 
`================================================
RESTAURANTE EL GUSTAZO - COMPROBANTE DE COMPRA
Sierra Maestra, Managua
================================================
Factura No.: ${v.numero_factura}
Fecha: ${v.fecha}
Cliente: ${v.cliente_nombre}
Modalidad: ${v.tipo_entrega === 'DELIVERY' ? 'A Domicilio' : (v.tipo_entrega === 'LLEVAR' ? 'Para Llevar' : 'En Local')}
------------------------------------------------
DETALLE DEL PEDIDO:
${itemsTexto}------------------------------------------------
Subtotal: C$ ${v.subtotal.toFixed(2)}
TOTAL FACTURADO: C$ ${v.total.toFixed(2)}
Forma de Pago: ${v.metodo_pago}${v.referencia ? ' (Ref: ' + v.referencia + ')' : ''}
================================================`;

    const url = `https://wa.me/${tel}?text=${encodeURIComponent(mensaje)}`;
    window.open(url, '_blank');
}

/**
 * Alterna la vista dentro del modal de comprobantes entre Factura Comercial y Ticket Térmico.
 * 
 * ¿POR QUÉ SE PUSO?
 * Da la libertad al cajero de elegir entre imprimir una factura formal completa
 * (para clientes empresariales o de consumo alto) o un ticket térmico rápido de 58/80mm.
 * 
 * @param {string} vista - 'factura' o 'ticket'.
 */
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

/**
 * Lanza el cuadro de diálogo de impresión del navegador para la Factura Comercial en PDF.
 */
function imprimirFacturaPDF() {
    cambiarVistaComprobante('factura');
    window.print();
}

/**
 * Imprime el ticket térmico ESC/POS formateado en una impresora física de 58mm o 80mm.
 * 
 * ¿POR QUÉ SE PUSO?
 * Crea un contenedor oculto en el DOM con el texto preformateado en fuente monoespaciada
 * y aplica las reglas `@media print` definidas en style.css, garantizando que la impresora
 * térmica corte el papel exactamente al final del ticket sin imprimir encabezados ni pies del navegador.
 */
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

/**
 * Cierra la ventana modal de comprobante de venta.
 */
function cerrarModalComprobante() {
    const modal = document.getElementById('modal-comprobante-exito');
    if (modal) modal.classList.remove('open');
}


// =============================================================================
// SECCIÓN 10: MODAL DE CREACIÓN RÁPIDA DE CLIENTES NUEVOS DESDE POS
// =============================================================================

/**
 * Abre el modal para dar de alta un cliente nuevo sin salir del Punto de Venta.
 */
function abrirModalNuevoCliente() {
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) modal.classList.add('open');
}

/**
 * Cierra el modal de cliente nuevo.
 */
function cerrarModalNuevoCliente() {
    const modal = document.getElementById('modal-nuevo-cliente');
    if (modal) modal.classList.remove('open');
}

/**
 * Guarda un cliente nuevo en SQLite y lo deja seleccionado automáticamente en la comanda.
 * 
 * ¿POR QUÉ SE PUSO?
 * Evita retrasos en caja: si llega un cliente que desea registrarse para acumular historial
 * o para una entrega en Sierra Maestra, el cajero lo registra en 5 segundos y continúa facturando.
 * 
 * @param {Event} e - Evento submit del formulario.
 */
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