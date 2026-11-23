/**
 * =============================================================================
 * SERVICIO HIBRIDO DE INTEGRACION WHATSAPP WEB Y RECEPCION DE PEDIDOS
 * Archivo: src/public/js/whatsapp_service.js
 * Propósito: Fusionar la operación local 100% Offline (SQLite3) con la mensajería
 *            en línea de WhatsApp Web (wa.me) para recepción de pedidos a domicilio
 *            o para retirar en local, aplicación de promociones, cálculo de vuelto
 *            en efectivo y registro de referencias de transferencia o tarjeta.
 * =============================================================================
 */

const WhatsAppService = {
    catalogoCache: [],
    promocionesCache: [],
    ultimoPedidoParseado: null,

    esOnline() {
        return typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    },

    normalizarTelefono(telefono) {
        let limpio = String(telefono || '').replace(/\D/g, '');
        if (limpio.length === 8) {
            limpio = '505' + limpio;
        }
        return limpio;
    },

    generarComprobanteCliente(venta) {
        const fecha = venta.fecha || new Date().toLocaleString('es-NI');
        const numFactura = venta.numero_factura || `FAC-${venta.id_venta || '000'}`;
        const cliente = venta.cliente_nombre || 'Consumidor Final';
        const metodo = venta.metodo_pago || (venta.id_metodo_pago === 2 ? 'Transferencia / Tarjeta' : 'Efectivo');
        const modalidad = venta.tipo_entrega === 'DELIVERY' ? 'Entrega a Domicilio' : (venta.tipo_entrega === 'LLEVAR' ? 'Para Llevar' : 'Consumo en Local');

        let detalleLineas = '';
        if (Array.isArray(venta.items)) {
            venta.items.forEach(item => {
                const sub = (parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad || 1, 10)).toFixed(2);
                detalleLineas += `  * ${item.cantidad}x ${item.nombre || item.producto_nombre} — C$ ${sub}\n`;
            });
        }

        const subtotal = parseFloat(venta.subtotal || venta.total || 0).toFixed(2);
        const descuento = parseFloat(venta.descuento || 0).toFixed(2);
        const envio = parseFloat(venta.costo_delivery || 0).toFixed(2);
        const total = parseFloat(venta.total || 0).toFixed(2);

        return (
            `================================================\n` +
            `RESTAURANTE EL GUSTAZO - COMPROBANTE DE COMPRA\n` +
            `Sierra Maestra, Managua, Nicaragua\n` +
            `================================================\n` +
            `Factura No.: ${numFactura}\n` +
            `Fecha y Hora: ${fecha}\n` +
            `Cliente: ${cliente}\n` +
            `Modalidad: ${modalidad}\n` +
            `Metodo de Pago: ${metodo}${venta.referencia ? ' (Ref: ' + venta.referencia + ')' : ''}\n` +
            `------------------------------------------------\n` +
            `DETALLE DE PRODUCTOS:\n` +
            `${detalleLineas}` +
            `------------------------------------------------\n` +
            `Subtotal: C$ ${subtotal}\n` +
            (parseFloat(descuento) > 0 ? `Descuento Aplicado: -C$ ${descuento}\n` : '') +
            (parseFloat(envio) > 0 ? `Cargo por Envio (Delivery): C$ ${envio}\n` : '') +
            `TOTAL FACTURADO: C$ ${total}\n` +
            `================================================\n` +
            `Agradecemos su preferencia.\n` +
            `Documento generado por Sistema POS Hibrido El Gustazo.`
        );
    },

    generarHojaRutaRepartidor(pedido) {
        let itemsTxt = '';
        if (Array.isArray(pedido.items)) {
            pedido.items.forEach(it => {
                itemsTxt += `  * ${it.cantidad}x ${it.producto_nombre || it.nombre}\n`;
            });
        }
        return (
            `================================================\n` +
            `EL GUSTAZO - ORDEN DE DESPACHO DELIVERY\n` +
            `================================================\n` +
            `Orden No.: ${pedido.numero_pedido || ('DEL-' + pedido.id_pedido)}\n` +
            `Repartidor Asignado: ${pedido.repartidor || 'Personal de Turno'}\n` +
            `Cliente: ${pedido.cliente_nombre || 'Cliente Delivery'}\n` +
            `Telefono de Contacto: ${pedido.telefono || 'No registrado'}\n` +
            `Direccion de Entrega: ${pedido.direccion || 'Consultar en mostrador'}\n` +
            `Tiempo Estimado: ${pedido.tiempo_estimado_min || 30} minutos\n` +
            (pedido.notas ? `Observaciones: ${pedido.notas}\n` : '') +
            `------------------------------------------------\n` +
            `CONTENIDO DEL PAQUETE:\n` +
            `${itemsTxt || '  * Ver comanda impresa de cocina\n'}` +
            `------------------------------------------------\n` +
            `MONTO TOTAL A COBRAR: C$ ${parseFloat(pedido.total || 0).toFixed(2)}\n` +
            `Condicion de Pago: ${pedido.metodo_pago || (pedido.id_metodo_pago === 2 ? 'Transferencia / Tarjeta Verificada' : 'Efectivo contra entrega')}\n` +
            `================================================`
        );
    },

    generarConfirmacionPedidoRecibido(pedido) {
        let itemsTxt = '';
        if (Array.isArray(pedido.items)) {
            pedido.items.forEach(it => {
                const precio = parseFloat(it.precio || it.precio_unitario || 0);
                itemsTxt += `  * ${it.cantidad}x ${it.nombre || it.producto_nombre} (C$ ${(precio * it.cantidad).toFixed(2)})\n`;
            });
        }
        let detallePago = 'Efectivo';
        if (pedido.id_metodo_pago === 2) {
            detallePago = `Transferencia Bancaria (${pedido.banco || 'Banco'} - Ref: ${pedido.referencia || 'Verificada'})`;
        } else if (pedido.id_metodo_pago === 3) {
            detallePago = `Tarjeta (${pedido.banco || 'POS'} - Ref: ${pedido.referencia || 'Verificada'})`;
        } else if (parseFloat(pedido.monto_recibido || 0) > parseFloat(pedido.total || 0)) {
            const vuelto = (parseFloat(pedido.monto_recibido) - parseFloat(pedido.total)).toFixed(2);
            detallePago = `Efectivo (Paga con C$ ${parseFloat(pedido.monto_recibido).toFixed(2)} | Vuelto a recibir: C$ ${vuelto})`;
        }

        return (
            `================================================\n` +
            `EL GUSTAZO - CONFIRMACION DE PEDIDO RECIBIDO\n` +
            `Sierra Maestra, Managua\n` +
            `================================================\n` +
            `Estimado(a) ${pedido.cliente_nombre || 'Cliente'}:\n` +
            `Su orden ha sido registrada en nuestro sistema local y enviada a cocina.\n\n` +
            `Orden No.: #${pedido.numero_pedido || 'EN-PROCESO'}\n` +
            `Modalidad: ${pedido.modalidad === 'LLEVAR' ? 'Para Retirar en Local' : ('A Domicilio (' + (pedido.direccion || 'Sierra Maestra') + ')')}\n` +
            `Tiempo Estimado: 25 - 35 minutos\n` +
            `------------------------------------------------\n` +
            `RESUMEN DE SU ORDEN:\n` +
            `${itemsTxt}` +
            (parseFloat(pedido.descuento || 0) > 0 ? `Descuento Promo (${pedido.promo_nombre || 'Aplicado'}): -C$ ${parseFloat(pedido.descuento).toFixed(2)}\n` : '') +
            (parseFloat(pedido.costo_delivery || 0) > 0 ? `Costo de Envio: C$ ${parseFloat(pedido.costo_delivery).toFixed(2)}\n` : '') +
            `TOTAL A LIQUIDAR: C$ ${parseFloat(pedido.total || 0).toFixed(2)}\n` +
            `Forma de Pago: ${detallePago}\n` +
            `================================================\n` +
            `Gracias por preferir El Gustazo.`
        );
    },

    enviarMensaje(telefono, texto) {
        const num = this.normalizarTelefono(telefono);
        if (!num || num.length < 8) {
            alert('Por favor ingrese un numero de telefono valido (8 digitos en Nicaragua) para enviar por WhatsApp.');
            return;
        }

        if (!this.esOnline()) {
            try {
                const cola = JSON.parse(localStorage.getItem('elgustazo_wa_cola_offline') || '[]');
                cola.unshift({ telefono: num, texto, fecha: new Date().toLocaleString('es-NI') });
                localStorage.setItem('elgustazo_wa_cola_offline', JSON.stringify(cola.slice(0, 30)));
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(texto).catch(() => {});
                }
            } catch (e) {}
            alert('[MODO HIBRIDO OFFLINE ACTIVO]\n\nLa operacion quedo 100% guardada en la base de datos local SQLite.\nComo el equipo no detecta salida a Internet en este instante, el comprobante ha sido copiado al portapapeles y guardado en la cola local para enviarse por WhatsApp Web en cuanto retorne la señal.');
            return;
        }

        const url = `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    },

    async asegurarCatalogoLocal() {
        if (this.catalogoCache && this.catalogoCache.length > 0) return this.catalogoCache;
        try {
            const res = await fetch('/api/productos');
            if (res.ok) {
                this.catalogoCache = await res.json();
            }
        } catch (e) {
            console.error('Error cargando catalogo para WhatsApp Service:', e);
        }
        return this.catalogoCache;
    },

    async asegurarPromocionesActivas() {
        try {
            const res = await fetch('/api/promociones/activas');
            if (res.ok) {
                this.promocionesCache = await res.json();
            }
        } catch (e) {
            console.error('Error cargando promociones para WhatsApp Service:', e);
        }
        return this.promocionesCache;
    },

    async interpretarMensajePedidoWhatsApp(textoMensaje) {
        const [catalogo, promociones] = await Promise.all([
            this.asegurarCatalogoLocal(),
            this.asegurarPromocionesActivas()
        ]);
        const texto = String(textoMensaje || '').trim();
        if (!texto) return null;

        let clienteNombre = '';
        let telefono = '';
        let direccion = '';
        let metodoPago = 1; // 1 = Efectivo, 2 = Transferencia, 3 = Tarjeta
        let banco = 'BAC';
        let referencia = '';
        let montoRecibido = 0;
        let idPromocionDetectada = '';
        let notas = 'Pedido recibido por WhatsApp Web';

        // 1. Extraer teléfono de 8 dígitos
        const matchTel = texto.match(/(?:\+?505[\s-]?)?([578]\d{3}[\s-]?\d{4})/);
        if (matchTel) {
            telefono = matchTel[1].replace(/\D/g, '');
        }

        // 2. Extraer nombre si viene etiquetado
        const matchNombre = texto.match(/(?:cliente|nombre|soy|de parte de)\s*[:\-]?\s*([A-Za-zÁÉÍÓÚáéíóúñÑ\s]{3,35}?)(?=\s*(?:\||,|\n|tel|dir|pago|pedido|$))/i);
        if (matchNombre) {
            clienteNombre = matchNombre[1].trim();
        }

        // 3. Extraer dirección si viene etiquetada
        const matchDir = texto.match(/(?:dir(?:eccion|ección)?|entrega(?:r)?(?:\s+en)?|ubicaci[oó]n|domicilio)\s*[:\-]?\s*([^|\n]+?)(?=\s*(?:\||pago|pedido|items|$))/i);
        if (matchDir) {
            direccion = matchDir[1].trim();
        } else if (texto.toLowerCase().includes('sierra maestra')) {
            const idxSm = texto.toLowerCase().indexOf('sierra maestra');
            direccion = texto.substring(idxSm, Math.min(texto.length, idxSm + 65)).split('\n')[0].replace(/[|]/g, '').trim();
        }

        // 4. Detectar método de pago (Efectivo con billete, Transferencia o Tarjeta)
        const textoLower = texto.toLowerCase();
        if (textoLower.includes('tarjeta') || textoLower.includes('vaucher') || textoLower.includes('váucher') || textoLower.includes('pos')) {
            metodoPago = 3;
            if (textoLower.includes('banpro')) banco = 'Banpro';
            else if (textoLower.includes('lafise')) banco = 'Lafise';
            else if (textoLower.includes('bdf')) banco = 'BDF';
            else if (textoLower.includes('ficohsa')) banco = 'Ficohsa';
            else banco = 'BAC';

            const matchRef = texto.match(/(?:ref(?:erencia)?|comprobante|vaucher|váucher|aut)\s*[:#\-]?\s*([A-Za-z0-9\-]{4,20})/i);
            if (matchRef) referencia = matchRef[1].trim();
        } else if (textoLower.includes('transferencia') || textoLower.includes('bdf') || textoLower.includes('ficohsa') || textoLower.includes('bac') || textoLower.includes('lafise') || textoLower.includes('banpro')) {
            metodoPago = 2;
            if (textoLower.includes('ficohsa')) banco = 'Ficohsa';
            else if (textoLower.includes('bac')) banco = 'BAC';
            else if (textoLower.includes('lafise')) banco = 'Lafise';
            else if (textoLower.includes('banpro')) banco = 'Banpro';
            else banco = 'BDF';

            const matchRef = texto.match(/(?:ref(?:erencia)?|comprobante)\s*[:#\-]?\s*([A-Za-z0-9\-]{4,20})/i);
            if (matchRef) referencia = matchRef[1].trim();
        } else {
            // Detectar si indica con cuánto paga en efectivo (ej. "pago con 500", "billete de 1000", "cambio de 500")
            const matchBillete = texto.match(/(?:pago con|paga con|billete de|cambio de|vuelto de|efectivo)\s*(?:c\$)?\s*(\d{2,4})/i);
            if (matchBillete) {
                montoRecibido = parseFloat(matchBillete[1]) || 0;
            }
        }

        // 5. Detectar si el texto menciona algún código de promoción activa
        (promociones || []).forEach(pr => {
            if (pr.codigo && textoLower.includes(pr.codigo.toLowerCase())) {
                idPromocionDetectada = String(pr.id_promocion);
            }
        });

        // 6. Emparejar platillos del catálogo SQLite
        const normalizar = (str) => String(str || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const textoNorm = normalizar(texto);
        const itemsDetectados = [];

        const catalogoOrdenado = [...catalogo].sort((a, b) => b.nombre.length - a.nombre.length);
        let textoRestante = textoNorm;

        catalogoOrdenado.forEach(prod => {
            const nomNorm = normalizar(prod.nombre);
            if (!nomNorm) return;
            const escaped = nomNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regexCantAntes = new RegExp(`(?:^|[\\s,;:|+-])(\\d+)\\s*(?:x|unidades de|orden(?:es)? de)?\\s*${escaped}`, 'i');
            const regexSimple = new RegExp(`(?:^|[\\s,;:|+-])${escaped}`, 'i');

            let cantidad = 0;
            const mAntes = textoRestante.match(regexCantAntes);
            if (mAntes) {
                cantidad = parseInt(mAntes[1], 10) || 1;
                textoRestante = textoRestante.replace(mAntes[0], ' ');
            } else if (regexSimple.test(textoRestante)) {
                cantidad = 1;
                textoRestante = textoRestante.replace(regexSimple, ' ');
            }

            if (cantidad > 0) {
                itemsDetectados.push({
                    id_producto: prod.id_producto,
                    nombre: prod.nombre,
                    precio: parseFloat(prod.precio),
                    cantidad: cantidad,
                    subtotal: parseFloat(prod.precio) * cantidad
                });
            }
        });

        const subtotal = itemsDetectados.reduce((acc, it) => acc + it.subtotal, 0);
        const esParaRetirar = /(para llevar|para retirar|paso a retirar|retirar en el local|retiro en local|retiro en el local|voy por el)/i.test(texto);
        const modalidadDetectada = esParaRetirar ? 'LLEVAR' : 'DELIVERY';
        const costoDelivery = modalidadDetectada === 'DELIVERY' ? 35 : 0;

        this.ultimoPedidoParseado = {
            modalidad: modalidadDetectada,
            cliente_nombre: clienteNombre || 'Cliente WhatsApp',
            telefono: telefono || '',
            direccion: modalidadDetectada === 'DELIVERY' ? (direccion || 'Sierra Maestra, Managua') : 'Retira en el Local',
            id_metodo_pago: metodoPago,
            banco: metodoPago >= 2 ? banco : null,
            referencia_transferencia: metodoPago >= 2 ? referencia : null,
            monto_recibido: montoRecibido,
            id_promocion: idPromocionDetectada,
            costo_delivery: costoDelivery,
            items: itemsDetectados,
            subtotal: subtotal,
            total: subtotal + costoDelivery,
            notas: notas
        };

        return this.ultimoPedidoParseado;
    },

    async abrirModalRecepcionWhatsApp() {
        let usuario = null;
        try {
            usuario = JSON.parse(localStorage.getItem('elgustazo_user') || 'null');
        } catch (e) {}
        const idRol = usuario ? parseInt(usuario.id_rol, 10) : 2;
        if (idRol !== 1 && idRol !== 3) {
            if (typeof mostrarToast === 'function') {
                mostrarToast('Acceso restringido: La recepción de pedidos por WhatsApp está autorizada únicamente para el Administrador y Gerente General. El Cajero opera en modalidad Local y Para Llevar.', 'warning');
            } else {
                alert('Acceso restringido: La recepción de pedidos por WhatsApp está autorizada únicamente para el Administrador y Gerente General. El Cajero opera en modalidad Local y Para Llevar.');
            }
            return;
        }

        await Promise.all([
            this.asegurarCatalogoLocal(),
            this.asegurarPromocionesActivas()
        ]);
        let modal = document.getElementById('modal-hibrido-whatsapp');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'modal-hibrido-whatsapp';
            modal.className = 'modal-backdrop';
            modal.innerHTML = `
                <div class="modal-box" style="max-width: 780px; width: 96%;">
                    <div class="modal-header" style="background: linear-gradient(135deg, #EA580C 0%, #C2410C 100%); border-bottom: 2px solid #F59E0B;">
                        <div>
                            <h3 style="margin:0; color:#F8FAFC; font-size:1.05rem;">Centro de Recepción de Pedidos por WhatsApp Web</h3>
                            <small id="wa-modal-status-bar" style="color:#F59E0B; font-size:0.76rem; font-weight:700;">
                                Motor Híbrido: Base de Datos Local SQLite (Offline) + Enlace WhatsApp Web (Online)
                            </small>
                        </div>
                        <button type="button" class="modal-close-btn" onclick="WhatsAppService.cerrarModalRecepcionWhatsApp()">&times;</button>
                    </div>
                    <div class="modal-body" style="display: block; padding: 18px; max-height: 82vh; overflow-y: auto;">
                        <!-- Barra de Acciones Híbridas Rápidas -->
                        <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px; padding:10px; background:#F8FAFC; border:1px solid #E2E8F0; border-radius:8px; justify-content:space-between; align-items:center;">
                            <div style="font-size:0.82rem; color:#334155; font-weight:600;">
                                Reciba pedidos desde WhatsApp Web y procéselos en la base de datos local sin depender de servidores externos.
                            </div>
                            <div style="display:flex; gap:8px; flex-wrap:wrap;">
                                <button type="button" class="btn-small" style="background:#16A34A; color:#FFF; font-weight:700;" onclick="window.open('https://web.whatsapp.com', '_blank')">
                                    Abrir WhatsApp Web
                                </button>
                                <button type="button" class="btn-small" style="background:#EA580C; color:#FFF;" onclick="WhatsAppService.cargarEjemploPedidoWhatsApp()">
                                    Cargar Mensaje de Ejemplo
                                </button>
                            </div>
                        </div>

                        <!-- Paso 1: Pegar mensaje de WhatsApp -->
                        <div class="form-group" style="margin-bottom:12px;">
                            <label style="font-weight:800; color:#0F172A;">1. Pegar Mensaje de Pedido Recibido en WhatsApp Web (Intérprete Automático Offline):</label>
                            <textarea id="txt-wa-mensaje-entrante" rows="2" placeholder="Ejemplo: Cliente: Carlos Mendoza | Tel: 8888-5544 | Dir: Sierra Maestra, de la rotonda 2c al sur | Pago: Efectivo 500 | Promo: AMIGO10 | Pedido: 2 Hamburguesa sencilla, 1 Papas fritas" style="width:100%; font-size:0.85rem; padding:8px 10px; border:1.5px solid #CBD5E1; border-radius:6px;" oninput="WhatsAppService.analizarEnVivoModalWA()"></textarea>
                        </div>

                        <!-- Paso 2: Datos del Cliente, Modalidad, Promoción y Método de Pago -->
                        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(165px, 1fr)); gap:10px; margin-bottom:12px; background:#FFFBEB; padding:12px; border:1px solid #FDE68A; border-radius:8px;">
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.78rem; font-weight:700; color:#92400E;">Modalidad del Pedido WA:</label>
                                <select id="sel-wa-modalidad" onchange="WhatsAppService.alCambiarModalidadWA()" style="padding:6px 8px; font-size:0.85rem; font-weight:700; border-color:#F59E0B;">
                                    <option value="DELIVERY">A Domicilio</option>
                                    <option value="LLEVAR">Para Retirar en Local</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.78rem;">Cliente:</label>
                                <input type="text" id="txt-wa-cliente" placeholder="Nombre del cliente" style="padding:6px 8px; font-size:0.85rem;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.78rem;">Teléfono WhatsApp:</label>
                                <input type="text" id="txt-wa-telefono" placeholder="88885544" style="padding:6px 8px; font-size:0.85rem;">
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.78rem; font-weight:700; color:#9A3412;">Promoción / Descuento:</label>
                                <select id="sel-wa-promocion" onchange="WhatsAppService.alCambiarPromocionWA()" style="padding:6px 8px; font-size:0.85rem; border-color:#FDBA74;">
                                    <option value="">Sin Promoción Aplicada</option>
                                </select>
                            </div>
                            <div class="form-group" style="margin:0;">
                                <label style="font-size:0.78rem; font-weight:700;">Método de Pago:</label>
                                <select id="sel-wa-metodo-pago" onchange="WhatsAppService.alCambiarMetodoPagoWA()" style="padding:6px 8px; font-size:0.85rem; font-weight:700;">
                                    <option value="1">Efectivo</option>
                                    <option value="2">Transferencia Bancaria</option>
                                    <option value="3">Tarjeta (POS / Váucher)</option>
                                </select>
                            </div>

                            <!-- Panel dinámico: Si paga en Efectivo (Con cuánto paga y Vuelto) -->
                            <div id="wrap-wa-efectivo" style="grid-column: 1 / -1; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; background:#FFFFFF; border:1px solid #BBF7D0; padding:8px 12px; border-radius:6px;">
                                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap;">
                                    <label for="num-wa-monto-recibido" style="font-size:0.8rem; font-weight:800; color:#166534; margin:0;">Paga con (C$):</label>
                                    <input type="number" id="num-wa-monto-recibido" placeholder="0.00" min="0" step="1" style="width:95px; padding:5px 8px; font-weight:800; font-size:0.88rem; border:1.5px solid #86EFAC; border-radius:5px;" oninput="WhatsAppService.calcularVueltoModalWA()">
                                    <div style="display:flex; gap:4px; flex-wrap:wrap;">
                                        <button type="button" onclick="WhatsAppService.fijarMontoRecibidoRapidoWA('EXACTO')" style="padding:4px 8px; font-size:0.74rem; font-weight:700; border-radius:4px; border:1px solid #16A34A; background:#DCFCE7; color:#166534; cursor:pointer;">Exacto</button>
                                        <button type="button" onclick="WhatsAppService.fijarMontoRecibidoRapidoWA(100)" style="padding:4px 8px; font-size:0.74rem; font-weight:700; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; color:#334155; cursor:pointer;">C$ 100</button>
                                        <button type="button" onclick="WhatsAppService.fijarMontoRecibidoRapidoWA(200)" style="padding:4px 8px; font-size:0.74rem; font-weight:700; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; color:#334155; cursor:pointer;">C$ 200</button>
                                        <button type="button" onclick="WhatsAppService.fijarMontoRecibidoRapidoWA(500)" style="padding:4px 8px; font-size:0.74rem; font-weight:700; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; color:#334155; cursor:pointer;">C$ 500</button>
                                        <button type="button" onclick="WhatsAppService.fijarMontoRecibidoRapidoWA(1000)" style="padding:4px 8px; font-size:0.74rem; font-weight:700; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; color:#334155; cursor:pointer;">C$ 1000</button>
                                    </div>
                                </div>
                                <div id="box-wa-vuelto" style="background:#DCFCE7; border:1px solid #86EFAC; padding:4px 12px; border-radius:6px; font-size:0.88rem; font-weight:800; color:#15803D;">
                                    Vuelto: <span id="lbl-wa-vuelto">C$ 0.00</span>
                                </div>
                            </div>

                            <!-- Panel dinámico: Si paga con Transferencia o Tarjeta (Banco + Referencia) -->
                            <div id="wrap-wa-transferencia" style="grid-column: 1 / -1; display:none; grid-template-columns: 1fr 1.6fr; gap:10px; background:#FFFFFF; border:1px solid #FDBA74; padding:8px 12px; border-radius:6px;">
                                <div class="form-group" style="margin:0;">
                                    <label for="sel-wa-banco" style="font-size:0.78rem; font-weight:700; color:#9A3412;">Banco / Procesador (*):</label>
                                    <select id="sel-wa-banco" style="padding:6px 8px; font-size:0.85rem; font-weight:700;">
                                        <option value="BAC">BAC Credomatic</option>
                                        <option value="Banpro">Banpro Promerica</option>
                                        <option value="Lafise">Banco LAFISE</option>
                                        <option value="BDF">Banco BDF</option>
                                        <option value="Ficohsa">Banco Ficohsa</option>
                                    </select>
                                </div>
                                <div class="form-group" style="margin:0;">
                                    <label for="txt-wa-referencia" style="font-size:0.78rem; font-weight:700; color:#9A3412;">No. de Referencia / Váucher Tarjeta (*):</label>
                                    <input type="text" id="txt-wa-referencia" placeholder="Ej: TRF-982341 o No. Autorización POS" style="padding:6px 8px; font-size:0.85rem; font-weight:700;">
                                </div>
                            </div>

                            <div id="wrap-wa-direccion" class="form-group" style="margin:0; grid-column: 1 / -1;">
                                <label style="font-size:0.78rem;">Dirección de Entrega (Solo si es Envío a Domicilio):</label>
                                <input type="text" id="txt-wa-direccion" placeholder="Dirección exacta de entrega en Sierra Maestra..." style="padding:6px 8px; font-size:0.85rem;">
                            </div>
                        </div>

                        <!-- Paso 3: Agregar platillos manualmente o revisar los detectados -->
                        <div style="display:flex; gap:8px; align-items:center; margin-bottom:10px;">
                            <select id="sel-wa-agregar-prod" style="flex:1; padding:7px 10px; border:1px solid #CBD5E1; border-radius:6px; font-size:0.85rem;"></select>
                            <input type="number" id="num-wa-agregar-cant" value="1" min="1" max="50" style="width:70px; padding:7px; border:1px solid #CBD5E1; border-radius:6px; text-align:center; font-weight:700;">
                            <button type="button" class="btn-small" style="background:#16A34A; color:#FFF; padding:8px 14px; font-weight:700;" onclick="WhatsAppService.agregarPlatilloManualWA()">
                                + Agregar Platillo
                            </button>
                        </div>

                        <!-- Encabezado y Tabla Visible de Platillos Agregados -->
                        <div style="background:#FFF7ED; border:1.5px solid #FDBA74; border-radius:8px; margin-bottom:12px; overflow:visible;">
                            <div style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:#FFEDD5; border-bottom:1px solid #FDBA74; border-radius:6px 6px 0 0;">
                                <strong style="font-size:0.82rem; color:#9A3412;">Detalle de Platillos Agregados a la Orden:</strong>
                                <span id="badge-wa-conteo-items" style="background:#EA580C; color:#FFFFFF; font-size:0.75rem; font-weight:800; padding:2px 10px; border-radius:12px;">0 platillos</span>
                            </div>
                            <div style="max-height:200px; overflow-y:auto; background:#FFFFFF; border-radius:0 0 6px 6px;">
                                <table class="data-table" style="font-size:0.84rem; width:100%; margin:0;">
                                    <thead>
                                        <tr style="background:#F8FAFC;">
                                            <th style="padding:8px 10px;">Platillo / Combo Agregado</th>
                                            <th style="text-align:center; width:110px; padding:8px 6px;">Cantidad</th>
                                            <th style="text-align:right; width:95px; padding:8px 10px;">Precio</th>
                                            <th style="text-align:right; width:105px; padding:8px 10px;">Subtotal</th>
                                            <th style="text-align:center; width:65px; padding:8px 6px;">Quitar</th>
                                        </tr>
                                    </thead>
                                    <tbody id="tbody-wa-items-detectados">
                                        <tr><td colspan="5" style="text-align:center; color:#64748B; padding:16px;">Aún no hay platillos en la lista. Pegue un mensaje de WhatsApp arriba o elija un platillo y presione "+ Agregar Platillo".</td></tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Barra inferior de Costo Delivery, Descuento y Total Orden -->
                        <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; background:#F8FAFC; padding:10px 14px; border-radius:8px; border:1px solid #CBD5E1;">
                            <div style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
                                <div id="wrap-wa-costo-envio">
                                    <span style="font-size:0.82rem; color:#475569; font-weight:700;">Costo Envío Delivery (C$):</span>
                                    <input type="number" id="num-wa-costo-envio" value="35" min="0" step="5" style="width:75px; padding:4px 8px; margin-left:4px; font-weight:700; border:1px solid #CBD5E1; border-radius:4px;" oninput="WhatsAppService.renderizarItemsModalWA()">
                                </div>
                                <div id="badge-wa-descuento-resumen" style="display:none; background:#FEF3C7; border:1px solid #F59E0B; color:#B45309; padding:3px 10px; border-radius:6px; font-size:0.8rem; font-weight:800;">
                                    Descuento Promo: -<span id="lbl-wa-descuento-monto">C$ 0.00</span>
                                </div>
                            </div>
                            <div style="font-size:1.15rem; font-weight:900; color:#EA580C;">
                                TOTAL ORDEN: <span id="lbl-wa-total-orden">C$ 0.00</span>
                            </div>
                        </div>
                    </div>
                    <div class="modal-footer" style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:8px; background:#F1F5F9; padding:12px 18px;">
                        <button type="button" class="btn-small" style="background:#64748B; color:#FFF;" onclick="WhatsAppService.cerrarModalRecepcionWhatsApp()">
                            Cerrar
                        </button>
                        <div style="display:flex; gap:8px; flex-wrap:wrap;">
                            <button type="button" class="btn-small" style="background:#EA580C; color:#FFF; padding:9px 14px;" onclick="WhatsAppService.enviarPedidoAComandaPOS()">
                                Cargar en Comanda POS (Facturar)
                            </button>
                            <button type="button" class="btn-small" style="background:#16A34A; color:#FFF; padding:9px 14px;" onclick="WhatsAppService.registrarPedidoEnDeliveryYConfirmarWA()">
                                Registrar en Delivery + Confirmar por WhatsApp
                            </button>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(modal);
        }

        // Poblar selector de productos
        const selProd = document.getElementById('sel-wa-agregar-prod');
        if (selProd) {
            selProd.innerHTML = '';
            (this.catalogoCache || []).forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id_producto;
                opt.innerText = `${p.nombre} — C$ ${parseFloat(p.precio).toFixed(2)}`;
                selProd.appendChild(opt);
            });
        }

        // Poblar selector de promociones activas
        const selPromo = document.getElementById('sel-wa-promocion');
        if (selPromo) {
            const valorActual = selPromo.value;
            selPromo.innerHTML = '<option value="">Sin Promoción Aplicada</option>';
            (this.promocionesCache || []).forEach(pr => {
                const etiTipo = pr.tipo === 'PORCENTAJE' ? `${pr.valor}% OFF` : (pr.tipo === 'MONTO_FIJO' ? `C$ ${pr.valor} OFF` : pr.tipo);
                const opt = document.createElement('option');
                opt.value = String(pr.id_promocion);
                opt.innerText = `${pr.codigo} — ${pr.nombre} (${etiTipo})`;
                selPromo.appendChild(opt);
            });
            if (valorActual) selPromo.value = valorActual;
        }

        const statusBar = document.getElementById('wa-modal-status-bar');
        if (statusBar) {
            statusBar.innerText = this.esOnline()
                ? 'Modo Híbrido Activo: Base Local SQLite (Offline) + Enlace WhatsApp Web (Online Conectado)'
                : 'Modo Autónomo Offline: Base Local SQLite Activa (Sin Internet - Mensajes se copiarán al portapapeles)';
        }

        modal.classList.add('open');
    },

    cerrarModalRecepcionWhatsApp() {
        const modal = document.getElementById('modal-hibrido-whatsapp');
        if (modal) modal.classList.remove('open');
    },

    async cargarEjemploPedidoWhatsApp() {
        const Catalogo = await this.asegurarCatalogoLocal();
        const p1 = Catalogo[0] ? Catalogo[0].nombre : 'Hamburguesa sencilla';
        const p2 = Catalogo[1] ? Catalogo[1].nombre : 'Papas fritas';
        const ejemplo = `Cliente: Carlos Mendoza | Tel: 8888-5544 | Dir: Sierra Maestra, de la rotonda 2c al sur, casa porton negro | Pago: Efectivo 500 | Promo: AMIGO10 | Pedido: 2 ${p1}, 1 ${p2}`;
        const txt = document.getElementById('txt-wa-mensaje-entrante');
        if (txt) {
            txt.value = ejemplo;
            await this.analizarEnVivoModalWA();
        }
    },

    async analizarEnVivoModalWA() {
        const txt = document.getElementById('txt-wa-mensaje-entrante');
        if (!txt) return;
        const parsed = await this.interpretarMensajePedidoWhatsApp(txt.value);
        if (!parsed) return;

        if (parsed.modalidad && document.getElementById('sel-wa-modalidad')) {
            document.getElementById('sel-wa-modalidad').value = parsed.modalidad;
            this.alCambiarModalidadWA();
        }
        if (parsed.cliente_nombre) document.getElementById('txt-wa-cliente').value = parsed.cliente_nombre;
        if (parsed.telefono) document.getElementById('txt-wa-telefono').value = parsed.telefono;
        if (parsed.direccion) document.getElementById('txt-wa-direccion').value = parsed.direccion;
        if (parsed.id_promocion !== undefined && document.getElementById('sel-wa-promocion')) {
            document.getElementById('sel-wa-promocion').value = String(parsed.id_promocion || '');
        }
        if (parsed.id_metodo_pago && document.getElementById('sel-wa-metodo-pago')) {
            document.getElementById('sel-wa-metodo-pago').value = String(parsed.id_metodo_pago);
            this.alCambiarMetodoPagoWA();
        }
        if (parsed.banco && document.getElementById('sel-wa-banco')) {
            document.getElementById('sel-wa-banco').value = parsed.banco;
        }
        if (parsed.referencia_transferencia && document.getElementById('txt-wa-referencia')) {
            document.getElementById('txt-wa-referencia').value = parsed.referencia_transferencia;
        }
        if (parsed.monto_recibido > 0 && document.getElementById('num-wa-monto-recibido')) {
            document.getElementById('num-wa-monto-recibido').value = parsed.monto_recibido;
        }
        this.renderizarItemsModalWA();
    },

    alCambiarMetodoPagoWA() {
        const sel = document.getElementById('sel-wa-metodo-pago');
        const wrapEf = document.getElementById('wrap-wa-efectivo');
        const wrapTr = document.getElementById('wrap-wa-transferencia');
        if (!sel) return;
        const val = parseInt(sel.value, 10) || 1;
        if (val === 1) {
            if (wrapEf) wrapEf.style.display = 'flex';
            if (wrapTr) wrapTr.style.display = 'none';
        } else {
            if (wrapEf) wrapEf.style.display = 'none';
            if (wrapTr) wrapTr.style.display = 'grid';
        }
        this.calcularVueltoModalWA();
    },

    alCambiarPromocionWA() {
        const promo = this.obtenerPromocionSeleccionadaWA();
        const inpCosto = document.getElementById('num-wa-costo-envio');
        const selMod = document.getElementById('sel-wa-modalidad');
        if (promo && promo.codigo === 'ENVIOGRATIS' && inpCosto) {
            inpCosto.value = '0';
        } else if (selMod && selMod.value === 'DELIVERY' && inpCosto && parseFloat(inpCosto.value) === 0) {
            inpCosto.value = '35';
        }
        this.renderizarItemsModalWA();
    },

    obtenerPromocionSeleccionadaWA() {
        const selPromo = document.getElementById('sel-wa-promocion');
        if (!selPromo || !selPromo.value) return null;
        const idPromo = parseInt(selPromo.value, 10);
        return (this.promocionesCache || []).find(p => p.id_promocion === idPromo) || null;
    },

    calcularDescuentoWA(subtotal, costoEnvio) {
        const promo = this.obtenerPromocionSeleccionadaWA();
        if (!promo || subtotal <= 0) {
            return { monto: 0, promo: null };
        }
        let monto = 0;
        if (promo.codigo === 'ENVIOGRATIS') {
            monto = 0; // Ya puso costoEnvio = 0
        } else if (promo.tipo === 'PORCENTAJE') {
            monto = subtotal * (parseFloat(promo.valor || 0) / 100);
        } else if (promo.tipo === 'MONTO_FIJO') {
            monto = parseFloat(promo.valor || 0);
        } else if (promo.tipo === '2X1') {
            const items = (this.ultimoPedidoParseado && this.ultimoPedidoParseado.items) ? this.ultimoPedidoParseado.items : [];
            const totalUds = items.reduce((a, b) => a + b.cantidad, 0);
            if (totalUds >= 2 && items.length > 0) {
                const precios = items.map(i => parseFloat(i.precio));
                monto = Math.min(...precios);
            }
        }
        monto = Math.min(subtotal, Math.max(0, monto));
        return { monto, promo };
    },

    obtenerTotalActualModalWA() {
        const items = (this.ultimoPedidoParseado && this.ultimoPedidoParseado.items) ? this.ultimoPedidoParseado.items : [];
        const subtotal = items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
        const costoEnvio = parseFloat((document.getElementById('num-wa-costo-envio') || {}).value) || 0;
        const { monto: descuento } = this.calcularDescuentoWA(subtotal, costoEnvio);
        return Math.max(0, (subtotal - descuento) + costoEnvio);
    },

    fijarMontoRecibidoRapidoWA(valor) {
        const inp = document.getElementById('num-wa-monto-recibido');
        if (!inp) return;
        const total = this.obtenerTotalActualModalWA();
        if (valor === 'EXACTO') {
            inp.value = total.toFixed(2);
        } else {
            inp.value = parseFloat(valor).toFixed(2);
        }
        this.calcularVueltoModalWA();
    },

    calcularVueltoModalWA() {
        const inp = document.getElementById('num-wa-monto-recibido');
        const lblVuelto = document.getElementById('lbl-wa-vuelto');
        const boxVuelto = document.getElementById('box-wa-vuelto');
        if (!inp || !lblVuelto || !boxVuelto) return;

        const total = this.obtenerTotalActualModalWA();
        const recibido = parseFloat(inp.value);

        if (isNaN(recibido) || recibido <= 0) {
            lblVuelto.innerText = 'C$ 0.00';
            boxVuelto.style.background = '#DCFCE7';
            boxVuelto.style.borderColor = '#86EFAC';
            boxVuelto.style.color = '#15803D';
            return;
        }

        const dif = recibido - total;
        if (dif >= 0) {
            lblVuelto.innerText = `C$ ${dif.toFixed(2)}`;
            boxVuelto.style.background = '#DCFCE7';
            boxVuelto.style.borderColor = '#86EFAC';
            boxVuelto.style.color = '#15803D';
        } else {
            lblVuelto.innerText = `Faltan C$ ${Math.abs(dif).toFixed(2)}`;
            boxVuelto.style.background = '#FEE2E2';
            boxVuelto.style.borderColor = '#FCA5A5';
            boxVuelto.style.color = '#DC2626';
        }
    },

    agregarPlatilloManualWA() {
        const sel = document.getElementById('sel-wa-agregar-prod');
        const cantInput = document.getElementById('num-wa-agregar-cant');
        if (!sel || !cantInput) return;
        const idProd = parseInt(sel.value, 10);
        const cant = Math.max(1, parseInt(cantInput.value, 10) || 1);
        const prod = (this.catalogoCache || []).find(p => p.id_producto === idProd);
        if (!prod) return;

        if (prod.bloqueado_por_stock) {
            if (typeof window.mostrarModalAlertaReabastecimiento === 'function') {
                window.mostrarModalAlertaReabastecimiento(prod, prod.insumos_criticos || []);
            } else {
                alert(`ALERTA DE REABASTECIMIENTO: No se puede vender "${prod.nombre}" porque hay poco producto en inventario para sus insumos. Debe reabastecer en Inventario antes de continuar.`);
            }
            return;
        }

        if (!this.ultimoPedidoParseado) {
            this.ultimoPedidoParseado = {
                cliente_nombre: document.getElementById('txt-wa-cliente').value || 'Cliente WhatsApp',
                telefono: document.getElementById('txt-wa-telefono').value || '',
                direccion: document.getElementById('txt-wa-direccion').value || 'Sierra Maestra, Managua',
                id_metodo_pago: parseInt(document.getElementById('sel-wa-metodo-pago').value, 10) || 1,
                costo_delivery: parseFloat(document.getElementById('num-wa-costo-envio').value) || 35,
                items: []
            };
        }

        const existente = this.ultimoPedidoParseado.items.find(i => i.id_producto === idProd);
        if (existente) {
            existente.cantidad += cant;
            existente.subtotal = existente.cantidad * existente.precio;
        } else {
            this.ultimoPedidoParseado.items.push({
                id_producto: prod.id_producto,
                nombre: prod.nombre,
                precio: parseFloat(prod.precio),
                cantidad: cant,
                subtotal: parseFloat(prod.precio) * cant
            });
        }
        this.renderizarItemsModalWA();
    },

    cambiarCantidadItemModalWA(idx, delta) {
        if (!this.ultimoPedidoParseado || !Array.isArray(this.ultimoPedidoParseado.items)) return;
        const item = this.ultimoPedidoParseado.items[idx];
        if (!item) return;
        item.cantidad += delta;
        if (item.cantidad <= 0) {
            this.ultimoPedidoParseado.items.splice(idx, 1);
        } else {
            item.subtotal = item.cantidad * item.precio;
        }
        this.renderizarItemsModalWA();
    },

    quitarItemModalWA(idx) {
        if (!this.ultimoPedidoParseado || !Array.isArray(this.ultimoPedidoParseado.items)) return;
        this.ultimoPedidoParseado.items.splice(idx, 1);
        this.renderizarItemsModalWA();
    },

    renderizarItemsModalWA() {
        const tbody = document.getElementById('tbody-wa-items-detectados');
        const lblTotal = document.getElementById('lbl-wa-total-orden');
        const badgeConteo = document.getElementById('badge-wa-conteo-items');
        const badgeDesc = document.getElementById('badge-wa-descuento-resumen');
        const lblDescMonto = document.getElementById('lbl-wa-descuento-monto');
        const costoEnvio = parseFloat((document.getElementById('num-wa-costo-envio') || {}).value) || 0;
        if (!tbody) return;

        const items = (this.ultimoPedidoParseado && this.ultimoPedidoParseado.items) ? this.ultimoPedidoParseado.items : [];
        const totalUnidades = items.reduce((acc, it) => acc + (parseInt(it.cantidad, 10) || 0), 0);

        if (badgeConteo) {
            badgeConteo.innerText = totalUnidades === 1 ? '1 unidad agregada' : `${totalUnidades} unidades agregadas`;
            badgeConteo.style.background = totalUnidades > 0 ? '#16A34A' : '#EA580C';
        }

        if (items.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#64748B; padding:16px;">Aún no hay platillos en la lista. Pegue un mensaje de WhatsApp arriba o elija un platillo y presione "+ Agregar Platillo".</td></tr>';
            if (badgeDesc) badgeDesc.style.display = 'none';
            if (lblTotal) lblTotal.innerText = `C$ ${costoEnvio.toFixed(2)}`;
            this.calcularVueltoModalWA();
            return;
        }

        let subtotal = 0;
        tbody.innerHTML = '';
        items.forEach((it, index) => {
            const sub = it.precio * it.cantidad;
            subtotal += sub;
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #F1F5F9';
            tr.innerHTML = `
                <td style="padding:8px 10px;"><strong style="color:#0F172A;">${it.nombre}</strong></td>
                <td style="text-align:center; padding:8px 6px;">
                    <div style="display:inline-flex; align-items:center; gap:6px;">
                        <button type="button" onclick="WhatsAppService.cambiarCantidadItemModalWA(${index}, -1)" style="width:24px; height:24px; border-radius:4px; border:1px solid #CBD5E1; background:#F8FAFC; font-weight:800; cursor:pointer;">-</button>
                        <strong style="min-width:20px; text-align:center;">${it.cantidad}</strong>
                        <button type="button" onclick="WhatsAppService.cambiarCantidadItemModalWA(${index}, 1)" style="width:24px; height:24px; border-radius:4px; border:1px solid #FDBA74; background:#FFF7ED; color:#EA580C; font-weight:800; cursor:pointer;">+</button>
                    </div>
                </td>
                <td style="text-align:right; padding:8px 10px;">C$ ${it.precio.toFixed(2)}</td>
                <td style="text-align:right; padding:8px 10px; font-weight:800; color:#16A34A;">C$ ${sub.toFixed(2)}</td>
                <td style="text-align:center; padding:8px 6px;">
                    <button type="button" class="btn-small" style="background:#DC2626; color:#FFF; padding:3px 9px;" onclick="WhatsAppService.quitarItemModalWA(${index})" title="Quitar platillo">&times;</button>
                </td>
            `;
            tbody.appendChild(tr);
        });

        const { monto: descuento, promo } = this.calcularDescuentoWA(subtotal, costoEnvio);
        if (badgeDesc && lblDescMonto) {
            if (descuento > 0) {
                badgeDesc.style.display = 'inline-block';
                lblDescMonto.innerText = `C$ ${descuento.toFixed(2)} (${promo ? promo.codigo : ''})`;
            } else if (promo && promo.codigo === 'ENVIOGRATIS') {
                badgeDesc.style.display = 'inline-block';
                lblDescMonto.innerText = `Envío Gratis (${promo.codigo})`;
            } else {
                badgeDesc.style.display = 'none';
            }
        }

        const total = Math.max(0, (subtotal - descuento) + costoEnvio);
        if (lblTotal) lblTotal.innerText = `C$ ${total.toFixed(2)}`;
        this.calcularVueltoModalWA();
    },

    alCambiarModalidadWA() {
        const selMod = document.getElementById('sel-wa-modalidad');
        const wrapDir = document.getElementById('wrap-wa-direccion');
        const inpCosto = document.getElementById('num-wa-costo-envio');
        if (!selMod) return;
        const mod = selMod.value;
        if (mod === 'LLEVAR') {
            if (wrapDir) wrapDir.style.display = 'none';
            if (inpCosto) inpCosto.value = '0';
        } else {
            if (wrapDir) wrapDir.style.display = 'block';
            const promo = this.obtenerPromocionSeleccionadaWA();
            if (inpCosto && parseFloat(inpCosto.value) === 0 && (!promo || promo.codigo !== 'ENVIOGRATIS')) {
                inpCosto.value = '35';
            }
        }
        this.renderizarItemsModalWA();
    },

    enviarPedidoAComandaPOS() {
        const items = (this.ultimoPedidoParseado && this.ultimoPedidoParseado.items) ? this.ultimoPedidoParseado.items : [];
        if (items.length === 0) {
            alert('Agregue o detecte al menos un platillo del pedido de WhatsApp antes de cargarlo a la comanda.');
            return;
        }

        const modalidad = (document.getElementById('sel-wa-modalidad') || {}).value || 'DELIVERY';
        const esDelivery = modalidad === 'DELIVERY';
        const metodoSeleccionado = parseInt((document.getElementById('sel-wa-metodo-pago') || {}).value, 10) || 1;
        const banco = (document.getElementById('sel-wa-banco') || {}).value || 'BAC';
        const referencia = ((document.getElementById('txt-wa-referencia') || {}).value || '').trim();
        const montoRecibido = parseFloat((document.getElementById('num-wa-monto-recibido') || {}).value) || 0;

        if (metodoSeleccionado >= 2 && !referencia) {
            alert('Por favor ingrese el Número de Referencia o Váucher para el pago con Transferencia / Tarjeta.');
            const refInput = document.getElementById('txt-wa-referencia');
            if (refInput) refInput.focus();
            return;
        }

        const subtotal = items.reduce((acc, it) => acc + (it.precio * it.cantidad), 0);
        const costoEnvio = esDelivery ? (parseFloat((document.getElementById('num-wa-costo-envio') || {}).value) || 0) : 0;
        const { monto: descuentoMonto, promo } = this.calcularDescuentoWA(subtotal, costoEnvio);

        const datosOrden = {
            modalidad: modalidad,
            cliente_nombre: (document.getElementById('txt-wa-cliente').value || 'Cliente WhatsApp').trim(),
            telefono: (document.getElementById('txt-wa-telefono').value || '').trim(),
            direccion: esDelivery ? (document.getElementById('txt-wa-direccion').value || 'Sierra Maestra, Managua').trim() : 'Para Retirar en el Local',
            id_metodo_pago: metodoSeleccionado >= 2 ? 2 : 1,
            es_tarjeta: metodoSeleccionado === 3,
            banco: metodoSeleccionado >= 2 ? banco : null,
            referencia_transferencia: metodoSeleccionado >= 2 ? referencia : null,
            monto_recibido: montoRecibido,
            costo_delivery: costoEnvio,
            promo: promo,
            descuento_monto: descuentoMonto,
            items: items
        };

        this.aplicarOrdenEnDOMPos(datosOrden);
    },

    aplicarOrdenEnDOMPos(datosOrden) {
        if (typeof comandaCarrito !== 'undefined' && typeof actualizarCarritoUI === 'function') {
            comandaCarrito.length = 0;
            datosOrden.items.forEach(it => {
                comandaCarrito.push({
                    id_producto: it.id_producto,
                    nombre: it.nombre,
                    precio: parseFloat(it.precio),
                    cantidad: parseInt(it.cantidad, 10)
                });
            });

            if (datosOrden.modalidad === 'LLEVAR') {
                const btnLlevar = document.getElementById('btn-tipo-llevar');
                if (btnLlevar && typeof cambiarTipoServicio === 'function') cambiarTipoServicio('LLEVAR', btnLlevar);
            } else {
                const btnDel = document.getElementById('btn-tipo-delivery');
                if (btnDel && typeof cambiarTipoServicio === 'function') cambiarTipoServicio('DELIVERY', btnDel);
            }

            const txtDir = document.getElementById('txt-pos-direccion-delivery');
            if (txtDir) txtDir.value = datosOrden.direccion;
            const txtCosto = document.getElementById('txt-pos-costo-delivery');
            if (txtCosto) txtCosto.value = datosOrden.costo_delivery;

            // Aplicar promoción seleccionada al carrito del POS si existe
            if (typeof descuentoAplicado !== 'undefined') {
                if (datosOrden.promo) {
                    descuentoAplicado.id_promocion = datosOrden.promo.id_promocion;
                    descuentoAplicado.nombre = `${datosOrden.promo.codigo} - ${datosOrden.promo.nombre}`;
                    descuentoAplicado.tipo = datosOrden.promo.tipo;
                    descuentoAplicado.valor = parseFloat(datosOrden.promo.valor || 0);
                    descuentoAplicado.monto_calculado = parseFloat(datosOrden.descuento_monto || 0);
                    descuentoAplicado.motivo = `Promoción WhatsApp (${datosOrden.promo.codigo})`;
                } else if (typeof removerDescuentoAplicado === 'function') {
                    removerDescuentoAplicado();
                }
            }

            const badgeWa = document.getElementById('badge-origen-whatsapp-pos');
            const lblWa = document.getElementById('lbl-origen-whatsapp-pos');
            if (badgeWa && lblWa) {
                const etiquetaMod = datosOrden.modalidad === 'LLEVAR' ? 'Para Retirar en Local' : 'A Domicilio';
                lblWa.innerText = `WhatsApp (${etiquetaMod}): ${datosOrden.cliente_nombre}${datosOrden.telefono ? ' • ' + datosOrden.telefono : ''}`;
                badgeWa.style.display = 'flex';
            }

            if (typeof seleccionarMetodoPago === 'function') {
                seleccionarMetodoPago(datosOrden.id_metodo_pago);
            }

            if (datosOrden.id_metodo_pago === 1) {
                const inpRecibidoPOS = document.getElementById('txt-monto-recibido');
                if (inpRecibidoPOS && datosOrden.monto_recibido > 0) {
                    inpRecibidoPOS.value = datosOrden.monto_recibido;
                }
            } else {
                if (datosOrden.banco && typeof seleccionarBanco === 'function') {
                    const cardBanco = Array.from(document.querySelectorAll('.bank-card-btn')).find(el => (el.getAttribute('onclick') || '').includes(`'${datosOrden.banco}'`));
                    seleccionarBanco(datosOrden.banco, cardBanco || null);
                }
                const inpRefPOS = document.getElementById('txt-referencia-transferencia');
                if (inpRefPOS && datosOrden.referencia_transferencia) {
                    inpRefPOS.value = datosOrden.es_tarjeta ? `TARJETA-${datosOrden.referencia_transferencia}` : datosOrden.referencia_transferencia;
                }
            }

            actualizarCarritoUI();
            if (typeof calcularVueltoEnVivo === 'function') {
                calcularVueltoEnVivo();
            }
            this.cerrarModalRecepcionWhatsApp();
            if (typeof mostrarToast === 'function') {
                mostrarToast(`Pedido de WhatsApp (${datosOrden.cliente_nombre}) cargado con éxito en la Comanda POS.`, 'success');
            }
        } else {
            sessionStorage.setItem('elgustazo_wa_pedido_pos', JSON.stringify(datosOrden));
            window.location.href = 'pos.html';
        }
    },

    async registrarPedidoEnDeliveryYConfirmarWA() {
        const items = (this.ultimoPedidoParseado && this.ultimoPedidoParseado.items) ? this.ultimoPedidoParseado.items : [];
        if (items.length === 0) {
            alert('Agregue o detecte al menos un platillo antes de registrar el pedido en Delivery.');
            return;
        }

        const modalidad = (document.getElementById('sel-wa-modalidad') || {}).value || 'DELIVERY';
        const clienteNombre = (document.getElementById('txt-wa-cliente').value || 'Cliente WhatsApp').trim();
        const telefono = (document.getElementById('txt-wa-telefono').value || '').trim();
        const direccion = modalidad === 'LLEVAR' ? 'Para Retirar en Local' : (document.getElementById('txt-wa-direccion').value || 'Sierra Maestra, Managua').trim();
        const metodoSeleccionado = parseInt(document.getElementById('sel-wa-metodo-pago').value, 10) || 1;
        const banco = (document.getElementById('sel-wa-banco') || {}).value || 'BAC';
        const referencia = ((document.getElementById('txt-wa-referencia') || {}).value || '').trim();
        const montoRecibido = parseFloat((document.getElementById('num-wa-monto-recibido') || {}).value) || 0;
        const costoEnvio = modalidad === 'LLEVAR' ? 0 : (parseFloat(document.getElementById('num-wa-costo-envio').value) || 0);

        if (metodoSeleccionado >= 2 && !referencia) {
            alert('Por favor ingrese el Número de Referencia o Váucher para el pago con Transferencia / Tarjeta.');
            const refInput = document.getElementById('txt-wa-referencia');
            if (refInput) refInput.focus();
            return;
        }

        const subtotal = items.reduce((acc, i) => acc + (i.precio * i.cantidad), 0);
        const { monto: descuentoMonto, promo } = this.calcularDescuentoWA(subtotal, costoEnvio);
        const totalFinal = Math.max(0, (subtotal - descuentoMonto) + costoEnvio);

        if (metodoSeleccionado === 1 && montoRecibido > 0 && montoRecibido < totalFinal) {
            alert(`El monto con el que paga el cliente (C$ ${montoRecibido.toFixed(2)}) es menor al total de la orden (C$ ${totalFinal.toFixed(2)}).`);
            return;
        }

        let notaExtraPago = '';
        if (metodoSeleccionado === 1 && montoRecibido > totalFinal) {
            const vuelto = (montoRecibido - totalFinal).toFixed(2);
            notaExtraPago = ` | Paga con C$ ${montoRecibido.toFixed(2)} (Llevar vuelto: C$ ${vuelto})`;
        } else if (metodoSeleccionado === 2) {
            notaExtraPago = ` | Transferencia ${banco} Ref: ${referencia}`;
        } else if (metodoSeleccionado === 3) {
            notaExtraPago = ` | Tarjeta (${banco}) Ref/Váucher: ${referencia}`;
        }
        if (promo) {
            notaExtraPago += ` | Promo: ${promo.codigo} (-C$ ${descuentoMonto.toFixed(2)})`;
        }

        let usuario = null;
        try {
            usuario = JSON.parse(localStorage.getItem('elgustazo_user') || 'null');
        } catch (e) {}

        const payload = {
            id_cliente: 1,
            cliente_nombre: clienteNombre,
            telefono: telefono,
            direccion: direccion,
            origen: 'WHATSAPP',
            repartidor: null,
            notas: `Capturado desde WhatsApp Web (${modalidad === 'LLEVAR' ? 'Retira en Local' : 'A Domicilio'})${notaExtraPago}`,
            costo_delivery: costoEnvio,
            descuento: descuentoMonto,
            items: items,
            id_metodo_pago: metodoSeleccionado >= 2 ? 2 : 1,
            banco: metodoSeleccionado >= 2 ? banco : null,
            referencia_transferencia: metodoSeleccionado >= 2 ? (metodoSeleccionado === 3 ? `TARJETA-${referencia}` : referencia) : null,
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
                this.cerrarModalRecepcionWhatsApp();
                if (typeof mostrarToast === 'function') {
                    mostrarToast(`Pedido #${data.numero_pedido} registrado en Delivery desde WhatsApp.`, 'success');
                }
                if (typeof cargarTableroDelivery === 'function') {
                    cargarTableroDelivery();
                }
                if (typeof actualizarConteoDeliveryHeader === 'function') {
                    actualizarConteoDeliveryHeader();
                }

                const msgConfirmacion = this.generarConfirmacionPedidoRecibido({
                    numero_pedido: data.numero_pedido,
                    modalidad: modalidad,
                    cliente_nombre: clienteNombre,
                    direccion: direccion,
                    items: items,
                    descuento: descuentoMonto,
                    promo_nombre: promo ? promo.codigo : '',
                    costo_delivery: costoEnvio,
                    total: totalFinal,
                    id_metodo_pago: metodoSeleccionado,
                    banco: banco,
                    referencia: referencia,
                    monto_recibido: montoRecibido
                });

                if (telefono) {
                    this.enviarMensaje(telefono, msgConfirmacion);
                } else {
                    alert(`Pedido #${data.numero_pedido} registrado exitosamente en el Tablero Kanban de Delivery.`);
                }
            } else {
                alert('Error al registrar pedido: ' + (data.error || 'Verifique los datos'));
            }
        } catch (e) {
            alert('Error de conexión con el servidor local al registrar pedido de WhatsApp.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    let usuario = null;
    try {
        usuario = JSON.parse(localStorage.getItem('elgustazo_user') || 'null');
    } catch (e) {}
    const idRol = usuario ? parseInt(usuario.id_rol, 10) : 2;

    if (idRol !== 1 && idRol !== 3) {
        // Cajero: Ocultar botones de recepción de pedidos por WhatsApp; solo opera Local y Para Llevar
        ['btn-tipo-delivery', 'btn-del-capturar-wa', 'badge-origen-whatsapp-pos', 'box-pos-delivery'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        sessionStorage.removeItem('elgustazo_wa_pedido_pos');
        return;
    }

    const pendientePOS = sessionStorage.getItem('elgustazo_wa_pedido_pos');
    if (pendientePOS && typeof comandaCarrito !== 'undefined' && typeof actualizarCarritoUI === 'function') {
        try {
            const datos = JSON.parse(pendientePOS);
            sessionStorage.removeItem('elgustazo_wa_pedido_pos');
            setTimeout(() => {
                WhatsAppService.ultimoPedidoParseado = datos;
                WhatsAppService.aplicarOrdenEnDOMPos(datos);
            }, 400);
        } catch (e) {}
    }
});

window.WhatsAppService = WhatsAppService;
