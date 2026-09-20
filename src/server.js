const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

function getLocalIpAddress() {
    const interfaces = os.networkInterfaces();
    let candidates = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                // Descartar adaptadores virtuales de VirtualBox o APIPA
                if (iface.address.startsWith('192.168.56.') || iface.address.startsWith('169.254.')) {
                    continue;
                }
                candidates.push({ name, address: iface.address });
            }
        }
    }
    // Priorizar interfaz Wi-Fi (usada comúnmente en restaurantes y celulares)
    const wifi = candidates.find(c => /wi-?fi/i.test(c.name));
    if (wifi) return wifi.address;

    // Luego interfaz Ethernet cableada
    const eth = candidates.find(c => /ethernet/i.test(c.name));
    if (eth) return eth.address;

    if (candidates.length > 0) return candidates[0].address;
    return '127.0.0.1';
}

app.use(express.json());
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));
app.use(express.static(path.join(__dirname, 'public')));

// Información del servidor para escaneo QR móvil en red local
app.get('/api/server-info', (req, res) => {
    const ip = getLocalIpAddress();
    res.json({
        ip,
        port: PORT,
        baseUrl: `http://${ip}:${PORT}`
    });
});

// Guardar archivo PDF del menú en servidor para descarga directa desde enlace WhatsApp
app.post('/api/menu/guardar-pdf', express.raw({ type: 'application/pdf', limit: '20mb' }), (req, res) => {
    const pdfPath = path.join(__dirname, 'public', 'Menu_Oficial_El_Gustazo.pdf');
    fs.writeFile(pdfPath, req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, url: '/Menu_Oficial_El_Gustazo.pdf' });
    });
});

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
        // Migración preventiva de columna archivado en pedidos_delivery
        db.run(`ALTER TABLE pedidos_delivery ADD COLUMN archivado INTEGER DEFAULT 0`, () => {});
    }
});

// ==========================================
// UTILIDADES: RESPALDO AUTOMÁTICO DIARIO Y GESTIÓN DE ESPACIO (RF-23, RNF-05)
// ==========================================
function purgarRespaldosAntiguos(dejarMax = 1) {
    try {
        if (!fs.existsSync(backupsDir)) return;
        const files = fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.db'))
            .map(f => {
                const full = path.join(backupsDir, f);
                return {
                    name: f,
                    fullPath: full,
                    time: fs.statSync(full).mtime.getTime()
                };
            })
            .sort((a, b) => b.time - a.time); // Más reciente primero

        if (files.length > dejarMax) {
            const sobrantes = files.slice(dejarMax);
            sobrantes.forEach(fileObj => {
                try {
                    fs.unlinkSync(fileObj.fullPath);
                    console.log(`[Respaldos] Eliminado respaldo antiguo para optimizar espacio: ${fileObj.name} (se conserva solo 1)`);
                } catch (e) {
                    console.error('Error eliminando respaldo viejo:', e.message);
                }
            });
        }
    } catch (e) {
        console.error('Error al purgar respaldos antiguos:', e.message);
    }
}

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
                purgarRespaldosAntiguos(1);
            }
        });
    } else {
        purgarRespaldosAntiguos(1);
    }
}

// ==========================================
// MÓDULO 6 & SEGURIDAD: AUTENTICACIÓN Y ROLES (RF-21, RNF-04)
// ==========================================
// Control en memoria para protección contra ataques de fuerza bruta y robos de acceso
const loginAttemptsMap = new Map();

app.post('/api/login', (req, res) => {
    const { usuario, password } = req.body;
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Debe ingresar usuario y contraseña.' });
    }

    const cleanUser = usuario.trim().toLowerCase();
    const clientIp = req.ip || req.connection.remoteAddress || 'localhost';
    const attemptKey = `${clientIp}_${cleanUser}`;
    const now = Date.now();

    const attemptInfo = loginAttemptsMap.get(attemptKey);
    if (attemptInfo && attemptInfo.lockUntil && now < attemptInfo.lockUntil) {
        const segRestantes = Math.ceil((attemptInfo.lockUntil - now) / 1000);
        return res.status(429).json({
            error: `Acceso bloqueado por seguridad ante múltiples intentos fallidos. Espere ${segRestantes} segundos para reintentar.`
        });
    }

    const query = `
        SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, r.nombre AS rol, u.estado
        FROM usuarios u
        JOIN roles r ON u.id_rol = r.id_rol
        WHERE LOWER(u.usuario) = ? AND u.password = ? AND u.estado = 1
    `;
    db.get(query, [cleanUser, password], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            const currentAttempts = (attemptInfo ? attemptInfo.attempts : 0) + 1;
            let lockUntil = null;
            if (currentAttempts >= 3) {
                lockUntil = now + 30000; // Bloqueo de 30 segundos
            }
            loginAttemptsMap.set(attemptKey, { attempts: currentAttempts >= 3 ? 0 : currentAttempts, lockUntil });

            const msg = lockUntil
                ? 'Demasiados intentos fallidos. Acceso bloqueado preventivamente durante 30 segundos para evitar robo de sesión.'
                : `Credenciales incorrectas (Intento ${currentAttempts} de 3). Verifique su usuario, contraseña y caracteres especiales.`;
            return res.status(401).json({ error: msg, intentos_fallidos: currentAttempts });
        }

        // Login exitoso: limpiar historial de intentos
        loginAttemptsMap.delete(attemptKey);

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

// Middleware de Control de Acceso Basado en Roles (RBAC - Módulo 6)
// El Administrador (id_rol: 1) posee privilegios completos de agregar, modificar, actualizar y eliminar.
// El Cajero (id_rol: 2) tiene estrictamente prohibido el acceso a funciones administrativas del Módulo 6:
// - Modificar precios, crear o desactivar platillos y combos del catálogo.
// - Configurar o alterar las recetas fijas (BOM) de insumos.
// - Visualizar reportes analíticos de ventas globales, ingresos totales o ganancias.
// - Gestionar la creación de nuevos usuarios o realizar copias de seguridad del sistema.
// - Eliminar registros (productos, insumos, clientes, repartidores, usuarios).
function verificarAdmin(req, res, next) {
    const rolHeader = req.headers['x-user-role'];
    const idRol = rolHeader !== undefined ? parseInt(rolHeader, 10) : (req.body && req.body.id_rol_solicitante ? parseInt(req.body.id_rol_solicitante, 10) : null);

    // Si explícitamente se identifica como Cajero (id_rol: 2) o cualquier rol distinto de Administrador (id_rol: 1)
    if (idRol === 2 || (idRol !== null && !isNaN(idRol) && idRol !== 1)) {
        return res.status(403).json({
            error: 'Acceso Prohibido: Las funciones administrativas del Módulo 6 (catálogo, precios, recetas BOM, reportes globales, usuarios y respaldos) están reservadas exclusivamente para el Administrador.',
            codigo: 'ACCESO_DENEGADO_MODULO6'
        });
    }

    next();
}

app.get('/api/usuarios', verificarAdmin, (req, res) => {
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

app.post('/api/usuarios', verificarAdmin, (req, res) => {
    const { nombre, usuario, password, id_rol } = req.body;
    if (!nombre || !usuario || !password || !id_rol) {
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    // Validación de seguridad de contraseña (mínimo 8 caracteres, números y caracteres especiales)
    const tieneEspecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const tieneNumero = /\d/.test(password);
    if (password.length < 8 || !tieneNumero || !tieneEspecial) {
        return res.status(400).json({
            error: 'Por seguridad para evitar robos de cuenta, la contraseña debe tener al menos 8 caracteres, incluir números y al menos un carácter especial (*, #, @, etc.).'
        });
    }

    db.run(
        `INSERT INTO usuarios (nombre, usuario, password, id_rol, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre, usuario.trim(), password, id_rol],
        function(err) {
            if (err) return res.status(500).json({ error: 'El nombre de usuario ya existe o hubo un error: ' + err.message });
            res.json({ success: true, id_usuario: this.lastID, mensaje: 'Usuario creado exitosamente con credenciales seguras.' });
        }
    );
});

// Desactivar / Eliminar usuario
app.delete('/api/usuarios/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    if (parseInt(id) === 1) {
        return res.status(400).json({ error: 'El usuario administrador principal no puede ser eliminado.' });
    }
    db.run(`UPDATE usuarios SET estado = 0 WHERE id_usuario = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json({ success: true, mensaje: 'Usuario desactivado exitosamente.' });
    });
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

app.get('/api/productos/admin', verificarAdmin, (req, res) => {
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

app.post('/api/productos', verificarAdmin, (req, res) => {
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

app.put('/api/productos/:id', verificarAdmin, (req, res) => {
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

// Eliminar producto (soft delete para mantener historial de ventas)
app.delete('/api/productos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE productos SET estado = 0 WHERE id_producto = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Producto no encontrado.' });
        res.json({ success: true, mensaje: 'Producto eliminado exitosamente del catálogo.' });
    });
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

app.post('/api/insumos', verificarAdmin, (req, res) => {
    const { nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario } = req.body;
    if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida requeridos.' });
    }
    db.run(
        `INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, estado) VALUES (?, ?, ?, ?, ?, 1)`,
        [nombre, unidad_medida, parseFloat(stock_actual) || 0, parseFloat(stock_minimo) || 0, parseFloat(costo_unitario) || 0],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_insumo: this.lastID, mensaje: 'Insumo registrado exitosamente.' });
        }
    );
});

// Actualizar insumo (Módulo 3 & 6)
app.put('/api/insumos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, unidad_medida, stock_minimo, costo_unitario } = req.body;
    if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida requeridos.' });
    }
    db.run(
        `UPDATE insumos SET nombre = ?, unidad_medida = ?, stock_minimo = ?, costo_unitario = ? WHERE id_insumo = ?`,
        [nombre.trim(), unidad_medida.trim(), parseFloat(stock_minimo) || 0, parseFloat(costo_unitario) || 0, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado.' });
            res.json({ success: true, mensaje: 'Insumo actualizado exitosamente.' });
        }
    );
});

// Eliminar insumo (soft delete)
app.delete('/api/insumos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE insumos SET estado = 0 WHERE id_insumo = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado.' });
        res.json({ success: true, mensaje: 'Insumo eliminado exitosamente.' });
    });
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

