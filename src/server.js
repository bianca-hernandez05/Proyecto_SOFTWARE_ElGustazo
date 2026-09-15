const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'js')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));
app.use(express.static(path.join(__dirname, 'public')));

// Rutas directas para navegación limpia
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Directorios de base de datos y respaldos
const dbDir = path.join(__dirname, '../database');
const backupsDir = path.join(dbDir, 'backups');
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'DB_ElGustado.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log('Conectado exitosamente a la base de datos SQLite de El Gustazo (100% Offline).');
        ejecutarRespaldoDiarioAutomatico();
    }
});

// ==========================================
// UTILIDADES: RESPALDO AUTOMÁTICO DIARIO (RF-23, RNF-05)
// ==========================================
function ejecutarRespaldoDiarioAutomatico() {
    const hoy = new Date().toISOString().slice(0, 10);
    const files = fs.readdirSync(backupsDir);
    const yaRespaldadoHoy = files.some(f => f.includes(`backup_${hoy}`));

    if (!yaRespaldadoHoy) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupDest = path.join(backupsDir, `backup_${timestamp}.db`);
        fs.copyFile(dbPath, backupDest, (err) => {
            if (err) {
                console.error('Error en respaldo automático:', err.message);
            } else {
                console.log(`Respaldo diario automático creado exitosamente: ${backupDest}`);
            }
        });
    }
}

// ==========================================
// MÓDULO 6 & SEGURIDAD: AUTENTICACIÓN Y ROLES (RF-21, RNF-04)
// ==========================================
app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Debe ingresar usuario y contraseña.' });
    }

    const query = `
        SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, r.nombre AS rol, u.estado
        FROM usuarios u
        JOIN roles r ON u.id_rol = r.id_rol
        WHERE LOWER(u.usuario) = LOWER(?) AND u.password = ? AND u.estado = 1
    `;
    db.get(query, [usuario.trim(), password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) return res.status(401).json({ error: 'Credenciales inválidas o usuario inactivo.' });
        res.json({
            success: true,
            id_usuario: row.id_usuario,
            nombre: row.nombre,
            usuario: row.usuario,
            rol: row.rol,
            id_rol: row.id_rol
        });
    });
});

app.get('/api/usuarios', (req, res) => {
    const query = `
        SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, r.nombre AS rol, u.estado, u.fecha_creacion
        FROM usuarios u
        JOIN roles r ON u.id_rol = r.id_rol
        ORDER BY u.id_usuario ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/usuarios', (req, res) => {
    const { nombre, usuario, password, id_rol } = req.body;
    if (!nombre || !usuario || !password || !id_rol) {
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }
    db.run(
        `INSERT INTO usuarios (nombre, usuario, password, id_rol, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre, usuario.trim(), password, id_rol],
        function(err) {
            if (err) return res.status(500).json({ error: 'El nombre de usuario ya existe o hubo un error: ' + err.message });
            res.json({ success: true, id_usuario: this.lastID, mensaje: 'Usuario creado exitosamente.' });
        }
    );
});

// ==========================================
// MÓDULO 1 & 6: CATÁLOGO, PRODUCTOS Y COMBOS (RF-02, RF-19)
// ==========================================
app.get('/api/categorias', (req, res) => {
    db.all(`SELECT * FROM categorias WHERE estado = 1 ORDER BY id_categoria ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/productos', (req, res) => {
    const query = `
        SELECT p.*, c.nombre AS categoria_nombre
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        WHERE p.estado = 1
        ORDER BY p.id_categoria ASC, p.nombre ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/productos/admin', (req, res) => {
    const query = `
        SELECT p.*, c.nombre AS categoria_nombre
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        ORDER BY p.id_producto DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/productos', (req, res) => {
    const { nombre, descripcion, precio, id_categoria, es_combo } = req.body;
    if (!nombre || precio === undefined || !id_categoria) {
        return res.status(400).json({ error: 'Nombre, precio y categoría son obligatorios.' });
    }
    db.run(
        `INSERT INTO productos (nombre, descripcion, precio, id_categoria, es_combo, estado) VALUES (?, ?, ?, ?, ?, 1)`,
        [nombre, descripcion || '', parseFloat(precio), parseInt(id_categoria), es_combo ? 1 : 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_producto: this.lastID, mensaje: 'Producto guardado correctamente.' });
        }
    );
});

app.put('/api/productos/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, id_categoria, es_combo, estado } = req.body;
    db.run(
        `UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, id_categoria = ?, es_combo = ?, estado = ? WHERE id_producto = ?`,
        [nombre, descripcion, parseFloat(precio), parseInt(id_categoria), es_combo ? 1 : 0, estado !== undefined ? estado : 1, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Producto actualizado correctamente.' });
        }
    );
});

// ==========================================
// MÓDULO 3 & 6: INVENTARIO, BOM Y ALERTAS (RF-09, RF-10, RF-11, RF-12, RF-20)
// ==========================================
app.get('/api/insumos', (req, res) => {
    db.all(`SELECT * FROM insumos WHERE estado = 1 ORDER BY nombre ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/insumos', (req, res) => {
    const { nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario } = req.body;
    if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida requeridos.' });
    }
    db.run(
        `INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, estado) VALUES (?, ?, ?, ?, ?, 1)`,
        [nombre, unidad_medida, parseFloat(stock_actual) || 0, parseFloat(stock_minimo) || 0, parseFloat(costo_unitario) || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_insumo: this.lastID, mensaje: 'Insumo registrado.' });
        }
    );
});

