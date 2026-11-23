/**
 * =============================================================================
 * MODULO CLIENTE DE CONTROL RBAC, NAVEGACION ESTABLE Y UTILIDADES COMPARTIDAS
 * Archivo: src/public/js/rbac_nav.js
 * Empresa: El Gustazo - Sierra Maestra, Managua
 * Tono: Corporativo Institucional (Cero Emojis - Navegacion Fija sin Desplazamientos)
 * =============================================================================
 */

// 1. UTILIDADES GLOBALES DE SESION Y PETICIONES AUTENTICADAS
function obtenerUsuarioActual() {
    try {
        const u = localStorage.getItem('elgustazo_user');
        return u ? JSON.parse(u) : null;
    } catch (e) {
        return null;
    }
}
window.obtenerUsuarioActual = obtenerUsuarioActual;

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
window.fetchAuth = fetchAuth;

function cerrarSesion() {
    localStorage.removeItem('elgustazo_user');
    window.location.href = 'login.html';
}
window.cerrarSesion = cerrarSesion;

// 2. INICIALIZACION AUTOMATICA AL CARGAR EL DOM
document.addEventListener('DOMContentLoaded', () => {
    inicializarNavegacionRBAC();
    consultarAlertasStockHeaderGlobal();
    actualizarConteoDeliveryHeaderGlobal();

    // Actualizaciones periodicas suaves cada 25 segundos
    setInterval(consultarAlertasStockHeaderGlobal, 25000);
    setInterval(actualizarConteoDeliveryHeaderGlobal, 15000);
});

function inicializarNavegacionRBAC() {
    const usuario = obtenerUsuarioActual();
    const paginaActual = window.location.pathname.split('/').pop() || 'pos.html';

    if (!usuario) {
        if (!paginaActual.endsWith('login.html')) {
            window.location.href = 'login.html';
        }
        return;
    }

    const idRol = parseInt(usuario.id_rol || 2);

    // 1. Regla Inquebrantable RBAC de Enrutamiento:
    // Cajero (id_rol 2): Acceso operativo autorizado para POS, Delivery en tránsito y Arqueo/Cierre de Caja.
    if (idRol === 2) {
        const paginasPermitidasCajero = ['pos.html', 'delivery.html', 'caja.html', 'login.html', 'comprobante.html'];
        if (!paginasPermitidasCajero.includes(paginaActual)) {
            alert('Acceso Denegado: Su perfil de Cajero únicamente tiene autorización para operar el Punto de Venta (POS), Delivery y Arqueo de Caja Chica.');
            window.location.href = 'pos.html';
            return;
        }
    }

    // 2. Actualizar datos de identidad en la cabecera institucional
    const elNombre = document.getElementById('header-user-name');
    const elRol = document.getElementById('header-user-role');
    const rolTexto = usuario.rol || (idRol === 3 ? 'Gerente General' : (idRol === 1 ? 'Administrador' : 'Cajero'));
    const nomTexto = usuario.nombre || 'Operador de Turno';

    if (elNombre) {
        elNombre.textContent = nomTexto;
        if (nomTexto.trim().toLowerCase().includes(rolTexto.trim().toLowerCase())) {
            elNombre.style.display = 'none';
        } else {
            elNombre.style.display = '';
        }
    }
    if (elRol) {
        elRol.textContent = rolTexto;
        elRol.title = nomTexto;
        elRol.className = 'role-pill';

        // Colorimetría corporativa: Sin azules genéricos ni morados
        if (idRol === 3) {
            // Gerente General (Dueño Supremo): Fondo obsidiana con acento dorado/ámbar
            elRol.style.backgroundColor = '#B45309';
            elRol.style.border = '1px solid #FDE68A';
            elRol.style.color = '#FFFFFF';
            elRol.style.fontWeight = '800';
        } else if (idRol === 1) {
            // Administrador: Naranja Institucional
            elRol.style.backgroundColor = '#EA580C';
            elRol.style.border = '1px solid #EA580C';
            elRol.style.color = '#FFFFFF';
            elRol.style.fontWeight = '700';
        } else {
            // Cajero: Verde Operativo
            elRol.style.backgroundColor = '#16A34A';
            elRol.style.border = '1px solid #16A34A';
            elRol.style.color = '#FFFFFF';
            elRol.style.fontWeight = '700';
        }
    }

    // 3. Destacar enlace activo segun la URL actual
    document.querySelectorAll('.nav-menu .nav-link').forEach(enlace => {
        const href = enlace.getAttribute('href');
        if (href && href.includes(paginaActual)) {
            enlace.classList.add('active');
        }
    });

    // 4. Aplicar directivas de seguridad RBAC sobre el DOM
    aplicarRestriccionesDOM(idRol);
}

