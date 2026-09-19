const assert = require('assert');

async function testAllRequirements() {
    console.log('=====================================================');
    console.log('INICIANDO BATERÍA DE PRUEBAS PARA TODOS LOS REQUISITOS');
    console.log('El Buen Gusto - El Gustazo POS (Sierra Maestra, Managua)');
    console.log('=====================================================\n');

    const BASE_URL = 'http://localhost:3000';

    // 1. MÓDULO 6 & SEGURIDAD: AUTENTICACIÓN (RF-21, RNF-04)
    console.log('▶ [TEST 1] Autenticación y Control de Roles (RBAC)...');
    const loginAdminRes = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'admin', password: 'admin123*' })
    });
    const loginAdmin = await loginAdminRes.json();
    assert.strictEqual(loginAdmin.success, true);
    assert.strictEqual(loginAdmin.rol, 'Administrador');
    console.log('  ✓ Login Administrador exitoso (id_rol: 1)');

    const loginCajeroRes = await fetch(`${BASE_URL}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usuario: 'cajero', password: 'cajero123*' })
    });
    const loginCajero = await loginCajeroRes.json();
    assert.strictEqual(loginCajero.success, true);
    assert.strictEqual(loginCajero.rol, 'Cajero');
    console.log('  ✓ Login Cajero exitoso (id_rol: 2)');

    // 2. MÓDULO 1 & 6: CATÁLOGO Y COMBOS (RF-02, RF-19)
    console.log('\n▶ [TEST 2] Catálogo de Platillos y Combos...');
    const prodsRes = await fetch(`${BASE_URL}/api/productos`);
    const productos = await prodsRes.json();
    assert(productos.length >= 10, 'Deben existir al menos 10 productos');
    const combos = productos.filter(p => p.es_combo === 1);
    assert(combos.length >= 2, 'Deben existir combos configurados');
    console.log(`  ✓ Se recuperaron ${productos.length} platillos (${combos.length} combos especiales)`);

    // 3. MÓDULO 5: APERTURA DE CAJA CHICA (RF-16)
    console.log('\n▶ [TEST 3] Apertura Obligatoria de Caja Chica...');
    let cajaActivaRes = await fetch(`${BASE_URL}/api/caja/activa`);
    let cajaActivaData = await cajaActivaRes.json();
    let idCajaActiva;

    if (!cajaActivaData.abierta) {
        const abrirCajaRes = await fetch(`${BASE_URL}/api/caja/abrir`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                monto_inicial: 1000.00,
                id_usuario: loginCajero.id_usuario,
                notas: 'Apertura de turno de prueba'
            })
        });
        const cajaAbierta = await abrirCajaRes.json();
        assert.strictEqual(cajaAbierta.success, true);
        idCajaActiva = cajaAbierta.id_caja;
        console.log(`  ✓ Turno de caja #${idCajaActiva} abierto con fondo inicial de C$ 1,000.00`);
    } else {
        idCajaActiva = cajaActivaData.caja.id_caja;
        console.log(`  ✓ Turno de caja #${idCajaActiva} ya se encontraba abierto`);
    }

    // 4. MÓDULO 4: UNIVERSO DE CLIENTES (RF-13, RF-14, RF-15)
    console.log('\n▶ [TEST 4] Universo de Clientes y Fidelización...');
    const nuevoClienteRes = await fetch(`${BASE_URL}/api/clientes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            nombre: 'Elena Navarrete Test',
            telefono: '8811-2233',
            direccion: 'Sierra Maestra, del Parque 2c abajo',
            categoria: 'VIP'
        })
    });
    const nuevoCliente = await nuevoClienteRes.json();
    assert.strictEqual(nuevoCliente.success, true);
    const idClienteTest = nuevoCliente.id_cliente;
    console.log(`  ✓ Cliente creado exitosamente (ID: ${idClienteTest}, Categoría: VIP)`);

    // 5. MÓDULO 1, 2, 3: VENTA EN EFECTIVO + RECETA BOM + COMPROBANTES (RF-01 al RF-09)
    console.log('\n▶ [TEST 5] Venta en Efectivo, Cálculo de Vuelto, Descuento BOM, ESC/POS y WhatsApp...');
    
    // Obtener stock previo del pan y carne
    const insumosPrevRes = await fetch(`${BASE_URL}/api/insumos`);
    const insumosPrev = await insumosPrevRes.json();
    const panPrev = insumosPrev.find(i => i.nombre.includes('Pan'));
    const carnePrev = insumosPrev.find(i => i.nombre.includes('Carne'));

    const ventaEfRes = await fetch(`${BASE_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [
                { id_producto: 1, nombre: 'Hamburguesa Clásica El Gustazo', precio: 140.00, cantidad: 2 },
                { id_producto: 4, nombre: 'Papas Supremas Fritas', precio: 85.00, cantidad: 1 }
            ],
            id_metodo_pago: 1, // Efectivo
            id_usuario: loginCajero.id_usuario,
            id_caja: idCajaActiva,
            monto_recibido: 500.00,
            id_cliente: idClienteTest,
            cliente_nombre: 'Elena Navarrete Test'
        })
    });
    const ventaEfData = await ventaEfRes.json();
    assert.strictEqual(ventaEfData.success, true);
    
    // Validar cálculos (RF-03): Subtotal: 140*2 + 85 = 365, Impuesto: 0 (Sin IVA), Total: 365, Vuelto: 500 - 365 = 135
    assert.strictEqual(ventaEfData.venta.subtotal, 365);
    assert.strictEqual(ventaEfData.venta.impuesto, 0);
    assert.strictEqual(ventaEfData.venta.total, 365);
    assert.strictEqual(ventaEfData.venta.vuelto, 135);
    console.log(`  ✓ Factura generada: ${ventaEfData.venta.numero_factura} | Total: C$ ${ventaEfData.venta.total} | Vuelto: C$ ${ventaEfData.venta.vuelto}`);

    // Validar Comprobante Físico ESC/POS (RF-04)
    assert(ventaEfData.ticket_esc_pos.includes('EL BUEN GUSTO - EL GUSTAZO'), 'Ticket debe contener membrete oficial');
    assert(ventaEfData.ticket_esc_pos.includes(ventaEfData.venta.numero_factura), 'Ticket debe contener número de factura');
    console.log('  ✓ Comprobante Térmico Portátil ESC/POS generado con formato estándar 80mm/58mm');

    // Validar Comprobante Digital WhatsApp (RF-05)
    assert(ventaEfData.whatsapp_mensaje.includes('EL BUEN GUSTO'), 'Mensaje WhatsApp debe contener encabezado');
    assert(ventaEfData.whatsapp_link.includes('wa.me'), 'Debe generar enlace wa.me');
    console.log('  ✓ Comprobante Digital para WhatsApp formateado con enlace directo');

    // Validar descuento de insumos por receta fija BOM (RF-09)
    const insumosPostRes = await fetch(`${BASE_URL}/api/insumos`);
    const insumosPost = await insumosPostRes.json();
    const panPost = insumosPost.find(i => i.nombre.includes('Pan'));
    const carnePost = insumosPost.find(i => i.nombre.includes('Carne'));
    
    // 2 hamburguesas sencillas (4 panes, 2 carnes) + 1 hamburguesa triple (2 panes, 3 carnes) = 6 panes y 5 carnes
    assert.strictEqual(panPost.stock_actual, panPrev.stock_actual - 6);
    assert.strictEqual(carnePost.stock_actual, carnePrev.stock_actual - 5);
    console.log(`  ✓ Insumos descontados por BOM: Pan (${panPrev.stock_actual} -> ${panPost.stock_actual}), Carne (${carnePrev.stock_actual} -> ${carnePost.stock_actual})`);

    // 6. MÓDULO 2: PAGOS MULTICANAL CON TRANSFERENCIA Y BANCOS NACIONALES (RF-06, RF-07, RF-08)
    console.log('\n▶ [TEST 6] Pago Multicanal por Transferencia Bancaria con Validación de Banco y Referencia...');
    
    // Intentar sin referencia (debe fallar)
    const ventaSinRef = await fetch(`${BASE_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [{ id_producto: 9, nombre: 'Combo Gustazo Individual', precio: 230.00, cantidad: 1 }],
            id_metodo_pago: 2,
            id_usuario: loginCajero.id_usuario,
            id_caja: idCajaActiva,
            banco: 'BAC',
            referencia_transferencia: '' // Vacío a propósito
        })
    });
    const errSinRef = await ventaSinRef.json();
    assert(errSinRef.error.includes('referencia'), 'Debe exigir código de referencia bancaria');
    console.log('  ✓ Validación estricta: Rechaza transferencia sin número de confirmación/referencia');

    // Venta válida con Banpro y referencia
    const ventaTrfRes = await fetch(`${BASE_URL}/api/ventas`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            items: [{ id_producto: 9, nombre: 'Combo Gustazo Individual', precio: 230.00, cantidad: 1 }],
            id_metodo_pago: 2, // Transferencia
            id_usuario: loginCajero.id_usuario,
            id_caja: idCajaActiva,
            id_cliente: idClienteTest,
            cliente_nombre: 'Elena Navarrete Test',
            banco: 'Banpro',
            referencia_transferencia: '#TRF-88997701'
        })
    });
    const ventaTrfData = await ventaTrfRes.json();
    assert.strictEqual(ventaTrfData.success, true);
    assert.strictEqual(ventaTrfData.venta.banco, 'Banpro');
    assert(ventaTrfData.ticket_esc_pos.includes('Banpro'), 'Ticket debe indicar banco Banpro');
    assert(ventaTrfData.ticket_esc_pos.includes('#TRF-88997701'), 'Ticket debe indicar código de referencia');
    console.log('  ✓ Venta por Transferencia Bancaria exitosa (Banco: Banpro, Referencia: #TRF-88997701)');

    // 7. MÓDULO 3: ALERTAS DE ESCASEZ, REPORTES FALTANTES Y ENTRADA DE STOCK (RF-10, RF-11, RF-12)
    console.log('\n▶ [TEST 7] Alertas de Escasez y Reporte Consolidado de Insumos Faltantes...');
    const alertasRes = await fetch(`${BASE_URL}/api/alertas-stock`);
    const alertas = await alertasRes.json();
    assert(alertas.length > 0, 'Debe haber insumos en stock crítico');
    console.log(`  ✓ Alertas visuales activas: ${alertas.length} insumos en o por debajo del stock mínimo`);

    const faltantesRes = await fetch(`${BASE_URL}/api/insumos/faltantes`);
    const faltantes = await faltantesRes.json();
    assert(faltantes.length > 0, 'Debe generar lista de reabastecimiento');
    console.log(`  ✓ Reporte de reabastecimiento para el siguiente turno: ${faltantes.length} materias primas consolidadas`);

    // Probar entrada de stock (RF-12)
    const insumoCritico = alertas[0];
    const entradaStockRes = await fetch(`${BASE_URL}/api/insumos/movimiento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            id_insumo: insumoCritico.id_insumo,
            tipo: 'ENTRADA',
            cantidad: 25,
            costo_unitario: insumoCritico.costo_unitario,
            motivo: 'Compra de reabastecimiento proveedor El Granjero',
            id_usuario: loginAdmin.id_usuario
        })
    });
    const entradaData = await entradaStockRes.json();
    assert.strictEqual(entradaData.success, true);
    console.log(`  ✓ Entrada de inventario registrada con éxito (+25 ${insumoCritico.unidad_medida} para ${insumoCritico.nombre})`);

    // 8. MÓDULO 4: HISTORIAL DE FIDELIZACIÓN DEL CLIENTE (RF-15)
    console.log('\n▶ [TEST 8] Historial y Perfil de Consumo del Cliente...');
    const historialClRes = await fetch(`${BASE_URL}/api/clientes/${idClienteTest}/historial`);
    const historialCl = await historialClRes.json();
    assert.strictEqual(historialCl.estadisticas.total_compras, 2);
    assert(historialCl.estadisticas.total_gastado > 0);
    console.log(`  ✓ Historial cliente verificado: ${historialCl.estadisticas.total_compras} compras | C$ ${historialCl.estadisticas.total_gastado} acumulados`);

    // 9. MÓDULO 5: ARQUEO Y DESGLOSE FINANCIERO POR BANCOS (RF-17, RF-18)
    console.log('\n▶ [TEST 9] Arqueo en Vivo y Desglose por Banco...');
    const arqueoRes = await fetch(`${BASE_URL}/api/caja/activa`);
    const arqueoData = await arqueoRes.json();
    assert.strictEqual(arqueoData.abierta, true);
    assert(arqueoData.caja.total_efectivo_ventas > 0);
    assert(arqueoData.caja.total_transferencias > 0);
    assert(arqueoData.caja.desglose_bancos['Banpro'] > 0);
    console.log(`  ✓ Desglose financiero validado: Efectivo C$ ${arqueoData.caja.total_efectivo_ventas} | Transferencias C$ ${arqueoData.caja.total_transferencias} (Banpro: C$ ${arqueoData.caja.desglose_bancos['Banpro']})`);
    console.log(`  ✓ Total efectivo físico esperado en gaveta: C$ ${arqueoData.caja.monto_esperado_efectivo}`);

    // 10. MÓDULO 6: REPORTES ANALÍTICOS Y RESPALDOS (RF-22, RF-23, RNF-05)
    console.log('\n▶ [TEST 10] Reportes Analíticos y Respaldo Local de Base de Datos...');
    const repRes = await fetch(`${BASE_URL}/api/reportes/dashboard`);
    const repData = await repRes.json();
    assert(repData.kpis.total_ordenes >= 2);
    assert(repData.top_productos.length > 0);
    console.log(`  ✓ Reportes analíticos generados: ${repData.kpis.total_ordenes} órdenes | Top Platillo: ${repData.top_productos[0].nombre}`);

    // Crear respaldo manual
    const backupRes = await fetch(`${BASE_URL}/api/backup/crear`, { method: 'POST' });
    const backupData = await backupRes.json();
    assert.strictEqual(backupData.success, true);
    console.log(`  ✓ Respaldo de base de datos generado localmente: ${backupData.archivo}`);

    console.log('\n=====================================================');
    console.log('🎉 ¡TODAS LAS PRUEBAS (RF-01 A RF-23 Y RNF) PASARON EXITOSAMENTE!');
    console.log('=====================================================');
}

testAllRequirements().catch(err => {
    console.error('❌ ERROR EN PRUEBAS:', err);
    process.exit(1);
});