// Alertas de stock bajo en tiempo real (RF-10) - Umbral crítico en 200 y mínimo en 100
app.get('/api/alertas-stock', (req, res) => {
    const query = `
        SELECT id_insumo, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario,
               (CASE WHEN stock_actual < 200 THEN (200 - stock_actual) ELSE (stock_minimo - stock_actual) END) AS faltante
        FROM insumos
        WHERE (stock_actual <= stock_minimo OR stock_actual < 200) AND estado = 1
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
               ROUND(MAX(0, (CASE WHEN stock_minimo < 100 THEN 250 ELSE stock_minimo * 2 END) - stock_actual), 2) AS sugerencia_reabastecer,
               ROUND(MAX(0, (CASE WHEN stock_minimo < 100 THEN 250 ELSE stock_minimo * 2 END) - stock_actual) * costo_unitario, 2) AS costo_estimado
        FROM insumos
        WHERE (stock_actual <= stock_minimo OR stock_actual < 200) AND estado = 1
        ORDER BY stock_actual ASC
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

app.post('/api/recetas/:id_producto', verificarAdmin, (req, res) => {
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

// Actualizar datos de un cliente
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, telefono, direccion, categoria } = req.body;

    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    db.run(
        `UPDATE clientes SET nombre = ?, telefono = ?, direccion = ?, categoria = ? WHERE id_cliente = ?`,
        [nombre.trim(), telefono ? telefono.trim() : '', direccion ? direccion.trim() : '', categoria || 'Ocasional', id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
            res.json({
                success: true,
                mensaje: 'Cliente actualizado exitosamente.',
                cliente: {
                    id_cliente: parseInt(id),
                    nombre: nombre.trim(),
                    telefono: telefono ? telefono.trim() : '',
                    direccion: direccion ? direccion.trim() : '',
                    categoria: categoria || 'Ocasional'
                }
            });
        }
    );
});

// Eliminar cliente (con eliminación permanente si no tiene ventas, o soft-delete si tiene historial)
app.delete('/api/clientes/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const idNum = parseInt(id);

    if (idNum === 1) {
        return res.status(400).json({ error: 'No se puede eliminar el Consumidor Final predeterminado.' });
    }

    db.get('SELECT COUNT(*) as count FROM ventas WHERE id_cliente = ?', [idNum], (errV, rowV) => {
        if (!errV && rowV && rowV.count > 0) {
            // Si tiene ventas vinculadas, desactivar para no romper el historial contable
            db.run(`UPDATE clientes SET estado = 0 WHERE id_cliente = ?`, [idNum], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
                res.json({ success: true, mensaje: 'Cliente eliminado exitosamente del catálogo activo.' });
            });
        } else {
            // Si no tiene ventas, eliminarlo permanentemente
            db.run(`DELETE FROM clientes WHERE id_cliente = ?`, [idNum], function(err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
                res.json({ success: true, mensaje: 'Cliente eliminado permanentemente.' });
            });
        }
    });
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
app.get(['/api/caja/activa', '/api/caja/estado'], (req, res) => {
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
// MÓDULO: PROCESAMIENTO DE VENTAS, FACTURACIÓN Y BOM
// ==========================================
app.post('/api/ventas', (req, res) => {
    const {
        items, id_metodo_pago, id_usuario, id_caja, monto_recibido,
        id_cliente, cliente_nombre, banco, referencia_transferencia,
        tipo_entrega, costo_delivery, repartidor, direccion_entrega,
        origen_pedido, telefono_cliente, notas_delivery
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito de ventas no contiene productos.' });
    }

    const metodoPago = parseInt(id_metodo_pago);
    if (metodoPago !== 1 && metodoPago !== 2) {
        return res.status(400).json({ error: 'Método de pago inválido. Solo se permite Efectivo o Transferencia Bancaria.' });
    }

    const refTransf = (referencia_transferencia || req.body.referencia_bancaria || req.body.referencia || '').trim();

    if (metodoPago === 2) {
        const bancosPermitidos = ['BAC', 'Banpro', 'Lafise', 'BDF', 'Ficohsa'];
        if (!banco || !bancosPermitidos.includes(banco)) {
            return res.status(400).json({ error: 'Debe seleccionar un banco de destino válido: ' + bancosPermitidos.join(', ') });
        }
        if (!refTransf || refTransf.length === 0) {
            return res.status(400).json({ error: 'El código de confirmación o referencia bancaria es obligatorio.' });
        }
    }

    const checkCajaSql = id_caja
        ? `SELECT id_caja FROM cajas WHERE id_caja = ? AND estado = 'ABIERTA'`
        : `SELECT id_caja FROM cajas WHERE estado = 'ABIERTA' ORDER BY id_caja DESC LIMIT 1`;
    const checkCajaParams = id_caja ? [id_caja] : [];

    db.get(checkCajaSql, checkCajaParams, (errCaja, cajaActiva) => {
        if (errCaja || !cajaActiva) {
            return res.status(400).json({ error: 'No hay un turno de caja chica abierto. Debe abrir caja con fondo inicial antes de facturar.' });
        }

        const activeCajaId = cajaActiva.id_caja;
        const subtotal = items.reduce((acc, item) => acc + (parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad || 1)), 0);
        const envio = parseFloat(costo_delivery) || 0;
        const impuesto = 0.00; // Sin IVA
        const total = parseFloat((subtotal + envio).toFixed(2));

        let dineroRecibido = parseFloat(monto_recibido);
        if (metodoPago === 2) {
            dineroRecibido = total;
        } else if (isNaN(dineroRecibido) || dineroRecibido < total) {
            return res.status(400).json({ error: `El monto recibido (C$ ${dineroRecibido || 0}) no puede ser menor al total (C$ ${total}).` });
        }

        const vuelto = parseFloat((dineroRecibido - total).toFixed(2));
        const numeroFactura = 'FAC-' + Date.now().toString().slice(-6);

        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const insertVentaQuery = `
                INSERT INTO ventas (
                    numero_factura, subtotal, costo_delivery, impuesto, total, monto_recibido, vuelto,
                    id_metodo_pago, id_usuario, id_caja, id_cliente, cliente_nombre,
                    telefono_cliente, tipo_entrega, origen_pedido, direccion_entrega, repartidor, notas_delivery,
                    banco, referencia_transferencia, tipo_comprobante, estado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TICKET', 'COMPLETADA')
            `;

            db.run(
                insertVentaQuery,
                [
                    numeroFactura, subtotal, envio, impuesto, total, dineroRecibido, vuelto,
                    metodoPago, id_usuario || 1, activeCajaId, id_cliente || 1,
                    cliente_nombre || 'Consumidor Final', telefono_cliente || '',
                    tipo_entrega || 'LOCAL', origen_pedido || 'MOSTRADOR',
                    direccion_entrega || '', repartidor || '', notas_delivery || '',
                    banco || null, refTransf || null
                ],
                function(errVenta) {
                    if (errVenta) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errVenta.message });
                    }

                    const id_venta = this.lastID;
                    const detalleStmt = db.prepare(`INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);

                    items.forEach(item => {
                        const itemCant = parseInt(item.cantidad || 1);
                        const itemPrecio = parseFloat(item.precio || item.precio_unitario || 0);
                        detalleStmt.run([id_venta, item.id_producto, itemCant, itemPrecio, itemPrecio * itemCant]);

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
                                    db.run(`UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_insumo = ?`, [descuento, ing.id_insumo]);

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

                        db.get(`SELECT telefono, nombre, direccion FROM clientes WHERE id_cliente = ?`, [id_cliente || 1], (errCl, clienteRow) => {
                            const clienteTel = telefono_cliente || (clienteRow ? clienteRow.telefono : '');
                            const clienteNom = cliente_nombre || (clienteRow ? clienteRow.nombre : 'Consumidor Final');
                            const dirEntrega = direccion_entrega || (clienteRow ? clienteRow.direccion : '');

                            const ticketData = {
                                numeroFactura,
                                fecha: new Date().toLocaleString('es-NI'),
                                cliente: clienteNom,
                                telefono: clienteTel,
                                direccion: dirEntrega,
                                tipoEntrega: tipo_entrega || 'LOCAL',
                                repartidor: repartidor || '',
                                items,
                                subtotal,
                                envio,
                                impuesto,
                                total,
                                metodoPago: metodoPago === 1 ? 'EFECTIVO' : `TRANSFERENCIA ${banco}`,
                                referencia: referencia_transferencia,
                                recibido: dineroRecibido,
                                vuelto
                            };

                            const ticketEscPos = generarTicketEscPos(ticketData);

                            // El código QR codifica el enlace web directo a la factura digital para que al escanearlo se vea la factura tal como en el PDF
                            const localIp = getLocalIpAddress();
                            const baseUrl = `http://${localIp}:${PORT}`;
                            const digitalLink = `${baseUrl}/comprobante.html?fac=${numeroFactura}`;
                            const qrPayload = digitalLink;

                            // Sincronización automática con Módulo de Delivery (evitar retrabajo)
                            let id_pedido_delivery = null;
                            let numero_pedido_delivery = null;

                            if (tipo_entrega === 'DELIVERY') {
                                numero_pedido_delivery = 'DEL-' + numeroFactura.replace('FAC-', '');
                                const estadoDelivery = repartidor ? 'EN_CAMINO' : 'EN_PREPARACION';

                                db.run(`
                                    INSERT INTO pedidos_delivery (
                                        numero_pedido, id_cliente, cliente_nombre, telefono, direccion,
                                        origen, estado, repartidor, id_repartidor, notas, costo_delivery,
                                        subtotal, impuesto, total, id_metodo_pago, banco, referencia_transferencia,
                                        id_caja, id_usuario, id_venta
                                    ) VALUES (?, ?, ?, ?, ?, 'POS', ?, ?, null, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)
                                `, [
                                    numero_pedido_delivery, id_cliente || null, clienteNom,
                                    clienteTel, dirEntrega, estadoDelivery, repartidor || null,
                                    notas_delivery || '', envio, subtotal, total, metodoPago,
                                    banco || null, refTransf || null, activeCajaId, id_usuario || 1, id_venta
                                ], function(errDel) {
                                    if (!errDel && this.lastID) {
                                        id_pedido_delivery = this.lastID;
                                        const delStmt = db.prepare(`INSERT INTO pedido_delivery_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);
                                        items.forEach(it => {
                                            const itCant = parseInt(it.cantidad || 1);
                                            const itPrec = parseFloat(it.precio || it.precio_unitario || 0);
                                            delStmt.run([id_pedido_delivery, it.id_producto, itCant, itPrec, itCant * itPrec]);
                                        });
                                        delStmt.finalize();
                                    }
                                });
                            }

                            res.json({
                                success: true,
                                mensaje: 'Venta procesada e inventario actualizado exitosamente.',
                                venta: {
                                    id_venta,
                                    numero_factura: numeroFactura,
                                    fecha: ticketData.fecha,
                                    subtotal,
                                    costo_delivery: envio,
                                    impuesto,
                                    total,
                                    monto_recibido: dineroRecibido,
                                    vuelto,
                                    metodo_pago: metodoPago === 1 ? 'Efectivo' : `Transferencia ${banco}`,
                                    banco: banco,
                                    referencia: referencia_transferencia,
                                    tipo_entrega: tipo_entrega || 'LOCAL',
                                    repartidor: repartidor || '',
                                    cliente_nombre: clienteNom,
                                    cliente_telefono: clienteTel,
                                    direccion_entrega: dirEntrega,
                                    items: items
                                },
                                es_delivery: tipo_entrega === 'DELIVERY',
                                numero_pedido_delivery: numero_pedido_delivery,
                                qr_payload: qrPayload,
                                digital_link: digitalLink,
                                ticket_esc_pos: ticketEscPos
                            });
                        });
                    });
                }
            );
        });
    });
});

// Conteo de pedidos activos de delivery para notificaciones en vivo
app.get('/api/delivery/conteo-activos', (req, res) => {
    db.get(`
        SELECT COUNT(*) AS total_activos,
               COALESCE(SUM(CASE WHEN estado = 'PENDIENTE' THEN 1 ELSE 0 END), 0) AS pendientes,
               COALESCE(SUM(CASE WHEN estado = 'EN_PREPARACION' THEN 1 ELSE 0 END), 0) AS preparacion,
               COALESCE(SUM(CASE WHEN estado = 'EN_CAMINO' THEN 1 ELSE 0 END), 0) AS en_camino
        FROM pedidos_delivery
        WHERE estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO')
    `, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row || { total_activos: 0, pendientes: 0, preparacion: 0, en_camino: 0 });
    });
});

// 1. Listado de pedidos delivery
app.get('/api/delivery/pedidos', (req, res) => {
    const { estado, ver_archivados } = req.query;
    let query = `
        SELECT p.*, c.nombre AS cliente_registrado_nombre, c.categoria AS cliente_categoria
        FROM pedidos_delivery p
        LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
    `;
    let params = [];
    let conditions = [];

    if (ver_archivados === '1' || ver_archivados === 'true') {
        conditions.push(`p.archivado = 1`);
    } else {
        conditions.push(`(p.archivado IS NULL OR p.archivado = 0)`);
    }

    if (estado && estado !== 'TODOS') {
        conditions.push(`p.estado = ?`);
        params.push(estado);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }

    query += ` ORDER BY p.id_pedido DESC LIMIT 100`;

    db.all(query, params, (err, pedidos) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!pedidos || pedidos.length === 0) return res.json([]);

        const ids = pedidos.map(p => p.id_pedido);
        const placeholders = ids.map(() => '?').join(',');
        const itemsQuery = `
            SELECT d.*, pr.nombre AS producto_nombre, pr.precio
            FROM pedido_delivery_detalle d
            JOIN productos pr ON d.id_producto = pr.id_producto
            WHERE d.id_pedido IN (${placeholders})
        `;

        db.all(itemsQuery, ids, (errItems, items) => {
            if (errItems) return res.status(500).json({ error: errItems.message });
            
            const pedidosConItems = pedidos.map(p => ({
                ...p,
                items: (items || []).filter(it => it.id_pedido === p.id_pedido)
            }));
            res.json(pedidosConItems);
        });
    });
});

// 2. Registro de nuevo pedido delivery (WhatsApp o Llamada)
app.post('/api/delivery/pedidos', (req, res) => {
    const {
        id_cliente, cliente_nombre, telefono, direccion, origen,
        repartidor, id_repartidor, notas, costo_delivery, items,
        id_metodo_pago, banco, referencia_transferencia, id_caja, id_usuario
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El pedido debe incluir al menos un platillo o combo.' });
    }
    if (!cliente_nombre || !direccion) {
        return res.status(400).json({ error: 'El nombre del cliente y la dirección exacta en Sierra Maestra son requeridos.' });
    }

    const subtotal = items.reduce((acc, it) => acc + (parseFloat(it.precio || it.precio_unitario || 0) * parseInt(it.cantidad || 1)), 0);
    const envio = parseFloat(costo_delivery) || 0;
    const impuesto = 0.00; // Sin IVA
    const total = parseFloat((subtotal + envio).toFixed(2));
    const numeroPedido = 'DEL-' + Date.now().toString().slice(-4);

    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        const insertQuery = `
            INSERT INTO pedidos_delivery (
                numero_pedido, id_cliente, cliente_nombre, telefono, direccion,
                origen, estado, repartidor, id_repartidor, notas, costo_delivery,
                subtotal, impuesto, total, id_metodo_pago, banco, referencia_transferencia,
                id_caja, id_usuario
            ) VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

        db.run(
            insertQuery,
            [
                numeroPedido, id_cliente || null, cliente_nombre.trim(), telefono || '', direccion.trim(),
                origen || 'WHATSAPP', repartidor || null, id_repartidor || null, notas || '',
                envio, subtotal, impuesto, total, id_metodo_pago || 1, banco || null,
                referencia_transferencia || null, id_caja || null, id_usuario || 1
            ],
            function(errIns) {
                if (errIns) {
                    db.run('ROLLBACK;');
                    return res.status(500).json({ error: errIns.message });
                }

                const id_pedido = this.lastID;
                const detStmt = db.prepare(`INSERT INTO pedido_delivery_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);

                items.forEach(it => {
                    const cant = parseInt(it.cantidad || 1);
                    const prec = parseFloat(it.precio || it.precio_unitario || 0);
                    detStmt.run([id_pedido, it.id_producto, cant, prec, cant * prec]);

                    const queryReceta = `
                        SELECT rd.id_insumo, rd.cantidad
                        FROM recetas r
                        JOIN receta_detalle rd ON r.id_receta = rd.id_receta
                        WHERE r.id_producto = ?
                    `;
                    db.all(queryReceta, [it.id_producto], (errR, ingredientes) => {
                        if (!errR && ingredientes && ingredientes.length > 0) {
                            ingredientes.forEach(ing => {
                                const desc = ing.cantidad * cant;
                                db.run(`UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_insumo = ?`, [desc, ing.id_insumo]);
                                db.run(
                                    `INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_pedido_delivery, id_usuario) VALUES (?, 'SALIDA', ?, ?, ?, ?)`,
                                    [ing.id_insumo, desc, `Pedido Delivery #${numeroPedido}`, id_pedido, id_usuario || 1]
                                );
                            });
                        }
                    });
                });

                detStmt.finalize();

                db.run('COMMIT;', (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: commitErr.message });

                    res.json({
                        success: true,
                        mensaje: 'Pedido de delivery registrado correctamente.',
                        id_pedido,
                        numero_pedido: numeroPedido,
                        subtotal,
                        costo_delivery: envio,
                        impuesto,
                        total
                    });
                });
            }
        );
    });
});