function aplicarRestriccionesDOM(idRol) {
    if (idRol === 2) {
        // Cajero: Permitir POS, Delivery y Caja Chica (para Arqueo/Cierre de turno obligatorio)
        document.querySelectorAll('.nav-menu .nav-link').forEach(enlace => {
            const href = enlace.getAttribute('href') || '';
            if (!href.includes('pos.html') && !href.includes('delivery.html') && !href.includes('caja.html')) {
                enlace.style.display = 'none';
            }
        });

        // Ocultar acciones administrativas, reportes, configuraciones, atención por WhatsApp y módulos no autorizados
        // El Cajero (id_rol 2) en el POS opera únicamente para Local y Para Llevar; WhatsApp es exclusivo de Admin y Gerente General
        document.querySelectorAll('.admin-only, .rbac-admin, .rbac-gerente, .solo-gerente, .btn-order-delete, #btn-tipo-delivery, #btn-del-capturar-wa, #badge-origen-whatsapp-pos, #box-pos-delivery, a[href="admin.html"], a[href="inventario.html"], a[href="clientes.html"]').forEach(el => {
            el.style.display = 'none';
        });

        // En el modal de Delivery, si existe el selector de canal de entrada, restringir WhatsApp para Cajero
        const selOrigenDel = document.getElementById('txt-del-origen');
        if (selOrigenDel) {
            Array.from(selOrigenDel.options).forEach(opt => {
                if (opt.value === 'WHATSAPP') opt.remove();
            });
        }
    } else if (idRol === 1) {
        // Administrador: Acceso medio. Ocultar estrictamente acciones exclusivas del Gerente General (Dueño)
        document.querySelectorAll('.solo-gerente, .rbac-gerente').forEach(el => {
            el.style.display = 'none';
        });
    }
}

// 3. MONITOREO UNIVERSAL DE INSUMOS CRITICOS EN LA CABECERA (TODOS LOS ROLES)
let ultimasAlertasStock = [];

async function consultarAlertasStockHeaderGlobal() {
    try {
        const res = await fetch('/api/alertas-stock');
        if (!res.ok) return;
        const data = await res.json();
        ultimasAlertasStock = Array.isArray(data) ? data : [];

        const btnAlert = document.getElementById('btn-header-alert');
        if (btnAlert) {
            btnAlert.style.display = 'inline-flex';
            btnAlert.style.alignItems = 'center';
            btnAlert.style.gap = '6px';
            btnAlert.style.cursor = 'pointer';
            btnAlert.style.transition = 'all 0.2s ease';

            if (ultimasAlertasStock.length > 0) {
                btnAlert.innerHTML = `Insumos (${ultimasAlertasStock.length})`;
                btnAlert.style.background = '#DC2626';
                btnAlert.style.color = '#FFFFFF';
                btnAlert.style.border = '1px solid #B91C1C';
                btnAlert.style.fontWeight = '700';
                btnAlert.title = `${ultimasAlertasStock.length} insumo(s) por debajo del nivel de seguridad. Clic para ver detalle.`;
            } else {
                btnAlert.innerHTML = `Insumos: Óptimo`;
                btnAlert.style.background = '#DCFCE7';
                btnAlert.style.color = '#166534';
                btnAlert.style.border = '1px solid #86EFAC';
                btnAlert.style.fontWeight = '600';
                btnAlert.title = 'Todos los insumos de cocina se encuentran en niveles seguros de existencia.';
            }

            btnAlert.onclick = () => mostrarModalInsumosCriticosGlobal();
        }
    } catch (e) {
        console.warn('Alerta stock cabecera:', e);
    }
}
window.consultarAlertasStockHeader = consultarAlertasStockHeaderGlobal;
window.consultarAlertasStockHeaderGlobal = consultarAlertasStockHeaderGlobal;