// Registro de entrada de compras o ajustes al inventario (RF-12)
app.post('/api/insumos/movimiento', (req, res) => {
    const { id_insumo, tipo, cantidad, costo_unitario, motivo, id_usuario } = req.body;
    const cantNum = parseFloat(cantidad);
    if (!id_insumo || !tipo || isNaN(cantNum) || cantNum <= 0) {
        return res.status(400).json({ error: 'Datos de movimiento inválidos.' });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        let updateQuery = `UPDATE insumos SET stock_actual = stock_actual + ?, fecha_actualizacion = CURRENT_TIMESTAMP`;
        let params = [cantNum];

        if (tipo === 'ENTRADA' && costo_unitario !== undefined && costo_unitario > 0) {
            updateQuery += `, costo_unitario = ?`;
            params.push(parseFloat(costo_unitario));
        } else if (tipo === 'SALIDA') {
            updateQuery = `UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP`;
        }

        updateQuery += ` WHERE id_insumo = ?`;
        params.push(id_insumo);

        db.run(updateQuery, params, function(err) {
            if (err) {
                db.run('ROLLBACK;');
                return res.status(500).json({ error: err.message });
            }

            db.run(
                `INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_usuario) VALUES (?, ?, ?, ?, ?)`,
                [id_insumo, tipo, cantNum, motivo || `Movimiento de ${tipo}`, id_usuario || 1],
                function(errMov) {
                    if (errMov) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errMov.message });
                    }

                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                        res.json({ success: true, mensaje: 'Inventario actualizado correctamente.' });
                    });
                }
            );
        });
    });
});