// 3. Cambio de estado de un pedido delivery (PENDIENTE -> EN_PREPARACION -> LISTO -> EN_CAMINO -> ENTREGADO)
app.patch('/api/delivery/pedidos/:id/estado', (req, res) => {
    const { id } = req.params;
    const { estado, nuevo_estado, repartidor, id_repartidor, id_caja, id_usuario } = req.body;

    const rawEstado = (estado || nuevo_estado || '').trim().toUpperCase().replace(/ /g, '_').replace(/Ó/g, 'O');
    const mapEstados = {
        'PENDIENTE': 'PENDIENTE',
        'EN_PREPARACION': 'EN_PREPARACION',
        'LISTO': 'LISTO',
        'EN_CAMINO': 'EN_CAMINO',
        'ENTREGADO': 'ENTREGADO',
        'CANCELADO': 'CANCELADO'
    };

    const targetEstado = mapEstados[rawEstado];
    if (!targetEstado) {
        return res.status(400).json({ error: 'Estado de pedido no válido: ' + (estado || nuevo_estado) });
    }

    db.get(`SELECT * FROM pedidos_delivery WHERE id_pedido = ?`, [id], (err, pedido) => {
        if (err || !pedido) return res.status(404).json({ error: 'Pedido no encontrado.' });

        let sql = `UPDATE pedidos_delivery SET estado = ?`;
        let params = [targetEstado];

        if (repartidor) {
            sql += `, repartidor = ?`;
            params.push(repartidor);
        }
        if (id_repartidor) {
            sql += `, id_repartidor = ?`;
            params.push(id_repartidor);
        }
        if (estado === 'ENTREGADO') {
            sql += `, fecha_entrega = CURRENT_TIMESTAMP`;
        }
        sql += ` WHERE id_pedido = ?`;
        params.push(id);

        db.run(sql, params, function(errUpd) {
            if (errUpd) return res.status(500).json({ error: errUpd.message });

            // Si se marca como ENTREGADO y aún no tiene venta registrada, vincular a ventas para arqueo de caja
            if (estado === 'ENTREGADO' && !pedido.id_venta) {
                db.get(`SELECT id_caja FROM cajas WHERE estado = 'ABIERTA' ORDER BY id_caja DESC LIMIT 1`, [], (errC, cajaActiva) => {
                    const cajaId = (cajaActiva ? cajaActiva.id_caja : (id_caja || pedido.id_caja || 1));
                    const numFac = 'FAC-' + Date.now().toString().slice(-6);

                    db.run(
                        `INSERT INTO ventas (
                            numero_factura, subtotal, costo_delivery, impuesto, total, monto_recibido, vuelto,
                            id_metodo_pago, id_usuario, id_caja, id_cliente, cliente_nombre, telefono_cliente,
                            tipo_entrega, origen_pedido, direccion_entrega, repartidor, notas_delivery,
                            banco, referencia_transferencia, tipo_comprobante, estado
                        ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, 'DELIVERY', ?, ?, ?, ?, ?, ?, 'TICKET', 'COMPLETADA')`,
                        [
                            numFac, pedido.subtotal, pedido.costo_delivery, pedido.impuesto, pedido.total, pedido.total,
                            pedido.id_metodo_pago, id_usuario || pedido.id_usuario || 1, cajaId, pedido.id_cliente,
                            pedido.cliente_nombre, pedido.telefono, pedido.origen, pedido.direccion,
                            repartidor || pedido.repartidor || '', pedido.notas,
                            pedido.banco, pedido.referencia_transferencia
                        ],
                        function(errVenta) {
                            if (!errVenta) {
                                const idVenta = this.lastID;
                                db.run(`UPDATE pedidos_delivery SET id_venta = ? WHERE id_pedido = ?`, [idVenta, id]);
                            }
                        }
                    );
                });
            }

            res.json({ success: true, mensaje: `Estado actualizado a ${estado}`, nuevo_estado: estado });
        });
    });
});