// 4. MODAL UNIVERSAL INFORMATIVO DE INSUMOS CRITICOS (ACCESIBLE PARA CAJERO, ADMIN Y GERENTE)
function asegurarModalInsumosCriticosEnDOM() {
    let modal = document.getElementById('modal-insumos-criticos-global');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'modal-insumos-criticos-global';
        modal.className = 'modal-backdrop';
        modal.style.cssText = `
            position: fixed; inset: 0; background: rgba(15, 23, 42, 0.75);
            display: none; align-items: center; justify-content: center; z-index: 99999;
            backdrop-filter: blur(4px);
        `;
        modal.innerHTML = `
            <div style="background:#FFFFFF; border-radius:12px; width:95%; max-width:620px; box-shadow:0 20px 25px -5px rgba(0,0,0,0.3); overflow:hidden; border:1px solid #E2E8F0; font-family:Inter,system-ui,sans-serif;">
                <div style="background:linear-gradient(135deg, #EA580C 0%, #C2410C 100%); color:#FFFFFF; padding:16px 20px; display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <h3 style="margin:0; font-size:1.1rem; font-weight:800; display:flex; align-items:center; gap:8px;">
                            Monitoreo de Insumos Críticos de Cocina
                        </h3>
                        <p style="margin:2px 0 0 0; font-size:0.8rem; color:#FFEDD5;">
                            Estado de existencias en tiempo real para prevención de desabastecimiento.
                        </p>
                    </div>
                    <button type="button" onclick="cerrarModalInsumosCriticosGlobal()" style="background:transparent; border:none; color:#FFFFFF; font-size:1.5rem; cursor:pointer; line-height:1; padding:0 4px;" title="Cerrar">&times;</button>
                </div>

                <div id="modal-insumos-criticos-body" style="padding:20px; max-height:380px; overflow-y:auto;">
                    <!-- Contenido dinámico -->
                </div>

                <div id="modal-insumos-criticos-footer" style="background:#F8FAFC; border-top:1px solid #E2E8F0; padding:12px 20px; display:flex; justify-content:space-between; align-items:center;">
                    <div id="modal-insumos-criticos-role-hint" style="font-size:0.8rem; color:#64748B;">
                        <!-- Nota por rol -->
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button type="button" onclick="cerrarModalInsumosCriticosGlobal()" style="background:#64748B; color:#FFFFFF; border:none; border-radius:6px; padding:8px 16px; font-weight:700; cursor:pointer; font-size:0.85rem;">Cerrar</button>
                        <button type="button" id="btn-modal-ir-inventario" onclick="irAInventarioDesdeModal()" style="background:#EA580C; color:#FFFFFF; border:none; border-radius:6px; padding:8px 16px; font-weight:700; cursor:pointer; font-size:0.85rem; display:none;">Gestionar en Inventario</button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }
    return modal;
}

function mostrarModalInsumosCriticosGlobal() {
    const modal = asegurarModalInsumosCriticosEnDOM();
    const body = document.getElementById('modal-insumos-criticos-body');
    const hint = document.getElementById('modal-insumos-criticos-role-hint');
    const btnIrInv = document.getElementById('btn-modal-ir-inventario');
    const usuario = obtenerUsuarioActual() || {};
    const idRol = parseInt(usuario.id_rol || 2);

    if (idRol === 1 || idRol === 3) {
        btnIrInv.style.display = 'inline-block';
        hint.innerHTML = `<strong>Permiso Administrativo:</strong> Puede ingresar compras o registrar mermas en Inventario.`;
    } else {
        btnIrInv.style.display = 'none';
        hint.innerHTML = `<span style="color:#D97706; font-weight:700;">Aviso Operativo para Cajero:</span> Notifique al Gerente o Cocina para compras.`;
    }

    if (ultimasAlertasStock.length === 0) {
        body.innerHTML = `
            <div style="text-align:center; padding:30px 15px;">
                <div style="display:inline-flex; width:48px; height:48px; border-radius:50%; background:#DCFCE7; color:#16A34A; align-items:center; justify-content:center; font-size:1.4rem; font-weight:800; margin-bottom:12px;">✓</div>
                <h4 style="margin:0 0 6px 0; color:#0F172A; font-size:1.05rem; font-weight:700;">Nivel de Stock Completamente Óptimo</h4>
                <p style="margin:0; color:#64748B; font-size:0.85rem; line-height:1.5;">Todos los insumos de cocina cuentan con existencias superiores al stock mínimo de seguridad.</p>
            </div>
        `;
    } else {
        let tablaHtml = `
            <div style="background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; padding:10px 14px; margin-bottom:15px; font-size:0.85rem; color:#991B1B;">
                <strong>Atención:</strong> Se identificaron <strong>${ultimasAlertasStock.length}</strong> insumo(s) con existencias en nivel de alerta crítica o agotados.
            </div>
            <table style="width:100%; border-collapse:collapse; font-size:0.85rem;">
                <thead>
                    <tr style="border-bottom:2px solid #E2E8F0; text-align:left; color:#475569;">
                        <th style="padding:8px 6px;">Insumo</th>
                        <th style="padding:8px 6px; text-align:right;">Stock Actual</th>
                        <th style="padding:8px 6px; text-align:right;">Mínimo Requerido</th>
                        <th style="padding:8px 6px; text-align:center;">Unidad</th>
                        <th style="padding:8px 6px; text-align:center;">Estado</th>
                    </tr>
                </thead>
                <tbody>
        `;

        ultimasAlertasStock.forEach(item => {
            const actual = parseFloat(item.stock_actual || 0);
            const min = parseFloat(item.stock_minimo || 0);
            const esAgotado = actual <= 0;
            const estadoBg = esAgotado ? '#7F1D1D' : '#DC2626';
            const estadoTexto = esAgotado ? 'AGOTADO' : 'CRÍTICO';

            tablaHtml += `
                <tr style="border-bottom:1px solid #F1F5F9;">
                    <td style="padding:10px 6px; font-weight:700; color:#0F172A;">${item.nombre}</td>
                    <td style="padding:10px 6px; text-align:right; font-weight:800; color:#DC2626;">${actual.toFixed(2)}</td>
                    <td style="padding:10px 6px; text-align:right; color:#64748B;">${min.toFixed(2)}</td>
                    <td style="padding:10px 6px; text-align:center; color:#64748B;">${item.unidad_medida || 'U'}</td>
                    <td style="padding:10px 6px; text-align:center;">
                        <span style="background:${estadoBg}; color:#FFFFFF; padding:2px 8px; border-radius:4px; font-size:0.75rem; font-weight:800;">${estadoTexto}</span>
                    </td>
                </tr>
            `;
        });

        tablaHtml += `</tbody></table>`;
        body.innerHTML = tablaHtml;
    }

    modal.style.display = 'flex';
}
window.mostrarModalInsumosCriticosGlobal = mostrarModalInsumosCriticosGlobal;

function cerrarModalInsumosCriticosGlobal() {
    const modal = document.getElementById('modal-insumos-criticos-global');
    if (modal) modal.style.display = 'none';
}
window.cerrarModalInsumosCriticosGlobal = cerrarModalInsumosCriticosGlobal;

function irAInventarioDesdeModal() {
    cerrarModalInsumosCriticosGlobal();
    window.location.href = 'inventario.html';
}
window.irAInventarioDesdeModal = irAInventarioDesdeModal;

// 5. ACTUALIZACION UNIVERSAL DEL CONTADOR DE DELIVERY EN CABECERA
async function actualizarConteoDeliveryHeaderGlobal() {
    try {
        const res = await fetch('/api/delivery/conteo-activos');
        if (!res.ok) return;
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
        // Silencioso en páginas sin conexión
    }
}
window.actualizarConteoDeliveryHeaderGlobal = actualizarConteoDeliveryHeaderGlobal;