// Alertas de stock bajo en tiempo real (RF-10)
app.get('/api/alertas-stock', (req, res) => {
    const query = `
        SELECT id_insumo, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario,
               (stock_minimo - stock_actual) AS faltante
        FROM insumos
        WHERE stock_actual <= stock_minimo AND estado = 1
        ORDER BY stock_actual ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Reporte consolidado de insumos faltantes para el siguiente turno (RF-11)
app.get('/api/insumos/faltantes', (req, res) => {
    const query = `
        SELECT id_insumo, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario,
               ROUND(MAX(0, (stock_minimo * 1.5) - stock_actual), 2) AS sugerencia_reabastecer,
               ROUND(MAX(0, (stock_minimo * 1.5) - stock_actual) * costo_unitario, 2) AS costo_estimado
        FROM insumos
        WHERE stock_actual <= stock_minimo AND estado = 1
        ORDER BY (stock_minimo - stock_actual) DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Movimientos de inventario para auditoría
app.get('/api/insumos/movimientos', (req, res) => {
    const query = `
        SELECT m.*, i.nombre AS insumo_nombre, i.unidad_medida, u.nombre AS usuario_nombre
        FROM movimientos_inventario m
        JOIN insumos i ON m.id_insumo = i.id_insumo
        LEFT JOIN usuarios u ON m.id_usuario = u.id_usuario
        ORDER BY m.id_movimiento DESC
        LIMIT 100
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// Configuración de Recetas (BOM) (RF-20)
app.get('/api/recetas/:id_producto', (req, res) => {
    const { id_producto } = req.params;
    const query = `
        SELECT rd.id_receta_detalle, rd.id_receta, rd.id_insumo, rd.cantidad,
               i.nombre AS insumo_nombre, i.unidad_medida, i.costo_unitario
        FROM recetas r
        JOIN receta_detalle rd ON r.id_receta = rd.id_receta
        JOIN insumos i ON rd.id_insumo = i.id_insumo
        WHERE r.id_producto = ?
    `;
    db.all(query, [id_producto], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/recetas/:id_producto', (req, res) => {
    const { id_producto } = req.params;
    const { ingredientes } = req.body; // Array de { id_insumo, cantidad }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        // Asegurar que exista la cabecera de receta
        db.run(`INSERT OR IGNORE INTO recetas (id_producto, descripcion) VALUES (?, 'Receta Estándar')`, [id_producto], function(err) {
            if (err) {
                db.run('ROLLBACK;');
                return res.status(500).json({ error: err.message });
            }

            db.get(`SELECT id_receta FROM recetas WHERE id_producto = ?`, [id_producto], (errRec, rowRec) => {
                if (errRec || !rowRec) {
                    db.run('ROLLBACK;');
                    return res.status(500).json({ error: 'No se pudo obtener la receta.' });
                }
                const id_receta = rowRec.id_receta;

                // Limpiar detalle anterior para reconfigurar
                db.run(`DELETE FROM receta_detalle WHERE id_receta = ?`, [id_receta], (errDel) => {
                    if (errDel) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errDel.message });
                    }

                    if (ingredientes && ingredientes.length > 0) {
                        const stmt = db.prepare(`INSERT INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES (?, ?, ?)`);
                        ingredientes.forEach(ing => {
                            if (ing.id_insumo && parseFloat(ing.cantidad) > 0) {
                                stmt.run([id_receta, ing.id_insumo, parseFloat(ing.cantidad)]);
                            }
                        });
                        stmt.finalize();
                    }

                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                        res.json({ success: true, mensaje: 'Receta guardada exitosamente.' });
                    });
                });
            });
        });
    });
});

// ==========================================
// MÓDULO 4: GESTIÓN DEL UNIVERSO DE CLIENTES (RF-13, RF-14, RF-15)
// ==========================================
app.get('/api/clientes', (req, res) => {
    const { q } = req.query;
    let query = `SELECT * FROM clientes WHERE estado = 1`;
    let params = [];

    if (q) {
        query += ` AND (nombre LIKE ? OR telefono LIKE ?)`;
        params.push(`%${q}%`, `%${q}%`);
    }
    query += ` ORDER BY nombre ASC`;

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/clientes', (req, res) => {
    const { nombre, telefono, direccion, categoria } = req.body;
    if (!nombre) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }
    db.run(
        `INSERT INTO clientes (nombre, telefono, direccion, categoria, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre, telefono || '', direccion || '', categoria || 'Ocasional'],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({
                success: true,
                id_cliente: this.lastID,
                cliente: {
                    id_cliente: this.lastID,
                    nombre,
                    telefono: telefono || '',
                    direccion: direccion || '',
                    categoria: categoria || 'Ocasional'
                },
                mensaje: 'Cliente registrado exitosamente.'
            });
        }
    );
});