// 4. Repartidores disponibles
app.get('/api/delivery/repartidores', (req, res) => {
    db.all(`SELECT * FROM repartidores WHERE estado = 1 ORDER BY nombre ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/delivery/repartidores', (req, res) => {
    const { nombre, telefono, vehiculo, placa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de repartidor requerido.' });
    db.run(
        `INSERT INTO repartidores (nombre, telefono, vehiculo, placa, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre.trim(), telefono || '', vehiculo || 'Moto', placa || ''],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_repartidor: this.lastID, mensaje: 'Repartidor registrado.' });
        }
    );
});

// Actualizar datos de un repartidor (libre albedrío para editar)
app.put('/api/delivery/repartidores/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, telefono, vehiculo, placa, estado } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de repartidor requerido.' });
    db.run(
        `UPDATE repartidores SET nombre = ?, telefono = ?, vehiculo = ?, placa = ?, estado = ? WHERE id_repartidor = ?`,
        [nombre.trim(), telefono || '', vehiculo || 'Moto', placa || '', estado !== undefined ? estado : 1, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Repartidor actualizado exitosamente.' });
        }
    );
});

// Eliminar / Desactivar repartidor
app.delete('/api/delivery/repartidores/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE repartidores SET estado = 0 WHERE id_repartidor = ?`, [id], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mensaje: 'Repartidor desactivado exitosamente.' });
    });
});

