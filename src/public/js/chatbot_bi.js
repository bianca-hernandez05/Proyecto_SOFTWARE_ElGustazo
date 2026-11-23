/**
 * =============================================================================
 * ASISTENTE J.A.R.V.I.S. - INTELIGENCIA OPERATIVA HIBRIDA (RF-29, CP-003, CP-026)
 * Archivo: src/public/js/chatbot_bi.js
 * Propósito: Panel lateral (Drawer) de asistencia gerencial y operativa con
 *            arquitectura híbrida: consultas analíticas 100% Offline sobre SQLite3
 *            fusionadas con acciones en línea de WhatsApp Web cuando hay red.
 * Restricción RBAC (RF-29 / CP-003): Exclusivo para Administrador (1) y Gerente General (3).
 * =============================================================================
 */

const JarvisAssistant = {
    isOpen: false,

    init() {
        if (document.getElementById('jarvis-chatbot-container')) return;

        // Cumplimiento estricto de RF-29 y CP-003: Ocultar J.A.R.V.I.S. para el rol Cajero (id_rol === 2)
        try {
            const rawUser = localStorage.getItem('elgustazo_user');
            if (rawUser) {
                const user = JSON.parse(rawUser);
                const idRol = parseInt(user.id_rol, 10);
                if (idRol === 2) {
                    return; // El Cajero no tiene acceso al asistente gerencial J.A.R.V.I.S.
                }
            }
        } catch (e) {}

        const container = document.createElement('div');
        container.id = 'jarvis-chatbot-container';
        container.innerHTML = `
            <!-- Panel Lateral Desplegable (Drawer) -->
            <aside id="jarvis-drawer" class="jarvis-drawer-panel" style="display: none;">
                <div class="jarvis-drawer-header">
                    <div>
                        <h3 class="jarvis-title">J.A.R.V.I.S. | Asistente El Gustazo</h3>
                        <span id="jarvis-hybrid-subtitle" class="jarvis-subtitle">Motor Local SQLite3 (Offline) + WhatsApp Web (Online)</span>
                    </div>
                    <button id="jarvis-close-btn" class="jarvis-close-btn" title="Cerrar Panel">&times;</button>
                </div>

                <div class="jarvis-quick-actions">
                    <button class="jarvis-chip-btn" data-query="¿Cómo estamos con el rendimiento operativo, mis finanzas y qué medidas debo tomar?">Diagnóstico y Medidas</button>
                    <button class="jarvis-chip-btn" data-query="1">1. Producto Estrella</button>
                    <button class="jarvis-chip-btn" data-query="2">2. Proyección Ventas</button>
                    <button class="jarvis-chip-btn" data-query="3">3. Promociones</button>
                    <button class="jarvis-chip-btn" data-query="4">4. Auditoría Caja</button>
                    <button class="jarvis-chip-btn" data-query="5">5. Motorizados</button>
                    <button class="jarvis-chip-btn" data-query="6">6. Stock Crítico</button>
                    <button class="jarvis-chip-btn" data-query="7">7. Finanzas y Bancos</button>
                    <button class="jarvis-chip-btn" data-query="8">8. Pedidos WhatsApp</button>
                    <button class="jarvis-chip-btn" data-query="9">9. Seguridad y Backups</button>
                </div>

                <div id="jarvis-messages-area" class="jarvis-messages-container">
                    <div class="jarvis-msg jarvis-msg-system">
                        <div class="jarvis-msg-meta">J.A.R.V.I.S. — SISTEMA HÍBRIDO INICIALIZADO</div>
                        <p style="margin-bottom:8px;">Bienvenido al asistente de Inteligencia Operativa de El Gustazo. Puede <strong>escribir únicamente el número de la opción (1 al 10)</strong> o escribir libremente su pregunta (ej. <em>"¿Cómo estamos con el rendimiento operativo, mis finanzas y qué medidas debo tomar?"</em>):</p>
                        <div style="font-size:0.78rem; color:#431407; background:#FFF7ED; border:1px solid #FED7AA; border-radius:8px; padding:8px 10px; line-height:1.5; margin-bottom:8px;">
                            <strong>1.</strong> Producto Estrella y Rotación &nbsp;|&nbsp; <strong>2.</strong> Proyección de Ventas<br/>
                            <strong>3.</strong> Sugerir Promociones &nbsp;|&nbsp; <strong>4.</strong> Auditoría y Arqueo de Caja<br/>
                            <strong>5.</strong> Rendimiento Motorizados &nbsp;|&nbsp; <strong>6.</strong> Inventario y Stock Crítico<br/>
                            <strong>7.</strong> Finanzas, Ventas y Bancos &nbsp;|&nbsp; <strong>8.</strong> Pedidos WhatsApp Web<br/>
                            <strong>9.</strong> Seguridad y Respaldos &nbsp;|&nbsp; <strong>10.</strong> Diagnóstico Operativo y Medidas
                        </div>
                        <div style="margin-top:8px; display:flex; gap:6px; flex-wrap:wrap;">
                            <button type="button" class="jarvis-chip-btn" style="background:#EA580C; color:#FFF; border-color:#C2410C;" onclick="if(window.WhatsAppService) WhatsAppService.abrirModalRecepcionWhatsApp()">
                                Capturar Pedido WhatsApp Web
                            </button>
                            <button type="button" class="jarvis-chip-btn" style="background:#16A34A; color:#FFF; border-color:#15803D;" onclick="JarvisAssistant.enviarResumenEjecutivoWhatsApp()">
                                Enviar Resumen a Gerencia (WA)
                            </button>
                        </div>
                    </div>
                </div>

                <div class="jarvis-drawer-footer">
                    <form id="jarvis-chat-form" class="jarvis-input-form">
                        <input type="text" id="jarvis-input-field" class="jarvis-input" placeholder="Escriba un número (1-10) o pregunte: ¿Cómo van mis finanzas y qué medidas tomar?" autocomplete="off" required />
                        <button type="submit" class="jarvis-send-btn">Consultar</button>
                    </form>
                    <div class="jarvis-footer-toolbar">
                        <button type="button" id="jarvis-clear-btn" class="jarvis-text-action">Limpiar historial de sesión</button>
                        <span id="jarvis-status-indicator" class="jarvis-status-label">Estado: Híbrido Activo (SQLite + Red)</span>
                    </div>
                </div>
            </aside>
        `;

        document.body.appendChild(container);

        // Integrar el botón de J.A.R.V.I.S. directamente en la barra superior (.user-status) para no tapar ningún botón inferior
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.id = 'jarvis-toggle-btn';
        toggleBtn.className = 'jarvis-trigger-btn';
        toggleBtn.title = 'Abrir Asistente Ejecutivo J.A.R.V.I.S.';
        toggleBtn.innerHTML = `
            <span class="jarvis-badge-sigla">J.A.R.V.I.S.</span>
        `;

        const headerUserStatus = document.querySelector('.main-header .user-status') || document.querySelector('.user-status');
        if (headerUserStatus) {
            headerUserStatus.insertBefore(toggleBtn, headerUserStatus.firstChild);
        } else {
            toggleBtn.classList.add('jarvis-trigger-floating');
            container.appendChild(toggleBtn);
        }

        this.bindEvents();
        this.actualizarEstadoConectividad();
        window.addEventListener('online', () => this.actualizarEstadoConectividad());
        window.addEventListener('offline', () => this.actualizarEstadoConectividad());
    },

    actualizarEstadoConectividad() {
        const online = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
        const statusEl = document.getElementById('jarvis-status-indicator');
        const subEl = document.getElementById('jarvis-hybrid-subtitle');
        if (statusEl) {
            statusEl.innerText = online
                ? 'Estado: Híbrido Activo (SQLite Offline + WhatsApp Online)'
                : 'Estado: Modo Autónomo Offline (100% SQLite Local)';
            statusEl.style.color = online ? '#15803D' : '#B45309';
        }
        if (subEl) {
            subEl.innerText = online
                ? 'Motor Híbrido: SQLite3 Local + Puente WhatsApp Web Activo'
                : 'Modo sin Internet: Consultas SQLite3 Locales Activas';
        }
    },

    bindEvents() {
        const toggleBtn = document.getElementById('jarvis-toggle-btn');
        const closeBtn = document.getElementById('jarvis-close-btn');
        const clearBtn = document.getElementById('jarvis-clear-btn');
        const form = document.getElementById('jarvis-chat-form');
        const chips = document.querySelectorAll('#jarvis-drawer .jarvis-quick-actions .jarvis-chip-btn');

        toggleBtn.addEventListener('click', () => this.toggleDrawer(true));
        closeBtn.addEventListener('click', () => this.toggleDrawer(false));

        clearBtn.addEventListener('click', () => {
            const area = document.getElementById('jarvis-messages-area');
            area.innerHTML = `
                <div class="jarvis-msg jarvis-msg-system">
                    <div class="jarvis-msg-meta">J.A.R.V.I.S. — HISTORIAL REINICIADO</div>
                    <p>Sesión de consulta depurada. Seleccione una métrica rápida o ingrese su consulta operativa.</p>
                </div>
            `;
        });

        chips.forEach(chip => {
            chip.addEventListener('click', () => {
                const query = chip.getAttribute('data-query');
                if (query) this.enviarConsulta(query);
            });
        });

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('jarvis-input-field');
            const texto = input.value.trim();
            if (!texto) return;
            input.value = '';
            this.enviarConsulta(texto);
        });
    },

    toggleDrawer(open) {
        const drawer = document.getElementById('jarvis-drawer');
        this.isOpen = open;
        drawer.style.display = open ? 'flex' : 'none';
        if (open) {
            this.actualizarEstadoConectividad();
            const input = document.getElementById('jarvis-input-field');
            if (input) input.focus();
        }
    },

    agregarMensaje(autor, texto, esUsuario = false, accionesHibridas = []) {
        const area = document.getElementById('jarvis-messages-area');
        const msgDiv = document.createElement('div');
        msgDiv.className = `jarvis-msg ${esUsuario ? 'jarvis-msg-user' : 'jarvis-msg-system'}`;

        const hora = new Date().toLocaleTimeString('es-NI', { hour: '2-digit', minute: '2-digit' });
        let accionesHtml = '';
        if (!esUsuario && Array.isArray(accionesHibridas) && accionesHibridas.length > 0) {
            accionesHtml = `<div style="margin-top:10px; padding-top:8px; border-top:1px solid #FED7AA; display:flex; gap:6px; flex-wrap:wrap;">`;
            accionesHibridas.forEach((acc, idx) => {
                if (acc.tipo === 'ABRIR_MODAL_WA') {
                    accionesHtml += `<button type="button" class="jarvis-chip-btn" style="background:#EA580C; color:#FFF; border-color:#C2410C;" onclick="if(window.WhatsAppService) WhatsAppService.abrirModalRecepcionWhatsApp()">${acc.etiqueta}</button>`;
                } else if (acc.tipo === 'ABRIR_WA_WEB') {
                    accionesHtml += `<button type="button" class="jarvis-chip-btn" style="background:#16A34A; color:#FFF; border-color:#15803D;" onclick="window.open('https://web.whatsapp.com', '_blank')">${acc.etiqueta}</button>`;
                } else if (acc.tipo === 'WHATSAPP_PROMO') {
                    const msgEncoded = encodeURIComponent(acc.mensaje || '');
                    accionesHtml += `<button type="button" class="jarvis-chip-btn" style="background:#16A34A; color:#FFF; border-color:#15803D;" onclick="JarvisAssistant.dispararPromoWhatsApp('${msgEncoded}')">${acc.etiqueta}</button>`;
                }
            });
            accionesHtml += `</div>`;
        }

        msgDiv.innerHTML = `
            <div class="jarvis-msg-meta">${autor} — ${hora}</div>
            <div class="jarvis-pre-format">${String(texto || "").replace(/={10,}\r?\n?/g, "").replace(/-{15,}\r?\n?/g, "").trim()}</div>
            ${accionesHtml}
        `;

        area.appendChild(msgDiv);
        area.scrollTop = area.scrollHeight;
    },

    dispararPromoWhatsApp(msgEncoded) {
        const texto = decodeURIComponent(msgEncoded || '');
        const tel = prompt('Ingrese el número de WhatsApp del cliente o grupo (8 dígitos en Nicaragua):', '88885544');
        if (!tel) return;
        if (window.WhatsAppService) {
            window.WhatsAppService.enviarMensaje(tel, texto);
        } else {
            let num = tel.replace(/\D/g, '');
            if (num.length === 8) num = '505' + num;
            window.open(`https://wa.me/${num}?text=${encodeURIComponent(texto)}`, '_blank');
        }
    },

    async enviarResumenEjecutivoWhatsApp() {
        try {
            const res = await fetch('/api/bi/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensaje: 'Informe de ventas acumuladas de hoy y bancos' })
            });
            const data = await res.json();
            const tel = prompt('Ingrese el número de WhatsApp del Gerente General o Socio (8 dígitos):', '88997711');
            if (!tel) return;
            if (window.WhatsAppService) {
                window.WhatsAppService.enviarMensaje(tel, data.respuesta || 'Reporte Ejecutivo El Gustazo');
            }
        } catch (e) {
            alert('Error al generar resumen ejecutivo.');
        }
    },

    async enviarConsulta(mensaje) {
        this.agregarMensaje('OPERADOR AUTORIZADO', mensaje, true);

        const area = document.getElementById('jarvis-messages-area');
        const loadingDiv = document.createElement('div');
        loadingDiv.className = 'jarvis-msg jarvis-msg-system jarvis-loading';
        loadingDiv.textContent = 'Consultando motor de base de datos local SQLite...';
        area.appendChild(loadingDiv);
        area.scrollTop = area.scrollHeight;

        try {
            const response = await fetch('/api/bi/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ mensaje })
            });
            const data = await response.json();
            area.removeChild(loadingDiv);

            if (data.error) {
                this.agregarMensaje('J.A.R.V.I.S. — ALERTA', data.error, false);
            } else {
                this.agregarMensaje(data.agente || 'J.A.R.V.I.S.', data.respuesta, false, data.acciones_hibridas || []);
            }
        } catch (err) {
            area.removeChild(loadingDiv);
            this.agregarMensaje('J.A.R.V.I.S. — ERROR DE COMUNICACIÓN', 'No fue posible establecer enlace con el servidor local.', false);
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    JarvisAssistant.init();
});