// Historial y perfil de consumo de un cliente (RF-15)
app.get('/api/clientes/:id/historial', (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM clientes WHERE id_cliente = ?`, [id], (errCliente, cliente) => {
        if (errCliente || !cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado.' });
        }

        const statsQuery = `
            SELECT COUNT(id_venta) AS total_compras,
                   COALESCE(SUM(total), 0) AS total_gastado,
                   COALESCE(AVG(total), 0) AS ticket_promedio,
                   MAX(fecha) AS ultima_compra
            FROM ventas
            WHERE id_cliente = ?
        `;

        db.get(statsQuery, [id], (errStats, stats) => {
            if (errStats) return res.status(500).json({ error: errStats.message });

            const ventasQuery = `
                SELECT v.id_venta, v.numero_factura, v.fecha, v.total, mp.nombre AS metodo_pago, v.banco
                FROM ventas v
                JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
                WHERE v.id_cliente = ?
                ORDER BY v.id_venta DESC
                LIMIT 20
            `;

            db.all(ventasQuery, [id], (errVentas, ventas) => {
                if (errVentas) return res.status(500).json({ error: errVentas.message });
                res.json({
                    cliente,
                    estadisticas: stats,
                    compras: ventas
                });
            });
        });
    });
});

// ==========================================
// MÓDULO 5: CONTROL FINANCIERO, CAJA CHICA Y ARQUEOS (RF-16, RF-17, RF-18)
// ==========================================

// Consulta de caja actualmente abierta
app.get('/api/caja/activa', (req, res) => {
    const query = `
        SELECT c.*, u.nombre AS cajero_nombre
        FROM cajas c
        JOIN usuarios u ON c.id_usuario_apertura = u.id_usuario
        WHERE c.estado = 'ABIERTA'
        ORDER BY c.id_caja DESC
        LIMIT 1
    `;
    db.get(query, [], (err, caja) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!caja) {
            return res.json({ abierta: false });
        }

        // Calcular desglose acumulado en vivo de ventas en este turno
        const ventasShiftQuery = `
            SELECT v.id_metodo_pago, mp.nombre AS metodo_pago, v.banco,
                   COUNT(v.id_venta) AS cantidad_ventas,
                   COALESCE(SUM(v.total), 0) AS monto_total
            FROM ventas v
            JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
            WHERE v.id_caja = ?
            GROUP BY v.id_metodo_pago, v.banco
        `;

        db.all(ventasShiftQuery, [caja.id_caja], (errV, rowsVentas) => {
            if (errV) return res.status(500).json({ error: errV.message });

            let totalEfectivo = 0;
            let totalTransferencia = 0;
            let desgloseBancos = {
                'BAC': 0,
                'Banpro': 0,
                'Lafise': 0,
                'BDF': 0,
                'Ficohsa': 0
            };

            (rowsVentas || []).forEach(r => {
                if (r.id_metodo_pago === 1) {
                    totalEfectivo += r.monto_total;
                } else if (r.id_metodo_pago === 2) {
                    totalTransferencia += r.monto_total;
                    if (r.banco && desgloseBancos.hasOwnProperty(r.banco)) {
                        desgloseBancos[r.banco] += r.monto_total;
                    }
                }
            });

            const montoEsperadoEfectivo = caja.monto_inicial + totalEfectivo;
            const totalGeneral = montoEsperadoEfectivo + totalTransferencia;

            res.json({
                abierta: true,
                caja: {
                    ...caja,
                    total_efectivo_ventas: totalEfectivo,
                    total_transferencias: totalTransferencia,
                    desglose_bancos: desgloseBancos,
                    monto_esperado_efectivo: montoEsperadoEfectivo,
                    total_general: totalGeneral
                }
            });
        });
    });
});

// Apertura de caja chica con fondo inicial obligatorio (RF-16)
app.post('/api/caja/abrir', (req, res) => {
    const { monto_inicial, id_usuario, notas } = req.body;
    const monto = parseFloat(monto_inicial);
    if (isNaN(monto) || monto < 0) {
        return res.status(400).json({ error: 'Debe ingresar un monto o fondo inicial válido.' });
    }

    // Verificar si ya hay una caja abierta
    db.get(`SELECT id_caja FROM cajas WHERE estado = 'ABIERTA'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(400).json({ error: 'Ya existe un turno de caja abierto actualmente.' });
        }

        db.run(
            `INSERT INTO cajas (monto_inicial, monto_efectivo, monto_transferencia, monto_esperado, estado, id_usuario_apertura, notas) 
             VALUES (?, 0, 0, ?, 'ABIERTA', ?, ?)`,
            [monto, monto, id_usuario || 1, notas || 'Apertura de turno'],
            function(errIns) {
                if (errIns) return res.status(500).json({ error: errIns.message });
                res.json({
                    success: true,
                    id_caja: this.lastID,
                    mensaje: 'Turno de caja chica abierto exitosamente.',
                    monto_inicial: monto
                });
            }
        );
    });
});