// Reasignar libremente repartidor en cualquier pedido activo
app.patch('/api/delivery/pedidos/:id/repartidor', (req, res) => {
    const { id } = req.params;
    const { repartidor, id_repartidor } = req.body;
    db.run(
        `UPDATE pedidos_delivery SET repartidor = ?, id_repartidor = ? WHERE id_pedido = ?`,
        [repartidor || null, id_repartidor || null, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Repartidor reasignado al pedido exitosamente.' });
        }
    );
});

// Archivar todos los pedidos entregados para despejar el tablero visual (se conservan en base de datos e historial)
app.post('/api/delivery/pedidos/archivar-entregados', (req, res) => {
    db.run(
        `UPDATE pedidos_delivery SET archivado = 1 WHERE estado = 'ENTREGADO' AND (archivado IS NULL OR archivado = 0)`,
        [],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: `${this.changes} pedidos entregados archivados correctamente.`, count: this.changes });
        }
    );
});

// Archivar o restaurar pedido individual del tablero
app.patch('/api/delivery/pedidos/:id/archivar', (req, res) => {
    const { id } = req.params;
    const { archivado } = req.body;
    const val = archivado === undefined ? 1 : (archivado ? 1 : 0);
    db.run(
        `UPDATE pedidos_delivery SET archivado = ? WHERE id_pedido = ?`,
        [val, id],
        function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: val === 1 ? 'Pedido archivado del tablero.' : 'Pedido restaurado al tablero.' });
        }
    );
});

// Eliminar pedido permanentemente (Solo Administrador - Módulo 6)
app.delete('/api/delivery/pedidos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM pedido_delivery_detalle WHERE id_pedido = ?`, [id], (errDet) => {
        if (errDet) return res.status(500).json({ error: errDet.message });

        db.run(`DELETE FROM pedidos_delivery WHERE id_pedido = ?`, [id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Pedido no encontrado.' });
            res.json({ success: true, mensaje: 'Pedido eliminado permanentemente.' });
        });
    });
});


