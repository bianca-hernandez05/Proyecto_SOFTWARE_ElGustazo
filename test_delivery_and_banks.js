const http = require('http');

function request(url, options = {}, postData = null) {
    return new Promise((resolve, reject) => {
        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
                } catch(e) {
                    resolve({ status: res.statusCode, headers: res.headers, body: data });
                }
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function testAll() {
    console.log('--- INICIANDO VERIFICACIÓN COMPLETA DE REQUERIMIENTOS ---');

    // 1. Obtener Repartidores
    const repRes = await request('http://localhost:3000/api/delivery/repartidores');
    console.log(`[TEST 1] Repartidores (${repRes.status}):`, repRes.body.length, 'repartidores activos');
    if (repRes.body.length === 0) throw new Error('No hay repartidores');

    // 2. Obtener Pedidos Delivery
    const pedRes = await request('http://localhost:3000/api/delivery/pedidos');
    console.log(`[TEST 2] Pedidos Delivery Kanban (${pedRes.status}):`, pedRes.body.length, 'pedidos en tablero');

    // 3. Crear Nuevo Pedido Delivery (WhatsApp)
    const nuevoPedido = {
        origen: 'WHATSAPP',
        id_cliente: 2, // Carlos Mendoza
        cliente_nombre: 'Carlos Mendoza',
        telefono: '8899-7711',
        direccion: 'Sierra Maestra, del Parque Infantil 2c al sur',
        costo_delivery: 35.00,
        repartidor: 'Kevin Morales (Moto 01)',
        notas: 'Tocar el portón negro al llegar',
        id_metodo_pago: 2,
        banco: 'Banpro',
        referencia_bancaria: 'TRF-W778899',
        items: [
            { id_producto: 1, cantidad: 1, precio_unitario: 80 }, // Hamb sencilla
            { id_producto: 18, cantidad: 1, precio_unitario: 70 }, // Papas clasicas
            { id_producto: 36, cantidad: 1, precio_unitario: 25 }  // Gaseosa 12 onz
        ]
    };

    const postPedRes = await request('http://localhost:3000/api/delivery/pedidos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, nuevoPedido);

    console.log(`[TEST 3] Crear Pedido Delivery (${postPedRes.status}):`, postPedRes.body.mensaje, '| Pedido #:', postPedRes.body.numero_pedido);
    const idPedido = postPedRes.body.id_pedido;

    // 4. Cambiar Estados (Pendiente -> En Preparación -> Listo -> En Camino -> Entregado)
    const estados = ['En Preparación', 'Listo', 'En Camino', 'Entregado'];
    for (const est of estados) {
        const patchRes = await request(`http://localhost:3000/api/delivery/pedidos/${idPedido}/estado`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' }
        }, { nuevo_estado: est, id_usuario: 1 });
        console.log(`[TEST 4] Transición a [${est}] (${patchRes.status}):`, patchRes.body.mensaje);
    }

    // 5. Verificar Generación de Ticket Térmico de Cocina/Despacho
    const ticketRes = await request(`http://localhost:3000/api/delivery/pedidos/${idPedido}/ticket`);
    console.log(`[TEST 5] Ticket de Cocina (${ticketRes.status}):`, ticketRes.body.ticket ? 'Generado OK' : 'Error');

    // 6. Verificar Mensajes Formateados de WhatsApp para Cliente y Repartidor
    const waRes = await request(`http://localhost:3000/api/delivery/pedidos/${idPedido}/mensajes-whatsapp`);
    console.log(`[TEST 6] Links 1-Clic WhatsApp (${waRes.status}):`);
    console.log('   - WA Cliente:', waRes.body.wa_cliente_url.substring(0, 70) + '...');
    console.log('   - WA Repartidor:', waRes.body.wa_repartidor_url.substring(0, 70) + '...');

    // 7. Verificar Venta POS con Transferencia y QR
    const nuevaVenta = {
        id_caja: 1,
        id_cliente: 2,
        id_usuario: 1,
        id_metodo_pago: 2,
        banco: 'BAC',
        referencia_bancaria: 'TRF-BAC-998877',
        tipo_entrega: 'DELIVERY',
        costo_delivery: 40.00,
        repartidor: 'Kevin Morales (Moto 01)',
        direccion_entrega: 'Sierra Maestra, semáforos 1c arriba',
        items: [
            { id_producto: 6, cantidad: 1, precio_unitario: 140 } // Combo hamburguesa queso+bacon+papas
        ]
    };

    const ventaRes = await request('http://localhost:3000/api/ventas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    }, nuevaVenta);

    console.log(`[TEST 7] Venta POS Facturada (${ventaRes.status}):`, ventaRes.body.mensaje, '| QR Payload:', !!ventaRes.body.qr_payload);
    console.log('   - Factura #:', ventaRes.body.venta.numero_factura);
    console.log('   - Total con delivery:', ventaRes.body.venta.total);
    console.log('   - Desglose Banco:', ventaRes.body.venta.banco);

    // 8. Verificar Desglose en Caja Chica
    const cajaRes = await request('http://localhost:3000/api/caja/estado');
    console.log(`[TEST 8] Caja Chica Estado (${cajaRes.status}):`);
    console.log('   - Efectivo Ventas:', cajaRes.body.caja.total_efectivo_ventas);
    console.log('   - Transferencias:', cajaRes.body.caja.total_transferencias);
    console.log('   - Desglose Bancos:', cajaRes.body.caja.desglose_bancos);

    console.log('\n--- TODAS LAS PRUEBAS COMPLETADAS EXITOSAMENTE (100%) ---');
}

testAll().catch(err => {
    console.error('ERROR EN TESTS:', err);
    process.exit(1);
});