// Arqueo y cierre de caja chica (RF-17, RF-18)
app.post('/api/caja/cerrar', (req, res) => {
    const { id_caja, monto_real_efectivo, id_usuario_cierre, notas } = req.body;
    const efectivoReal = parseFloat(monto_real_efectivo);

    if (!id_caja || isNaN(efectivoReal) || efectivoReal < 0) {
        return res.status(400).json({ error: 'Debe indicar el efectivo físico contado en el arqueo.' });
    }

    db.get(`SELECT * FROM cajas WHERE id_caja = ? AND estado = 'ABIERTA'`, [id_caja], (err, caja) => {
        if (err || !caja) {
            return res.status(404).json({ error: 'Caja no encontrada o ya se encuentra cerrada.' });
        }

        // Consultar totales finales de ventas
        const ventasQuery = `
            SELECT v.id_metodo_pago, v.banco, COALESCE(SUM(v.total), 0) AS total_monto
            FROM ventas v
            WHERE v.id_caja = ?
            GROUP BY v.id_metodo_pago, v.banco
        `;

        db.all(ventasQuery, [id_caja], (errV, rowsVentas) => {
            if (errV) return res.status(500).json({ error: errV.message });

            let totalEfectivoVentas = 0;
            let totalTransferencias = 0;
            let desgloseBancos = { 'BAC': 0, 'Banpro': 0, 'Lafise': 0, 'BDF': 0, 'Ficohsa': 0 };

            rowsVentas.forEach(r => {
                if (r.id_metodo_pago === 1) totalEfectivoVentas += r.total_monto;
                if (r.id_metodo_pago === 2) {
                    totalTransferencias += r.total_monto;
                    if (r.banco && desgloseBancos.hasOwnProperty(r.banco)) {
                        desgloseBancos[r.banco] += r.total_monto;
                    }
                }
            });

            const montoEsperado = caja.monto_inicial + totalEfectivoVentas;
            const diferencia = parseFloat((efectivoReal - montoEsperado).toFixed(2));

            const updateQuery = `
                UPDATE cajas SET
                    fecha_cierre = CURRENT_TIMESTAMP,
                    monto_efectivo = ?,
                    monto_transferencia = ?,
                    monto_esperado = ?,
                    monto_real = ?,
                    diferencia = ?,
                    estado = 'CERRADA',
                    id_usuario_cierre = ?,
                    notas = ?
                WHERE id_caja = ?
            `;

            db.run(
                updateQuery,
                [totalEfectivoVentas, totalTransferencias, montoEsperado, efectivoReal, diferencia, id_usuario_cierre || 1, notas || '', id_caja],
                function(errUpd) {
                    if (errUpd) return res.status(500).json({ error: errUpd.message });

                    // Respaldo de seguridad automático tras el cierre de turno
                    ejecutarRespaldoDiarioAutomatico();

                    res.json({
                        success: true,
                        mensaje: 'Turno cerrado y arqueo procesado exitosamente.',
                        resumen: {
                            id_caja,
                            fondo_inicial: caja.monto_inicial,
                            ventas_efectivo: totalEfectivoVentas,
                            ventas_transferencia: totalTransferencias,
                            desglose_bancos: desgloseBancos,
                            monto_esperado: montoEsperado,
                            monto_real_contado: efectivoReal,
                            diferencia: diferencia,
                            estado_arqueo: diferencia === 0 ? 'CUADRADA' : (diferencia > 0 ? 'SOBRANTE' : 'FALTANTE')
                        }
                    });
                }
            );
        });
    });
});