// 5. Ticket especial de cocina y despacho para delivery
app.get('/api/delivery/pedidos/:id/ticket', (req, res) => {
    const { id } = req.params;
    db.get(`SELECT * FROM pedidos_delivery WHERE id_pedido = ?`, [id], (err, p) => {
        if (err || !p) return res.status(404).json({ error: 'Pedido no encontrado.' });

        db.all(`SELECT d.*, pr.nombre FROM pedido_delivery_detalle d JOIN productos pr ON d.id_producto = pr.id_producto WHERE d.id_pedido = ?`, [id], (errDet, items) => {
            if (errDet) return res.status(500).json({ error: errDet.message });

            let itemsTxt = '';
            (items || []).forEach(it => {
                itemsTxt += `${it.cantidad}x ${it.nombre.padEnd(22).slice(0, 22)} C$${it.subtotal.toFixed(2)}\n`;
            });

            const ticketCocina = `
========================================
       EL BUEN GUSTO - EL GUSTAZO       
      COMANDA DE COCINA / DESPACHO      
          PEDIDO A DOMICILIO            
========================================
PEDIDO:    #${p.numero_pedido}
ORIGEN:    ${p.origen}
FECHA:     ${new Date(p.fecha_creacion).toLocaleString('es-NI')}
ESTADO:    ${p.estado}
----------------------------------------
DATOS DEL CLIENTE:
CLIENTE:   ${p.cliente_nombre}
TELEFONO:  ${p.telefono || 'Sin especificar'}
DIRECCION EXACTA:
${p.direccion}
----------------------------------------
REPARTIDOR: ${p.repartidor || 'Por asignar'}
${p.notas ? `NOTAS:      ${p.notas}\n` : ''}----------------------------------------
CANT DESCRIPCION               IMPORTE
----------------------------------------
${itemsTxt}----------------------------------------
SUBTOTAL:                    C$ ${p.subtotal.toFixed(2)}
ENVIO DELIVERY:              C$ ${p.costo_delivery.toFixed(2)}
IVA (15%):                   C$ ${p.impuesto.toFixed(2)}
========================================
TOTAL A COBRAR:              C$ ${p.total.toFixed(2)}
PAGO:                        ${p.id_metodo_pago === 1 ? 'EFECTIVO' : 'TRANSFERENCIA ' + (p.banco || '')}
${p.referencia_transferencia ? `REFERENCIA:                  ${p.referencia_transferencia}\n` : ''}========================================
\x1B\x69
`;
            res.json({ success: true, ticket: ticketCocina, pedido: p, items });
        });
    });
});