// Historial de arqueos de caja
app.get('/api/caja/historial', (req, res) => {
    const query = `
        SELECT c.*, ua.nombre AS usuario_apertura, uc.nombre AS usuario_cierre
        FROM cajas c
        LEFT JOIN usuarios ua ON c.id_usuario_apertura = ua.id_usuario
        LEFT JOIN usuarios uc ON c.id_usuario_cierre = uc.id_usuario
        ORDER BY c.id_caja DESC
        LIMIT 30
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================
// MÓDULO 1 & 2: PROCESAMIENTO DE VENTAS, PAGOS MULTICANAL Y BOM
// (RF-01, RF-02, RF-03, RF-04, RF-05, RF-06, RF-07, RF-08, RF-09)
// ==========================================
app.post('/api/ventas', (req, res) => {
    const { items, id_metodo_pago, id_usuario, id_caja, monto_recibido, id_cliente, cliente_nombre, banco, referencia_transferencia } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito de ventas no contiene productos.' });
    }

    // RF-06: Métodos de pago permitidos estrictamente (1: Efectivo, 2: Transferencia)
    const metodoPago = parseInt(id_metodo_pago);
    if (metodoPago !== 1 && metodoPago !== 2) {
        return res.status(400).json({ error: 'Método de pago inválido. Solo se permite Efectivo o Transferencia Bancaria.' });
    }

    // RF-07 & RF-08: Si es transferencia, banco y referencia obligatorios
    if (metodoPago === 2) {
        const bancosPermitidos = ['BAC', 'Banpro', 'Lafise', 'BDF', 'Ficohsa'];
        if (!banco || !bancosPermitidos.includes(banco)) {
            return res.status(400).json({ error: 'Debe seleccionar un banco de destino válido: ' + bancosPermitidos.join(', ') });
        }
        if (!referencia_transferencia || referencia_transferencia.trim().length === 0) {
            return res.status(400).json({ error: 'El código de confirmación o referencia bancaria es obligatorio.' });
        }
    }

    // RF-16: Validar caja chica activa
    db.get(`SELECT id_caja FROM cajas WHERE id_caja = ? AND estado = 'ABIERTA'`, [id_caja], (errCaja, cajaActiva) => {
        if (errCaja || !cajaActiva) {
            return res.status(400).json({ error: 'No hay un turno de caja chica abierto. Debe abrir caja con fondo inicial antes de facturar.' });
        }

        // RF-03: Cálculo automático
        const subtotal = items.reduce((acc, item) => acc + (parseFloat(item.precio) * parseInt(item.cantidad)), 0);
        const impuesto = parseFloat((subtotal * 0.15).toFixed(2)); // IVA 15%
        const total = parseFloat((subtotal + impuesto).toFixed(2));

        let dineroRecibido = parseFloat(monto_recibido);
        if (metodoPago === 2) {
            dineroRecibido = total; // En transferencia el monto recibido coincide con el total
        } else if (isNaN(dineroRecibido) || dineroRecibido < total) {
            return res.status(400).json({ error: `El monto recibido (C$ ${dineroRecibido || 0}) no puede ser menor al total (C$ ${total}).` });
        }

        const vuelto = parseFloat((dineroRecibido - total).toFixed(2));
        const numeroFactura = 'FAC-' + Date.now().toString().slice(-6);

        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const insertVentaQuery = `
                INSERT INTO ventas (
                    numero_factura, subtotal, impuesto, total, monto_recibido, vuelto,
                    id_metodo_pago, id_usuario, id_caja, id_cliente, cliente_nombre,
                    banco, referencia_transferencia, tipo_comprobante, estado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TICKET', 'COMPLETADA')
            `;

            db.run(
                insertVentaQuery,
                [
                    numeroFactura, subtotal, impuesto, total, dineroRecibido, vuelto,
                    metodoPago, id_usuario || 1, id_caja, id_cliente || 1,
                    cliente_nombre || 'Consumidor Final', banco || null,
                    referencia_transferencia || null
                ],
                function(errVenta) {
                    if (errVenta) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errVenta.message });
                    }

                    const id_venta = this.lastID;
                    const detalleStmt = db.prepare(`INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);

                    // 2. Registrar Detalle e Insumos por Receta (BOM)
                    items.forEach(item => {
                        const itemCant = parseInt(item.cantidad);
                        const itemPrecio = parseFloat(item.precio);
                        detalleStmt.run([id_venta, item.id_producto, itemCant, itemPrecio, itemPrecio * itemCant]);

                        // Descuento automático por receta fija (RF-09)
                        const queryReceta = `
                            SELECT rd.id_insumo, rd.cantidad
                            FROM recetas r
                            JOIN receta_detalle rd ON r.id_receta = rd.id_receta
                            WHERE r.id_producto = ?
                        `;

                        db.all(queryReceta, [item.id_producto], (errR, ingredientes) => {
                            if (!errR && ingredientes && ingredientes.length > 0) {
                                ingredientes.forEach(ing => {
                                    const descuento = ing.cantidad * itemCant;
                                    // Descontar stock
                                    db.run(`UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_insumo = ?`, [descuento, ing.id_insumo]);

                                    // Registrar movimiento en auditoría de inventario
                                    db.run(
                                        `INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_venta, id_usuario) VALUES (?, 'SALIDA', ?, ?, ?, ?)`,
                                        [ing.id_insumo, descuento, `Venta Comanda #${numeroFactura}`, id_venta, id_usuario || 1]
                                    );
                                });
                            }
                        });
                    });

                    detalleStmt.finalize();

                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) {
                            return res.status(500).json({ error: 'Error al finalizar transacción de venta.' });
                        }

                        // Consultar datos del cliente para el comprobante
                        db.get(`SELECT telefono, nombre FROM clientes WHERE id_cliente = ?`, [id_cliente || 1], (errCl, clienteRow) => {
                            const clienteTel = clienteRow ? clienteRow.telefono : '';
                            const clienteNom = clienteRow ? clienteRow.nombre : (cliente_nombre || 'Consumidor Final');

                            // RF-04: Formato de Comprobante Físico Térmico ESC/POS
                            const ticketEscPos = generarTicketEscPos({
                                numeroFactura,
                                fecha: new Date().toLocaleString('es-NI'),
                                cliente: clienteNom,
                                items,
                                subtotal,
                                impuesto,
                                total,
                                metodoPago: metodoPago === 1 ? 'EFECTIVO' : `TRANSFERENCIA ${banco}`,
                                referencia: referencia_transferencia,
                                recibido: dineroRecibido,
                                vuelto
                            });

                            // RF-05: Formato de Comprobante Digital WhatsApp
                            const whatsappMsg = generarResumenWhatsApp({
                                numeroFactura,
                                fecha: new Date().toLocaleString('es-NI'),
                                cliente: clienteNom,
                                items,
                                subtotal,
                                impuesto,
                                total,
                                metodoPago: metodoPago === 1 ? 'Efectivo' : `Transferencia ${banco}`,
                                referencia: referencia_transferencia,
                                vuelto
                            });

                            res.json({
                                success: true,
                                mensaje: '¡Venta procesada y descontada del inventario exitosamente!',
                                venta: {
                                    id_venta,
                                    numero_factura: numeroFactura,
                                    subtotal,
                                    impuesto,
                                    total,
                                    monto_recibido: dineroRecibido,
                                    vuelto,
                                    metodo_pago: metodoPago === 1 ? 'Efectivo' : `Transferencia ${banco}`,
                                    referencia: referencia_transferencia,
                                    cliente_nombre: clienteNom,
                                    cliente_telefono: clienteTel
                                },
                                ticket_esc_pos: ticketEscPos,
                                whatsapp_mensaje: whatsappMsg,
                                whatsapp_link: `https://wa.me/${(clienteTel || '').replace(/\D/g, '')}?text=${encodeURIComponent(whatsappMsg)}`
                            });
                        });
                    });
                }
            );
        });
    });
});