// Generador de formato de Ticket Térmico Portátil ESC/POS (Sin Emojis)
function generarTicketEscPos(data) {
    let itemsText = '';
    (data.items || []).forEach(it => {
        const nom = (it.nombre || it.producto_nombre || 'Platillo').padEnd(22).slice(0, 22);
        const cant = parseInt(it.cantidad || 1);
        const prec = parseFloat(it.precio || it.precio_unitario || 0);
        const itemLine = `${cant}x ${nom} C$${(prec * cant).toFixed(2)}\n`;
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
${data.telefono ? `TEL:     ${data.telefono}\n` : ''}${data.tipoEntrega && data.tipoEntrega !== 'LOCAL' ? `MODO:    ${data.tipoEntrega}\nDIR:     ${data.direccion || ''}\n` : ''}PAGO:    ${data.metodoPago}
${data.referencia ? `REF:     ${data.referencia}\n` : ''}----------------------------------------
CANT DESCRIPCION               IMPORTE
----------------------------------------
${itemsText}----------------------------------------
SUBTOTAL:                    C$ ${data.subtotal.toFixed(2)}
${data.envio > 0 ? `DELIVERY:                    C$ ${data.envio.toFixed(2)}\n` : ''}TOTAL A PAGAR:               C$ ${data.total.toFixed(2)}
========================================
RECIBIDO:                    C$ ${data.recibido.toFixed(2)}
VUELTO:                      C$ ${data.vuelto.toFixed(2)}
========================================
      ¡GRACIAS POR SU PREFERENCIA!      
     Vuelva pronto a saborear lo bueno  
========================================
\x1B\x69
`;
}

// Generador de Resumen Formateado para WhatsApp (Formato Formal Sin Emojis)
function generarResumenWhatsApp(data) {
    let lineas = `*EL BUEN GUSTO - EL GUSTAZO*\n` +
        `*A tu Paladar - Sierra Maestra, Managua*\n` +
        `------------------------------------\n` +
        `*Factura:* ${data.numeroFactura}\n` +
        `*Fecha:* ${data.fecha}\n` +
        `*Cliente:* ${data.cliente}\n`;

    if (data.direccion && data.tipoEntrega === 'DELIVERY') {
        lineas += `*Entrega a Domicilio:* ${data.direccion}\n`;
        if (data.repartidor) lineas += `*Repartidor:* ${data.repartidor}\n`;
    }

    lineas += `------------------------------------\n`;

    (data.items || []).forEach(it => {
        const nom = it.nombre || it.producto_nombre || 'Platillo';
        const cant = parseInt(it.cantidad || 1);
        const prec = parseFloat(it.precio || it.precio_unitario || 0);
        lineas += `• ${cant}x ${nom} - C$ ${(prec * cant).toFixed(2)}\n`;
    });

    lineas += `------------------------------------\n` +
        `Subtotal: C$ ${data.subtotal.toFixed(2)}\n`;

    if (data.envio > 0) {
        lineas += `Envio Delivery: C$ ${data.envio.toFixed(2)}\n`;
    }

    lineas += `*TOTAL PAGADO: C$ ${data.total.toFixed(2)}*\n` +
        `Metodo de Pago: ${data.metodoPago}\n`;

    if (data.referencia) {
        lineas += `Referencia Bancaria: ${data.referencia}\n`;
    }

    if (data.vuelto > 0) {
        lineas += `Vuelto Entregado: C$ ${data.vuelto.toFixed(2)}\n`;
    }

    lineas += `------------------------------------\n` +
        `¡Muchas gracias por su preferencia!`;

    return lineas;
}

// Comprobante digital por número de factura o pedido delivery (Para visualización web y código QR)
app.get('/api/ventas/comprobante/:numero_factura', (req, res) => {
    const num = req.params.numero_factura;
    db.get(`
        SELECT v.*, mp.nombre AS metodo_pago_nombre, u.nombre AS cajero_nombre, c.telefono AS cliente_tel_db,
               pd.direccion AS direccion_entrega, pd.repartidor, pd.telefono AS telefono_delivery, pd.numero_pedido AS numero_delivery
        FROM ventas v
        LEFT JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
        LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
        LEFT JOIN clientes c ON v.id_cliente = c.id_cliente
        LEFT JOIN pedidos_delivery pd ON v.id_venta = pd.id_venta
        WHERE v.numero_factura = ? OR pd.numero_pedido = ?
    `, [num, num], (err, venta) => {
        if (err) return res.status(500).json({ error: err.message });
        if (venta) {
            db.all(`
                SELECT vd.*, p.nombre AS producto_nombre
                FROM venta_detalle vd
                JOIN productos p ON vd.id_producto = p.id_producto
                WHERE vd.id_venta = ?
            `, [venta.id_venta], (errItems, items) => {
                if (errItems) return res.status(500).json({ error: errItems.message });
                res.json({
                    success: true,
                    tipo: (venta.numero_delivery || venta.costo_delivery > 0) ? 'DELIVERY' : 'LOCAL',
                    venta: {
                        ...venta,
                        direccion: venta.direccion_entrega || venta.direccion,
                        telefono: venta.telefono_delivery || venta.telefono_cliente || venta.cliente_tel_db,
                        items: items || []
                    }
                });
            });
        } else {
            // Buscar directamente en pedidos_delivery
            db.get(`
                SELECT pd.*, pd.numero_pedido AS numero_factura, pd.fecha_creacion AS fecha,
                       mp.nombre AS metodo_pago_nombre, u.nombre AS cajero_nombre, pd.telefono AS cliente_tel_db
                FROM pedidos_delivery pd
                LEFT JOIN metodos_pago mp ON pd.id_metodo_pago = mp.id_metodo_pago
                LEFT JOIN usuarios u ON pd.id_usuario = u.id_usuario
                WHERE pd.numero_pedido = ? OR pd.id_pedido = ?
            `, [num, parseInt(num) || 0], (errDel, pDel) => {
                if (errDel) return res.status(500).json({ error: errDel.message });
                if (!pDel) return res.status(404).json({ error: 'Comprobante no encontrado.' });

                db.all(`
                    SELECT pdd.*, p.nombre AS producto_nombre
                    FROM pedido_delivery_detalle pdd
                    JOIN productos p ON pdd.id_producto = p.id_producto
                    WHERE pdd.id_pedido = ?
                `, [pDel.id_pedido], (errIt, items) => {
                    if (errIt) return res.status(500).json({ error: errIt.message });
                    res.json({
                        success: true,
                        tipo: 'DELIVERY',
                        venta: {
                            ...pDel,
                            items: items || []
                        }
                    });
                });
            });
        }
    });
});

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
app.get('/api/reportes/dashboard', verificarAdmin, (req, res) => {
    const periodo = (req.query.periodo || 'todo').toLowerCase();

    let whereVentas = 'WHERE 1=1';
    let whereJoin = '1=1';

    if (periodo === 'hoy') {
        whereVentas = "WHERE date(fecha) = date('now', 'localtime')";
        whereJoin = "date(v.fecha) = date('now', 'localtime')";
    } else if (periodo === 'semana') {
        whereVentas = "WHERE date(fecha) >= date('now', 'localtime', '-7 days')";
        whereJoin = "date(v.fecha) >= date('now', 'localtime', '-7 days')";
    } else if (periodo === 'mes') {
        whereVentas = "WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now', 'localtime')";
        whereJoin = "strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now', 'localtime')";
    }

    // 1. KPIs Generales
    const kpiQuery = `
        SELECT COUNT(id_venta) AS total_ordenes,
               COALESCE(SUM(total), 0) AS ingresos_totales,
               COALESCE(AVG(total), 0) AS ticket_promedio,
               COALESCE(SUM(CASE WHEN id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS total_efectivo,
               COALESCE(SUM(CASE WHEN id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS total_transferencias,
               COALESCE(SUM(CASE WHEN tipo_entrega = 'DELIVERY' THEN 1 ELSE 0 END), 0) AS ordenes_delivery,
               COALESCE(SUM(CASE WHEN tipo_entrega = 'DELIVERY' THEN total ELSE 0 END), 0) AS total_delivery,
               COALESCE(SUM(CASE WHEN tipo_entrega = 'LOCAL' THEN 1 ELSE 0 END), 0) AS ordenes_local,
               COALESCE(SUM(CASE WHEN tipo_entrega = 'LOCAL' THEN total ELSE 0 END), 0) AS total_local
        FROM ventas
        ${whereVentas}
    `;

    db.get(kpiQuery, [], (errKpi, kpis) => {
        if (errKpi) return res.status(500).json({ error: errKpi.message });

        // 2. Platillos y Combos más Vendidos (Top 10)
        const topProductosQuery = `
            SELECT p.id_producto, p.nombre, c.nombre AS categoria,
                   COALESCE(SUM(vd.cantidad), 0) AS total_vendido,
                   COALESCE(SUM(vd.subtotal), 0) AS total_ingresos
            FROM productos p
            JOIN categorias c ON p.id_categoria = c.id_categoria
            JOIN venta_detalle vd ON p.id_producto = vd.id_producto
            JOIN ventas v ON vd.id_venta = v.id_venta
            WHERE ${whereJoin}
            GROUP BY p.id_producto
            ORDER BY total_vendido DESC, total_ingresos DESC
            LIMIT 10
        `;

        db.all(topProductosQuery, [], (errTop, topProductos) => {
            if (errTop) return res.status(500).json({ error: errTop.message });

            // 3. Platillos de Baja Rotación (Alerta de Estancamiento / Sugerencia de Rotación)
            const bajaRotacionQuery = `
                SELECT p.id_producto, p.nombre, c.nombre AS categoria, p.precio,
                       COALESCE(SUM(CASE WHEN ${whereJoin} THEN vd.cantidad ELSE 0 END), 0) AS total_vendido
                FROM productos p
                JOIN categorias c ON p.id_categoria = c.id_categoria
                LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto
                LEFT JOIN ventas v ON vd.id_venta = v.id_venta
                WHERE p.estado = 1
                GROUP BY p.id_producto
                HAVING total_vendido <= 2
                ORDER BY total_vendido ASC, p.precio DESC
                LIMIT 8
            `;

            db.all(bajaRotacionQuery, [], (errBaja, bajaRotacion) => {
                if (errBaja) return res.status(500).json({ error: errBaja.message });

                const rotacionConAccion = (bajaRotacion || []).map(item => {
                    let sugerencia = 'Crear promoción o combo para reactivar demanda.';
                    if (item.categoria.includes('Alitas')) {
                        sugerencia = 'Activar oferta 2x1 o combo con bebida el fin de semana.';
                    } else if (item.categoria.includes('Burrito') || item.categoria.includes('Quesadilla')) {
                        sugerencia = 'Promover como opción de almuerzo rápido por WhatsApp.';
                    } else if (item.categoria.includes('Hot Dog')) {
                        sugerencia = 'Ofrecer como combo económico para acompañantes o niños.';
                    } else if (item.categoria.includes('Papas')) {
                        sugerencia = 'Sugerir como adición con precio especial en cada orden.';
                    } else if (item.categoria.includes('Bebidas')) {
                        sugerencia = 'Vincular en combo automático para subir ticket promedio.';
                    }
                    return { ...item, sugerencia_comercial: sugerencia };
                });

                // 4. Mensajes Financieros Accionables para Toma de Decisiones
                const totalIngresos = kpis.ingresos_totales || 0;
                const mensajes = [];

                // Mensaje 1: Producto Estrella
                if (topProductos && topProductos.length > 0) {
                    const estrella = topProductos[0];
                    const pctEstrella = totalIngresos > 0 ? Math.round((estrella.total_ingresos / totalIngresos) * 100) : 0;
                    mensajes.push({
                        tipo: 'estrella',
                        titulo: 'Producto Estrella & Demanda Principal',
                        nivel: 'success',
                        descripcion: `"${estrella.nombre}" es el más vendido con ${estrella.total_vendido} unidades (C$ ${estrella.total_ingresos.toFixed(2)}, aportando el ${pctEstrella}% de los ingresos del período).`,
                        accion: 'Garantizar stock prioritario de insumos para este platillo para evitar quiebres y evaluar un combo derivado.'
                    });
                } else {
                    mensajes.push({
                        tipo: 'estrella',
                        titulo: 'Ventas en Desarrollo',
                        nivel: 'info',
                        descripcion: 'No hay ventas registradas en el período seleccionado.',
                        accion: 'Promocione los combos destacados en el canal de WhatsApp de Sierra Maestra.'
                    });
                }

                // Mensaje 2: Alerta de Rotación / Estancamiento
                if (rotacionConAccion.length > 0) {
                    const nombresBaja = rotacionConAccion.slice(0, 3).map(p => p.nombre).join(', ');
                    mensajes.push({
                        tipo: 'rotacion',
                        titulo: 'Alerta de Rotación & Capital Inmovilizado',
                        nivel: 'warning',
                        descripcion: `Se detectaron ${rotacionConAccion.length} platillos con ventas nulas o muy bajas (ej: ${nombresBaja}).`,
                        accion: 'Evite compras excesivas de sus ingredientes perecederos. Active combos 2x1 o promociones de turno para movilizar materia prima.'
                    });
                }

                // Mensaje 3: Rendimiento de Canales (Delivery vs Local)
                const ordDel = kpis.ordenes_delivery || 0;
                const ordLoc = kpis.ordenes_local || 0;
                const totOrd = ordDel + ordLoc;
                const pctDel = totOrd > 0 ? Math.round((ordDel / totOrd) * 100) : 0;
                const ingDel = kpis.total_delivery || 0;
                mensajes.push({
                    tipo: 'canal',
                    titulo: 'Rendimiento de Canales: Delivery vs Local',
                    nivel: 'primary',
                    descripcion: `El Delivery representa el ${pctDel}% de los pedidos (${ordDel} órdenes, C$ ${ingDel.toFixed(2)}) frente a ${100 - pctDel}% en mesa/mostrador.`,
                    accion: pctDel >= 50
                        ? 'El delivery es su mayor motor comercial. Verifique tiempos de empaque y asegure que las tarifas de envío cubran los costos de combustible.'
                        : 'El consumo local domina las ventas. Promueva activamente los pedidos a domicilio en Sierra Maestra y barrios cercanos por WhatsApp.'
                });

                // Mensaje 4: Gestión de Liquidez & Arqueos
                const totEf = kpis.total_efectivo || 0;
                const totTr = kpis.total_transferencias || 0;
                const totDinero = totEf + totTr;
                const pctEf = totDinero > 0 ? Math.round((totEf / totDinero) * 100) : 0;
                mensajes.push({
                    tipo: 'liquidez',
                    titulo: 'Gestión de Liquidez & Control de Caja',
                    nivel: pctEf > 60 ? 'warning' : 'info',
                    descripcion: `El ${pctEf}% de los ingresos ingresaron en efectivo físico (C$ ${totEf.toFixed(2)}) y el ${100 - pctEf}% en transferencias bancarias (C$ ${totTr.toFixed(2)}).`,
                    accion: pctEf > 60
                        ? 'Alto flujo de efectivo en gaveta. Realice arqueos parciales de seguridad y mantenga el fondo mínimo en mostrador.'
                        : 'Preponderancia de transferencias bancarias. Exija siempre verificar la referencia bancaria antes de entregar el pedido.'
                });

                // 5. Desglose detallado por banco
                const bancosQuery = `
                    SELECT COALESCE(banco, 'Sin Banco') AS banco,
                           COUNT(id_venta) AS cantidad,
                           COALESCE(SUM(total), 0) AS monto
                    FROM ventas
                    WHERE id_metodo_pago = 2 AND ${whereJoin.replace(/v\./g, '')}
                    GROUP BY banco
                `;

                db.all(bancosQuery, [], (errBancos, desglosesBancos) => {
                    if (errBancos) return res.status(500).json({ error: errBancos.message });

                    // 6. Ventas por hora del día (para detectar horas pico)
                    const horasQuery = `
                        SELECT strftime('%H', fecha) AS hora,
                               COUNT(id_venta) AS ordenes,
                               COALESCE(SUM(total), 0) AS total
                        FROM ventas
                        WHERE ${whereJoin.replace(/v\./g, '')}
                        GROUP BY hora
                        ORDER BY hora ASC
                    `;

                    db.all(horasQuery, [], (errHoras, ventasHoras) => {
                        if (errHoras) return res.status(500).json({ error: errHoras.message });

                        res.json({
                            periodo,
                            kpis,
                            top_productos: topProductos,
                            baja_rotacion: rotacionConAccion,
                            mensajes_financieros: mensajes,
                            desglose_bancos: desglosesBancos,
                            ventas_por_hora: ventasHoras
                        });
                    });
                });
            });
        });
    });
});

// ==========================================
// MÓDULO 6 & NO FUNCIONAL: RESPALDOS LOCALES Y COPIAS DE SEGURIDAD (RF-23, RNF-05)
// ==========================================
app.get('/api/backups', verificarAdmin, (req, res) => {
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

app.post('/api/backup/crear', verificarAdmin, (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `backup_manual_${timestamp}.db`;
        const dest = path.join(backupsDir, filename);

        fs.copyFileSync(dbPath, dest);
        purgarRespaldosAntiguos(1);
        res.json({
            success: true,
            mensaje: 'Copia de seguridad local creada exitosamente (solo 1 respaldo conservado).',
            archivo: filename
        });
    } catch (err) {
        res.status(500).json({ error: 'Error al generar respaldo: ' + err.message });
    }
});

app.get('/api/backup/descargar/:archivo', verificarAdmin, (req, res) => {
    const file = path.join(backupsDir, req.params.archivo);
    if (fs.existsSync(file)) {
        res.download(file);
    } else {
        res.status(404).send('Archivo de respaldo no encontrado.');
    }
});

// Iniciar servidor local en todas las interfaces de red (0.0.0.0) para escaneo QR móvil
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`[OK] Servidor El Gustazo POS Activo en http://localhost:${PORT}`);
    console.log(`[OK] Red Local LAN (Móvil QR): http://${getLocalIpAddress()}:${PORT}`);
    console.log(`[OK] Modo: 100% Offline | DB: SQLite3 | Sierra Maestra`);
    console.log(`=======================================================`);
});

process.on('SIGTERM', () => {
    server.close(() => {
        db.close();
    });
});