// Generador de formato de Ticket Térmico Portátil ESC/POS (RF-04)
function generarTicketEscPos(data) {
    let itemsText = '';
    data.items.forEach(it => {
        const itemLine = `${it.cantidad}x ${it.nombre.padEnd(22).slice(0, 22)} C$${(it.precio * it.cantidad).toFixed(2)}\n`;
        itemsText += itemLine;
    });

    return `
========================================
       EL BUEN GUSTO - EL GUSTAZO       
      A TU PALADAR - SIERRA MAESTRA     
        Managua, Nicaragua - Offline    
========================================
FACTURA: ${data.numeroFactura}
FECHA:   ${data.fecha}
CLIENTE: ${data.cliente}
PAGO:    ${data.metodoPago}
${data.referencia ? `REF:     ${data.referencia}\n` : ''}----------------------------------------
CANT DESCRIPCION               IMPORTE
----------------------------------------
${itemsText}----------------------------------------
SUBTOTAL:                    C$ ${data.subtotal.toFixed(2)}
IVA (15%):                   C$ ${data.impuesto.toFixed(2)}
TOTAL A PAGAR:               C$ ${data.total.toFixed(2)}
========================================
RECIBIDO:                    C$ ${data.recibido.toFixed(2)}
VUELTO:                      C$ ${data.vuelto.toFixed(2)}
========================================
      ¡GRACIAS POR SU PREFERENCIA!      
     Vuelva pronto a saborear lo bueno  
========================================
\x1B\x69
`; // Código ESC/POS de corte de papel
}

// Generador de Resumen Formateado para WhatsApp (RF-05)
function generarResumenWhatsApp(data) {
    let lineas = `🍔 *EL BUEN GUSTO - EL GUSTAZO* 🍔\n` +
        `📍 *Sierra Maestra, Managua*\n` +
        `🧾 *Factura:* ${data.numeroFactura}\n` +
        `📅 *Fecha:* ${data.fecha}\n` +
        `👤 *Cliente:* ${data.cliente}\n` +
        `------------------------------------\n`;

    data.items.forEach(it => {
        lineas += `• ${it.cantidad}x ${it.nombre} - C$ ${(it.precio * it.cantidad).toFixed(2)}\n`;
    });

    lineas += `------------------------------------\n` +
        `💵 *Subtotal:* C$ ${data.subtotal.toFixed(2)}\n` +
        `📊 *IVA (15%):* C$ ${data.impuesto.toFixed(2)}\n` +
        `💰 *TOTAL PAGADO:* C$ ${data.total.toFixed(2)}\n` +
        `💳 *Método:* ${data.metodoPago}\n`;

    if (data.referencia) {
        lineas += `🔖 *Referencia Bancaria:* ${data.referencia}\n`;
    }

    if (data.vuelto > 0) {
        lineas += `🪙 *Vuelto entregado:* C$ ${data.vuelto.toFixed(2)}\n`;
    }

    lineas += `------------------------------------\n` +
        `✨ *¡Muchas gracias por su preferencia!* ✨`;

    return lineas;
}

// Historial general de ventas
app.get('/api/ventas', (req, res) => {
    const query = `
        SELECT v.*, mp.nombre AS metodo_pago_nombre, u.nombre AS cajero_nombre
        FROM ventas v
        JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
        JOIN usuarios u ON v.id_usuario = u.id_usuario
        ORDER BY v.id_venta DESC
        LIMIT 50
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

// ==========================================
// MÓDULO 6: REPORTES ANALÍTICOS ESTRATÉGICOS (RF-22)
// ==========================================
app.get('/api/reportes/dashboard', (req, res) => {
    // 1. KPIs Generales
    const kpiQuery = `
        SELECT COUNT(id_venta) AS total_ordenes,
               COALESCE(SUM(total), 0) AS ingresos_totales,
               COALESCE(AVG(total), 0) AS ticket_promedio,
               COALESCE(SUM(CASE WHEN id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS total_efectivo,
               COALESCE(SUM(CASE WHEN id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS total_transferencias
        FROM ventas
    `;

    db.get(kpiQuery, [], (err, kpis) => {
        if (err) return res.status(500).json({ error: err.message });

        // 2. Platillos y Combos más Vendidos
        const topProductosQuery = `
            SELECT p.nombre, c.nombre AS categoria,
                   SUM(vd.cantidad) AS total_vendido,
                   SUM(vd.subtotal) AS total_ingresos
            FROM venta_detalle vd
            JOIN productos p ON vd.id_producto = p.id_producto
            JOIN categorias c ON p.id_categoria = c.id_categoria
            GROUP BY vd.id_producto
            ORDER BY total_vendido DESC
            LIMIT 5
        `;

        db.all(topProductosQuery, [], (errTop, topProductos) => {
            if (errTop) return res.status(500).json({ error: errTop.message });

            // 3. Desglose detallado por banco
            const bancosQuery = `
                SELECT COALESCE(banco, 'Sin Banco') AS banco,
                       COUNT(id_venta) AS cantidad,
                       COALESCE(SUM(total), 0) AS monto
                FROM ventas
                WHERE id_metodo_pago = 2
                GROUP BY banco
            `;

            db.all(bancosQuery, [], (errBancos, desglosesBancos) => {
                if (errBancos) return res.status(500).json({ error: errBancos.message });

                // 4. Ventas por hora del día (para detectar horas pico)
                const horasQuery = `
                    SELECT strftime('%H', fecha) AS hora,
                           COUNT(id_venta) AS ordenes,
                           COALESCE(SUM(total), 0) AS total
                    FROM ventas
                    GROUP BY hora
                    ORDER BY hora ASC
                `;

                db.all(horasQuery, [], (errHoras, ventasHoras) => {
                    if (errHoras) return res.status(500).json({ error: errHoras.message });

                    res.json({
                        kpis,
                        top_productos: topProductos,
                        desglose_bancos: desglosesBancos,
                        ventas_por_hora: ventasHoras
                    });
                });
            });
        });
    });
});

// ==========================================
// MÓDULO 6 & NO FUNCIONAL: RESPALDOS LOCALES Y COPIAS DE SEGURIDAD (RF-23, RNF-05)
// ==========================================
app.get('/api/backups', (req, res) => {
    try {
        const files = fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.db'))
            .map(f => {
                const stats = fs.statSync(path.join(backupsDir, f));
                return {
                    nombre: f,
                    tamano_kb: (stats.size / 1024).toFixed(1),
                    fecha: stats.mtime
                };
            })
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/backup/crear', (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup_manual_${timestamp}.db`;
        const dest = path.join(backupsDir, filename);

        fs.copyFileSync(dbPath, dest);
        res.json({
            success: true,
            mensaje: 'Copia de seguridad local creada exitosamente.',
            archivo: filename
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al generar respaldo: ' + err.message });
    }
});

app.get('/api/backup/descargar/:archivo', (req, res) => {
    const file = path.join(backupsDir, req.params.archivo);
    if (fs.existsSync(file)) {
        res.download(file);
    } else {
        res.status(404).send('Archivo de respaldo no encontrado.');
    }
});

// Iniciar servidor local
const server = app.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🍟 Servidor El Gustazo POS Activo en http://localhost:${PORT}`);
    console.log(`⚙️  Modo: 100% Offline | DB: SQLite3 | Sierra Maestra`);
    console.log(`=======================================================`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        db.close();
    });
});