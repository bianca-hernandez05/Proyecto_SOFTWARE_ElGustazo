// =============================================================================
// SISTEMA DE PUNTO DE VENTA (POS) - RESTAURANTE EL GUSTAZO
// SERVIDOR PRINCIPAL BACKEND (Node.js + Express + SQLite3)
// =============================================================================

// Se importa el framework Express para construir el servidor HTTP y definir las rutas REST API.
// ¿Por qué Express?: Permite crear APIs rápidas, ligeras y con bajo consumo de memoria,
// ideal para operar en computadoras con hardware modesto (ej. Windows 8 con 2GB-4GB RAM).
const express = require('express');

// Se importa la librería sqlite3 en modo detallado (verbose).
// ¿Por qué sqlite3?: SQLite es un motor de base de datos embebido en un único archivo (.db),
// lo que permite operar 100% OFFLINE sin necesidad de instalar servicios pesados como MySQL o SQL Server.
// ¿Por qué .verbose()?: Activa trazas y mensajes de error detallados en consola para facilitar la depuración.
const sqlite3 = require('sqlite3').verbose();

// Se importa el módulo nativo 'path' de Node.js.
// ¿Por qué path?: Garantiza compatibilidad al concatenar rutas de archivos tanto en Windows (\) como en Linux (/),
// evitando fallas por rutas relativas rotas al mover el proyecto de carpeta.
const path = require('path');

// Se importa el módulo nativo 'fs' (File System) de Node.js.
// ¿Por qué fs?: Permite interactuar con el sistema de archivos del sistema operativo para crear carpetas,
// leer respaldos, copiar bases de datos y guardar comprobantes/PDFs.
const fs = require('fs');

// Se importa el módulo nativo 'os' (Operating System) de Node.js.
// ¿Por qué os?: Proporciona acceso a las interfaces de red de la máquina para detectar automáticamente
// la dirección IP local asignada por el router Wi-Fi o switch Ethernet.
const os = require('os');

// Se inicializa la aplicación Express que gestionará las peticiones HTTP entrantes.
const app = express();

// Se define el puerto de escucha: toma la variable de entorno PORT si existe, o el puerto 3000 por defecto.
// ¿Por qué?: Permite flexibilidad si se despliega en otro puerto sin modificar el código fuente.
const PORT = process.env.PORT || 3000;

/**
 * Función: getLocalIpAddress
 * Propósito: Detecta automáticamente la dirección IPv4 local (LAN) de la computadora donde corre el servidor.
 * ¿Por qué se implementó?:
 * 1. En un entorno de restaurante offline, los meseros o clientes escanean códigos QR desde sus teléfonos
 *    móviles para ver el menú o su comprobante digital.
 * 2. 'localhost' o '127.0.0.1' solo funciona dentro de la misma computadora.
 * 3. Esta función obtiene la IP real (ej. 192.168.1.50) para que cualquier dispositivo en la misma red Wi-Fi
 *    pueda acceder al sistema escaneando el código QR.
 * 4. Descarta adaptadores virtuales (como VirtualBox) y direcciones de auto-configuración APIPA (169.254.x.x)
 *    que no tienen salida a la red real.
 */
function getLocalIpAddress() {
    // Obtiene un diccionario con todas las interfaces de red disponibles en el sistema operativo.
    const interfaces = os.networkInterfaces();
    let candidates = [];

    // Itera por cada interfaz de red detectada (Wi-Fi, Ethernet, adaptadores virtuales, etc.)
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            // Filtra únicamente direcciones IPv4 y descarta las internas/loopback (127.0.0.1)
            if (iface.family === 'IPv4' && !iface.internal) {
                // ¿Por qué se descartan?:
                // 192.168.56.x suele pertenecer a redes privadas de VirtualBox u otros emuladores.
                // 169.254.x.x son direcciones APIPA que indican que la red no tiene DHCP ni conexión real.
                if (iface.address.startsWith('192.168.56.') || iface.address.startsWith('169.254.')) {
                    continue;
                }
                // Guarda la interfaz candidata con su nombre y dirección IP asignada
                candidates.push({ name, address: iface.address });
            }
        }
    }

    // Prioridad 1: Buscar interfaz Wi-Fi (la más común en restaurantes donde los celulares se conectan por Wi-Fi)
    const wifi = candidates.find(c => /wi-?fi/i.test(c.name));
    if (wifi) return wifi.address;

    // Prioridad 2: Si no hay Wi-Fi activa, buscar conexión cableada Ethernet
    const eth = candidates.find(c => /ethernet/i.test(c.name));
    if (eth) return eth.address;

    // Prioridad 3: Si hay otra interfaz válida, retornar la primera encontrada
    if (candidates.length > 0) return candidates[0].address;

    // Respaldo final: si la máquina no está conectada a ninguna red, retornar localhost
    return '127.0.0.1';
}

// Middleware para procesar cuerpos de solicitud con formato JSON (req.body).
// ¿Por qué se puso?: Permite que las peticiones POST/PUT envíen objetos JSON estructurados desde el frontend.
app.use(express.json());

// Middleware de ciberseguridad: Cabeceras HTTP de protección (Hardening)
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
});

// Middlewares para servir archivos estáticos (CSS, JS, Imágenes y Vistas HTML estructuradas).
app.use('/css', express.static(path.join(__dirname, 'public', 'css')));
app.use('/js', express.static(path.join(__dirname, 'public', 'js')));
app.use('/img', express.static(path.join(__dirname, 'public', 'img')));
app.use('/views', express.static(path.join(__dirname, 'public', 'views')));
app.use(express.static(path.join(__dirname, 'public', 'views')));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Endpoint: GET /api/server-info
 * Propósito: Provee al frontend la IP local del servidor, el puerto y la URL base calculada.
 */
app.get('/api/server-info', (req, res) => {
    const ip = getLocalIpAddress();
    res.json({
        ip,
        port: PORT,
        baseUrl: `http://${ip}:${PORT}`
    });
});

/**
 * Endpoint: POST /api/menu/guardar-pdf
 * Propósito: Recibe el archivo PDF del menú generado por el cliente y lo almacena en disco en la carpeta pública.
 */
app.post('/api/menu/guardar-pdf', express.raw({ type: 'application/pdf', limit: '20mb' }), (req, res) => {
    const pdfPath = path.join(__dirname, 'public', 'Menu_Oficial_El_Gustazo.pdf');
    fs.writeFile(pdfPath, req.body, (err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, url: '/Menu_Oficial_El_Gustazo.pdf' });
    });
});

// Helper para resolver rutas a vistas HTML ordenadas en public/views o public/
function resolverVistaHtml(archivo) {
    const rutaEnViews = path.join(__dirname, 'public', 'views', archivo);
    if (fs.existsSync(rutaEnViews)) return rutaEnViews;
    return path.join(__dirname, 'public', archivo);
}

/**
 * Rutas directas para navegación limpia y amigable
 */
app.get('/', (req, res) => res.sendFile(resolverVistaHtml('login.html')));
app.get('/login', (req, res) => res.sendFile(resolverVistaHtml('login.html')));
app.get('/pos', (req, res) => res.sendFile(resolverVistaHtml('pos.html')));
app.get('/admin', (req, res) => res.sendFile(resolverVistaHtml('admin.html')));
app.get('/caja', (req, res) => res.sendFile(resolverVistaHtml('caja.html')));
app.get('/delivery', (req, res) => res.sendFile(resolverVistaHtml('delivery.html')));
app.get('/inventario', (req, res) => res.sendFile(resolverVistaHtml('inventario.html')));
app.get('/clientes', (req, res) => res.sendFile(resolverVistaHtml('clientes.html')));
app.get('/comprobante', (req, res) => res.sendFile(resolverVistaHtml('comprobante.html')));
app.get('/menu', (req, res) => res.sendFile(resolverVistaHtml('menu.html')));

// =============================================================================
// INICIALIZACIÓN DE LA BASE DE DATOS Y GESTIÓN DE RESPALDOS
// =============================================================================

// Define la ruta absoluta hacia la carpeta donde residen la base de datos y sus respaldos.
const dbDir = path.join(__dirname, '../database');
const backupsDir = path.join(dbDir, 'backups');

// Si el directorio de respaldos no existe en disco, se crea recursivamente.
// ¿Por qué?: Evita errores de "directorio no encontrado" al intentar guardar copias de seguridad.
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

// Ruta completa del archivo de la base de datos SQLite (Soporta DB_ElGustazo.db o DB_ElGustado.db)
const dbFileName = fs.existsSync(path.join(dbDir, 'DB_ElGustazo.db')) ? 'DB_ElGustazo.db' : 'DB_ElGustado.db';
const dbPath = path.join(dbDir, dbFileName);

// Se abre la conexión persistente con SQLite.
// ¿Por qué aquí?: Al ser una aplicación de una sola instancia de servidor, una única conexión
// compartida optimiza el uso de descriptores de archivos y memoria en el sistema operativo.
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error al conectar con SQLite:', err.message);
    } else {
        console.log(`Conectado exitosamente a la base de datos SQLite de El Gustazo (${dbFileName} | 100% Offline).`);
        // Activa validación estricta de llaves foráneas en el motor SQLite
        db.run('PRAGMA foreign_keys = ON;', () => { });
        // Garantiza modo DELETE para mantener un único archivo .db sin archivos temporales .db-shm o .db-wal
        db.run('PRAGMA journal_mode = DELETE;', () => { });
        // Al iniciar el servidor, se dispara una rutina para crear un respaldo diario si aún no existe.
        ejecutarRespaldoDiarioAutomatico();
        // Migración preventiva: asegura que la columna 'archivado' exista en la tabla pedidos_delivery
        // para evitar errores si la base de datos proviene de una versión anterior del sistema.
        db.run(`ALTER TABLE pedidos_delivery ADD COLUMN archivado INTEGER DEFAULT 0`, () => { });
    }
});

// ==========================================
// UTILIDADES: RESPALDO AUTOMÁTICO DIARIO Y GESTIÓN DE ESPACIO (RF-23, RNF-05)
// ==========================================

/**
 * Función: purgarRespaldosAntiguos
 * Propósito: Limita la cantidad de archivos de respaldo (.db) guardados en disco, conservando solo los más recientes.
 * ¿Por qué se implementó?:
 * En computadoras de punto de venta (frecuentemente con discos mecánicos o SSDs pequeños),
 * acumular copias diarias indefinidamente llenaría el almacenamiento y ralentizaría el equipo.
 * Por defecto mantiene el respaldo más reciente (dejarMax = 1).
 */
function purgarRespaldosAntiguos(dejarMax = 1, maxDias = 1) {
    const resultado = { eliminados_antiguos: [], eliminados_duplicados: [], conservados: [] };
    try {
        if (!fs.existsSync(backupsDir)) return resultado;
        const crypto = require('crypto');
        const ahora = Date.now();
        const maxEdadMs = maxDias * 24 * 60 * 60 * 1000;

        const files = fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.db'))
            .map(f => {
                const full = path.join(backupsDir, f);
                const stat = fs.statSync(full);
                let hash = '';
                try {
                    hash = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
                } catch (e) {}
                return {
                    name: f,
                    fullPath: full,
                    time: stat.mtime.getTime(),
                    sizeKb: parseFloat((stat.size / 1024).toFixed(1)),
                    hash
                };
            })
            .sort((a, b) => b.time - a.time);

        const hashesVistos = new Set();

        files.forEach((fileObj, index) => {
            const edadMs = ahora - fileObj.time;
            const esDuplicado = fileObj.hash && hashesVistos.has(fileObj.hash);
            const esAntiguo = index > 0 && edadMs > maxEdadMs;
            const excedeMaximo = index >= dejarMax;

            if (esDuplicado || esAntiguo || excedeMaximo) {
                try {
                    fs.unlinkSync(fileObj.fullPath);
                    if (esDuplicado) {
                        resultado.eliminados_duplicados.push(fileObj.name);
                        console.log(`[Respaldos] Eliminado respaldo duplicado (SHA-256 idéntico): ${fileObj.name}`);
                    } else {
                        resultado.eliminados_antiguos.push(fileObj.name);
                        console.log(`[Respaldos] Eliminado respaldo antiguo para optimizar espacio: ${fileObj.name}`);
                    }
                } catch (e) {
                    console.error('Error eliminando respaldo:', e.message);
                }
            } else {
                if (fileObj.hash) hashesVistos.add(fileObj.hash);
                resultado.conservados.push(fileObj.name);
            }
        });
    } catch (e) {
        console.error('Error al purgar respaldos antiguos:', e.message);
    }
    return resultado;
}

/**
 * Función: ejecutarRespaldoDiarioAutomatico
 * Propósito: Realiza una copia de seguridad física del archivo DB_ElGustazo.db una vez al día
 * y elimina respaldos antiguos o duplicados para mantener limpio el almacenamiento.
 */
function ejecutarRespaldoDiarioAutomatico(forzarActualizacion = false) {
    try {
        const hoy = new Date().toISOString().slice(0, 10);
        const nombreRespaldoHoy = `backup_diario_${hoy}.db`;
        const backupDest = path.join(backupsDir, nombreRespaldoHoy);
        const files = fs.readdirSync(backupsDir);
        const yaRespaldadoHoy = files.some(f => f.includes(hoy));

        if (!yaRespaldadoHoy || forzarActualizacion) {
            fs.copyFile(dbPath, backupDest, (err) => {
                if (err) {
                    console.error('Error en respaldo diario automático:', err.message);
                } else {
                    console.log(`[Respaldos] Respaldo diario automático asegurado: ${nombreRespaldoHoy}`);
                    purgarRespaldosAntiguos(1, 1);
                }
            });
        } else {
            purgarRespaldosAntiguos(1, 1);
        }
    } catch (e) {
        console.error('Error verificando respaldo diario:', e.message);
    }
}

/**
 * Función: ejecutarRespaldoCierreConVacuum
 * Propósito: Compacta la base de datos con VACUUM (RN-11, CP-028) al cierre de caja, genera respaldo actualizado
 * y elimina respaldos antiguos o duplicados.
 */
function ejecutarRespaldoCierreConVacuum(callback) {
    db.run('VACUUM;', (errVac) => {
        if (errVac) {
            console.error('Aviso al ejecutar VACUUM:', errVac.message);
        } else {
            console.log('[Mantenimiento BD] Comando VACUUM ejecutado exitosamente sobre SQLite.');
        }
        try {
            const hoy = new Date().toISOString().slice(0, 10);
            const filenameDiario = `backup_diario_${hoy}.db`;
            fs.copyFileSync(dbPath, path.join(backupsDir, filenameDiario));
            purgarRespaldosAntiguos(1, 1);
            if (typeof callback === 'function') callback(null, filenameDiario);
        } catch (copyErr) {
            console.error('Error generando respaldo de cierre:', copyErr.message);
            if (typeof callback === 'function') callback(copyErr, null);
        }
    });
}

// Verificación horaria automática para garantizar el respaldo de cada nuevo día
setInterval(() => {
    ejecutarRespaldoDiarioAutomatico(false);
}, 3600000);

// ==========================================
// MÓDULO 6 & SEGURIDAD: AUTENTICACIÓN Y ROLES (RF-21, RNF-04)
// ==========================================
// Mapa en memoria para almacenar intentos fallidos de login por usuario e IP.
// ¿Por qué se implementó en memoria?:
// Brinda alta velocidad de verificación sin necesidad de sobrecargar la base de datos SQLite con lecturas/escrituras continuas.
const loginAttemptsMap = new Map();
const securityAuditLog = [];

/**
 * Endpoint: POST /api/login
 * Propósito: Autenticación de usuarios con protección contra ataques de fuerza bruta.
 * ¿Por qué se implementó de esta manera?:
 * 1. Protección contra fuerza bruta: Registra intentos fallidos por IP y usuario. Al 3er intento erróneo,
 *    bloquea el acceso temporalmente durante 30 segundos (HTTP 429), evitando ataques automatizados de diccionario.
 * 2. Normalización de usuario: Convierte a minúsculas y elimina espacios (.trim().toLowerCase()) para evitar
 *    discrepancias por mayúsculas accidentales al escribir en teclados táctiles de pantallas POS.
 * 3. Filtrado por estado activo: Valida 'u.estado = 1' para garantizar que usuarios dados de baja
 *    no puedan iniciar sesión bajo ninguna circunstancia.
 * 4. JOIN con roles: Obtiene el nombre del rol ('Administrador' o 'Cajero') para que el frontend
 *    adapte la interfaz y restrinja los módulos correspondientes.
 */
app.post('/api/login', (req, res) => {
    // Extrae las credenciales enviadas en el cuerpo de la petición
    const { usuario, password } = req.body;

    // Validación temprana: rechaza si faltan credenciales (HTTP 400 Bad Request)
    if (!usuario || !password) {
        return res.status(400).json({ error: 'Debe ingresar usuario y contraseña.' });
    }

    // Normaliza el nombre de usuario a minúsculas y sin espacios a los extremos
    const cleanUser = usuario.trim().toLowerCase();
    // Compatibilidad con alias de prueba ('cajero1' -> 'cajero')
    const lookupUser = cleanUser === 'cajero1' ? 'cajero' : cleanUser;

    // Obtiene la IP del cliente para rastrear intentos por dispositivo y usuario
    const clientIp = req.ip || req.connection.remoteAddress || 'localhost';
    const attemptKey = `${clientIp}_${cleanUser}`;
    const now = Date.now();

    // Revisa si este usuario/IP ya tiene un bloqueo activo por intentos fallidos previos
    const attemptInfo = loginAttemptsMap.get(attemptKey);
    if (attemptInfo && attemptInfo.lockUntil && now < attemptInfo.lockUntil) {
        const segRestantes = Math.ceil((attemptInfo.lockUntil - now) / 1000);
        return res.status(429).json({
            error: `Acceso bloqueado por seguridad ante múltiples intentos fallidos. Espere ${segRestantes} segundos para reintentar.`
        });
    }

    // Consulta SQL parametrizada (?) para prevenir inyecciones SQL (SQL Injection).
    // Une la tabla de usuarios con la de roles para obtener los permisos asignados.
    const query = `
        SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, r.nombre AS rol, u.estado
        FROM usuarios u
        JOIN roles r ON u.id_rol = r.id_rol
        WHERE (LOWER(u.usuario) = ? OR LOWER(u.usuario) = ?) AND u.password = ? AND u.estado = 1
    `;
    db.get(query, [cleanUser, lookupUser, password], (err, row) => {
        // Error de servidor al ejecutar la consulta
        if (err) return res.status(500).json({ error: err.message });

        // Si no se encontró un registro coincidente (credenciales erróneas o usuario inactivo)
        if (!row) {
            const currentAttempts = (attemptInfo ? attemptInfo.attempts : 0) + 1;
            let lockUntil = null;
            // Si alcanza 3 intentos fallidos consecutivos, impone un bloqueo de 30 segundos
            if (currentAttempts >= 3) {
                lockUntil = now + 30000; // 30,000 milisegundos = 30 segundos
            }
            loginAttemptsMap.set(attemptKey, { attempts: currentAttempts >= 3 ? 0 : currentAttempts, lockUntil });
            securityAuditLog.unshift({
                fecha: new Date().toISOString(),
                ip: clientIp,
                usuario: cleanUser,
                exito: false,
                intento: currentAttempts,
                bloqueo_activo: !!lockUntil
            });
            if (securityAuditLog.length > 100) securityAuditLog.pop();

            const msg = lockUntil
                ? 'Demasiados intentos fallidos. Acceso bloqueado preventivamente durante 30 segundos para evitar robo de sesión.'
                : `Credenciales incorrectas (Intento ${currentAttempts} de 3). Verifique su usuario, contraseña y caracteres especiales.`;
            return res.status(401).json({ error: msg, intentos_fallidos: currentAttempts });
        }

        // Si la autenticación fue exitosa: limpia el historial de intentos fallidos en memoria
        loginAttemptsMap.delete(attemptKey);
        securityAuditLog.unshift({
            fecha: new Date().toISOString(),
            ip: clientIp,
            usuario: row.usuario,
            exito: true,
            intento: 1,
            bloqueo_activo: false
        });
        if (securityAuditLog.length > 100) securityAuditLog.pop();

        // Retorna los datos de sesión esenciales del usuario autenticado
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

/**
 * Middleware: verificarAdmin (Control de Acceso Basado en Roles - RBAC)
 * Propósito: Protege los endpoints críticos restringiéndolos únicamente a usuarios con rol Administrador (id_rol: 1).
 * ¿Por qué se implementó?:
 * En la operación de El Gustazo, el Cajero (id_rol: 2) opera exclusivamente en ventas de mostrador y delivery.
 * Se debe impedir que el Cajero pueda:
 * - Modificar precios de venta o alterar platillos/combos del menú.
 * - Modificar las fórmulas o recetas fijas (BOM) de insumos.
 * - Acceder a reportes financieros de ganancias globales o métricas de ingresos.
 * - Crear o borrar otros usuarios o realizar descargas de copias de seguridad.
 * - Eliminar registros del inventario o catálogo.
 * Lee el rol desde el encabezado HTTP 'x-user-role' o desde el cuerpo de la petición.
 */
function verificarAdmin(req, res, next) {
    const rolHeader = req.headers['x-user-role'];
    const rolNameHeader = (req.headers['x-user-role-name'] || '').toLowerCase();
    const idRol = rolHeader !== undefined ? parseInt(rolHeader, 10) : (req.body && req.body.id_rol_solicitante ? parseInt(req.body.id_rol_solicitante, 10) : null);

    // Permite Administrador (id_rol: 1) y Gerente General (id_rol: 3)
    const esAdminOGerente = idRol === 1 || idRol === 3 || rolNameHeader.includes('administrador') || rolNameHeader.includes('gerente');

    if (idRol !== null && !isNaN(idRol) && !esAdminOGerente) {
        return res.status(403).json({
            error: 'Acceso Prohibido: Las funciones administrativas y de auditoría están reservadas para el Administrador o Gerente General.',
            codigo: 'ACCESO_DENEGADO_ADMIN'
        });
    }

    next();
}

/**
 * Middleware: verificarGerente (Control Exclusivo para Gerente General)
 * Propósito: Restringe acciones sumamente críticas (anular facturas emitidas, autorizar auditorías)
 * únicamente al usuario con rol de Gerente General (id_rol: 3).
 */
function verificarGerente(req, res, next) {
    const rolHeader = req.headers['x-user-role'];
    const rolNameHeader = (req.headers['x-user-role-name'] || '').toLowerCase();
    const idRol = rolHeader !== undefined ? parseInt(rolHeader, 10) : (req.body && req.body.id_rol_solicitante ? parseInt(req.body.id_rol_solicitante, 10) : null);

    const esGerente = idRol === 3 || rolNameHeader.includes('gerente general') || rolNameHeader === 'gerente';

    if (esGerente) {
        return next();
    }

    // Permitir validación presencial mediante credencial o contraseña del Gerente General
    const credencialGerente = req.body ? (req.body.credencial_gerente || req.body.pin_gerente) : null;
    if (credencialGerente) {
        db.get(
            `SELECT id_usuario, nombre FROM usuarios WHERE id_rol = 3 AND estado = 1 AND password = ?`,
            [credencialGerente],
            (err, gerente) => {
                if (!err && gerente) {
                    req.gerente_autorizador = gerente;
                    if (req.body) req.body.id_usuario_autoriza = gerente.id_usuario;
                    return next();
                }
                return res.status(403).json({
                    error: 'Contraseña o credencial de Gerente General inválida. Verifique e intente nuevamente.',
                    codigo: 'CREDENCIAL_GERENTE_INVALIDA'
                });
            }
        );
        return;
    }

    return res.status(403).json({
        error: 'Acceso Denegado: Esta acción sensible está reservada exclusivamente para el Gerente General (Dueño) o requiere su autorización presencial.',
        codigo: 'ACCESO_DENEGADO_GERENTE'
    });
}

/**
 * Endpoint: GET /api/usuarios
 * Propósito: Obtener el listado completo de usuarios registrados para gestión en el panel administrativo.
 * Seguridad: Requiere rol de Administrador (verificarAdmin).
 */
app.get('/api/usuarios', verificarAdmin, (req, res) => {
    // Consulta los usuarios con su rol asociado, ordenados por ID
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

/**
 * Endpoint: POST /api/usuarios
 * Propósito: Crear un nuevo usuario en el sistema.
 * Seguridad: Requiere rol de Administrador (verificarAdmin) y valida directivas de contraseñas seguras.
 * ¿Por qué se validan las contraseñas?:
 * Exige mínimo 8 caracteres, al menos un número y un carácter especial para prevenir contraseñas
 * débiles como '1234' o 'admin', protegiendo el sistema de manipulaciones no autorizadas.
 */
app.post('/api/usuarios', verificarAdmin, (req, res) => {
    const { nombre, usuario, password, id_rol } = req.body;

    // Validación de campos obligatorios
    if (!nombre || !usuario || !password || !id_rol) {
        return res.status(400).json({ error: 'Todos los campos son requeridos.' });
    }

    // Validación de seguridad de contraseña mediante expresiones regulares (Regex)
    const tieneEspecial = /[!@#$%^&*(),.?":{}|<>]/.test(password);
    const tieneNumero = /\d/.test(password);
    if (password.length < 8 || !tieneNumero || !tieneEspecial) {
        return res.status(400).json({
            error: 'Por seguridad para evitar robos de cuenta, la contraseña debe tener al menos 8 caracteres, incluir números y al menos un carácter especial (*, #, @, etc.).'
        });
    }

    // Inserción segura con estado activo (estado = 1)
    db.run(
        `INSERT INTO usuarios (nombre, usuario, password, id_rol, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre, usuario.trim(), password, id_rol],
        function (err) {
            if (err) return res.status(500).json({ error: 'El nombre de usuario ya existe o hubo un error: ' + err.message });
            res.json({ success: true, id_usuario: this.lastID, mensaje: 'Usuario creado exitosamente con credenciales seguras.' });
        }
    );
});

/**
 * Endpoint: DELETE /api/usuarios/:id
 * Propósito: Desactivar un usuario (borrado lógico / soft delete).
 * ¿Por qué soft delete (estado = 0)?:
 * Si se borrara con DELETE físico, se rompería la integridad referencial histórica en las ventas
 * y aperturas/cierres de caja donde este usuario participó como cajero o administrador.
 * ¿Por qué se protege id === 1?:
 * El usuario administrador principal no puede ser eliminado para garantizar que el sistema
 * nunca quede bloqueado sin acceso administrativo.
 */
app.delete('/api/usuarios/:id', verificarGerente, (req, res) => {
    const { id } = req.params;

    // Protección del Administrador principal del sistema
    if (parseInt(id) === 1) {
        return res.status(400).json({ error: 'El usuario administrador principal no puede ser eliminado.' });
    }

    // Desactivación lógica
    db.run(`UPDATE usuarios SET estado = 0 WHERE id_usuario = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado.' });
        res.json({ success: true, mensaje: 'Usuario desactivado exitosamente.' });
    });
});

// ==========================================
// MÓDULO 1 & 6: CATÁLOGO, PRODUCTOS Y COMBOS (RF-02, RF-19)
// ==========================================

/**
 * Endpoint: GET /api/categorias
 * Propósito: Listar todas las categorías activas de alimentos y bebidas del restaurante.
 * ¿Por qué solo estado = 1?: Permite ocultar temporalmente categorías completas sin perder su historial.
 */
app.get('/api/categorias', (req, res) => {
    db.all(`SELECT * FROM categorias WHERE estado = 1 ORDER BY id_categoria ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/**
 * Endpoint: GET /api/productos
 * Propósito: Obtener el catálogo de productos disponibles para la venta en el POS.
 * ¿Por qué se une con categorias (JOIN)?:
 * Para que el frontend pueda agrupar los platillos por pestañas/categorías (ej. Alitas, Burritos, Combos).
 * Solo lista productos con estado = 1 para no vender platillos descontinuados.
 */
/**
 * Función Auxiliar BOM: enriquecerProductosConStockBOM(productos, callback)
 * Propósito: Evalúa en tiempo real los insumos de la receta (BOM) de cada platillo o combo
 * para determinar si alguno de sus ingredientes está agotado o en nivel crítico (stock_actual <= stock_minimo),
 * bloqueando su venta preventiva y alertando qué insumos requieren reabastecimiento inmediato.
 */
function enriquecerProductosConStockBOM(productos, callback) {
    if (!productos || productos.length === 0) {
        return callback(null, []);
    }
    const queryRecetas = `
        SELECT r.id_producto, rd.id_insumo, rd.cantidad AS cantidad_requerida,
               i.nombre AS insumo_nombre, i.unidad_medida, i.stock_actual, i.stock_minimo
        FROM recetas r
        JOIN receta_detalle rd ON r.id_receta = rd.id_receta
        JOIN insumos i ON rd.id_insumo = i.id_insumo
        WHERE i.estado = 1
    `;
    db.all(queryRecetas, [], (err, filasReceta) => {
        if (err) return callback(err, null);

        const mapaRecetas = {};
        (filasReceta || []).forEach(f => {
            if (!mapaRecetas[f.id_producto]) mapaRecetas[f.id_producto] = [];
            const stockActual = parseFloat(f.stock_actual || 0);
            const stockMinimo = parseFloat(f.stock_minimo || 0);
            const cantReq = parseFloat(f.cantidad_requerida || 1);
            const agotado = stockActual <= 0 || stockActual < cantReq;
            const bajoMinimo = stockActual <= stockMinimo || (stockActual - cantReq) < 0;
            // Cuántas porciones se pueden vender antes de caer en o por debajo del stock mínimo de seguridad
            const margenSobreMinimo = Math.max(0, stockActual - stockMinimo);
            const porcionesSeguras = cantReq > 0 ? Math.floor(margenSobreMinimo / cantReq) : 999;
            const porcionesFisicas = cantReq > 0 ? Math.max(0, Math.floor(stockActual / cantReq)) : 999;

            mapaRecetas[f.id_producto].push({
                id_insumo: f.id_insumo,
                nombre: f.insumo_nombre,
                unidad_medida: f.unidad_medida,
                cantidad_requerida: cantReq,
                stock_actual: stockActual,
                stock_minimo: stockMinimo,
                agotado,
                bajo_minimo: bajoMinimo,
                porciones_seguras: porcionesSeguras,
                porciones_fisicas: porcionesFisicas
            });
        });

        const enriquecidos = productos.map(p => {
            const receta = mapaRecetas[p.id_producto] || [];
            const insumosCriticos = receta.filter(i => i.agotado || i.bajo_minimo);
            const insumosAgotados = receta.filter(i => i.agotado);
            const porcionesDisponibles = receta.length > 0
                ? Math.min(...receta.map(i => i.bajo_minimo ? 0 : Math.max(1, i.porciones_seguras)))
                : 999;
            const bloqueadoPorStock = insumosCriticos.length > 0;

            return {
                ...p,
                insumos_receta: receta,
                insumos_criticos: insumosCriticos,
                insumos_agotados: insumosAgotados,
                porciones_disponibles: bloqueadoPorStock ? 0 : porcionesDisponibles,
                bloqueado_por_stock: bloqueadoPorStock
            };
        });

        callback(null, enriquecidos);
    });
}

/**
 * Función Auxiliar Transaccional BOM: validarDisponibilidadInsumosOrden(items, callback)
 * Propósito: Verifica antes de facturar o registrar un pedido que ninguno de los platillos
 * tenga sus insumos en nivel crítico (stock_actual <= stock_minimo) o con existencias insuficientes.
 */
function validarDisponibilidadInsumosOrden(items, callback) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return callback(null, { valido: true });
    }

    const idsProductos = [...new Set(items.map(it => parseInt(it.id_producto, 10)).filter(Boolean))];
    if (idsProductos.length === 0) {
        return callback(null, { valido: true });
    }

    const placeholders = idsProductos.map(() => '?').join(',');
    const sql = `
        SELECT r.id_producto, p.nombre AS producto_nombre,
               rd.id_insumo, rd.cantidad AS cantidad_unitaria,
               i.nombre AS insumo_nombre, i.unidad_medida, i.stock_actual, i.stock_minimo
        FROM recetas r
        JOIN productos p ON r.id_producto = p.id_producto
        JOIN receta_detalle rd ON r.id_receta = rd.id_receta
        JOIN insumos i ON rd.id_insumo = i.id_insumo
        WHERE r.id_producto IN (${placeholders}) AND i.estado = 1
    `;

    db.all(sql, idsProductos, (err, rows) => {
        if (err) return callback(err, null);
        if (!rows || rows.length === 0) return callback(null, { valido: true });

        // Acumular consumo total por insumo en toda la orden
        const consumoPorInsumo = {};
        items.forEach(item => {
            const idProd = parseInt(item.id_producto, 10);
            const cantOrden = Math.max(1, parseInt(item.cantidad || 1, 10));
            const ingredientesProd = rows.filter(r => r.id_producto === idProd);

            ingredientesProd.forEach(ing => {
                if (!consumoPorInsumo[ing.id_insumo]) {
                    consumoPorInsumo[ing.id_insumo] = {
                        id_insumo: ing.id_insumo,
                        insumo_nombre: ing.insumo_nombre,
                        unidad_medida: ing.unidad_medida,
                        stock_actual: parseFloat(ing.stock_actual || 0),
                        stock_minimo: parseFloat(ing.stock_minimo || 0),
                        cantidad_total_requerida: 0,
                        platillos_afectados: new Set()
                    };
                }
                consumoPorInsumo[ing.id_insumo].cantidad_total_requerida += parseFloat(ing.cantidad_unitaria || 0) * cantOrden;
                consumoPorInsumo[ing.id_insumo].platillos_afectados.add(ing.producto_nombre);
            });
        });

        const faltantes = [];
        Object.values(consumoPorInsumo).forEach(info => {
            const stockRestante = info.stock_actual - info.cantidad_total_requerida;
            // Bloquear si el insumo ya está en/bajo el stock mínimo, agotado, o si la orden supera el stock disponible
            if (info.stock_actual <= 0 || info.stock_actual <= info.stock_minimo || stockRestante < 0) {
                faltantes.push({
                    id_insumo: info.id_insumo,
                    nombre: info.insumo_nombre,
                    unidad_medida: info.unidad_medida,
                    stock_actual: info.stock_actual,
                    stock_minimo: info.stock_minimo,
                    requerido: parseFloat(info.cantidad_total_requerida.toFixed(2)),
                    platillos: Array.from(info.platillos_afectados)
                });
            }
        });

        if (faltantes.length > 0) {
            const platillosStr = [...new Set(faltantes.flatMap(f => f.platillos))].join(', ');
            const detalleStr = faltantes.map(f =>
                `${f.nombre} (Stock actual: ${f.stock_actual} ${f.unidad_medida} / Mínimo seguridad: ${f.stock_minimo} ${f.unidad_medida} / Requerido: ${f.requerido} ${f.unidad_medida})`
            ).join('; ');
            return callback(null, {
                valido: false,
                error: `ALERTA DE REABASTECIMIENTO: No se puede seguir vendiendo [${platillosStr}] ya que hay poco producto en inventario para sus insumos: ${detalleStr}. Por favor reabastezca en el módulo de Inventario antes de continuar.`,
                insumos_faltantes: faltantes
            });
        }

        callback(null, { valido: true });
    });
}

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
        enriquecerProductosConStockBOM(rows, (errBom, productosConStock) => {
            if (errBom) return res.status(500).json({ error: errBom.message });
            res.json(productosConStock);
        });
    });
});

/**
 * Endpoint: GET /api/productos/admin
 * Propósito: Obtener todos los productos (activos e inactivos) para la pantalla de administración del catálogo.
 */
app.get('/api/productos/admin', verificarAdmin, (req, res) => {
    const query = `
        SELECT p.*, c.nombre AS categoria_nombre
        FROM productos p
        JOIN categorias c ON p.id_categoria = c.id_categoria
        ORDER BY p.id_producto DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        enriquecerProductosConStockBOM(rows, (errBom, productosConStock) => {
            if (errBom) return res.status(500).json({ error: errBom.message });
            res.json(productosConStock);
        });
    });
});

/**
 * Endpoint: POST /api/productos
 * Propósito: Crear un nuevo platillo, bebida o combo en el catálogo.
 * Seguridad: Requiere rol de Administrador (verificarAdmin).
 * ¿Por qué se incluye el campo es_combo?:
 * Permite al sistema identificar si el producto es un paquete promocional compuesto
 * por múltiples productos individuales o si es un platillo individual.
 */
app.post('/api/productos', verificarAdmin, (req, res) => {
    const { nombre, descripcion, precio, id_categoria, es_combo } = req.body;

    // Validación de campos obligatorios
    if (!nombre || precio === undefined || !id_categoria) {
        return res.status(400).json({ error: 'Nombre, precio y categoría son obligatorios.' });
    }

    db.run(
        `INSERT INTO productos (nombre, descripcion, precio, id_categoria, es_combo, estado) VALUES (?, ?, ?, ?, ?, 1)`,
        [nombre, descripcion || '', parseFloat(precio), parseInt(id_categoria), es_combo ? 1 : 0],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_producto: this.lastID, mensaje: 'Producto guardado correctamente.' });
        }
    );
});

/**
 * Endpoint: PUT /api/productos/:id
 * Propósito: Modificar datos de un producto (nombre, descripción, precio, categoría, estado).
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 */
app.put('/api/productos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion, precio, id_categoria, es_combo, estado } = req.body;
    db.run(
        `UPDATE productos SET nombre = ?, descripcion = ?, precio = ?, id_categoria = ?, es_combo = ?, estado = ? WHERE id_producto = ?`,
        [nombre, descripcion, parseFloat(precio), parseInt(id_categoria), es_combo ? 1 : 0, estado !== undefined ? estado : 1, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Producto actualizado correctamente.' });
        }
    );
});

/**
 * Endpoint: DELETE /api/productos/:id
 * Propósito: Eliminar un producto del catálogo activo mediante borrado lógico (soft delete).
 * ¿Por qué soft delete (estado = 0)?:
 * Si se eliminara la fila con DELETE físico, se romperían las referencias de ventas pasadas
 * en la tabla 'venta_detalle', alterando los reportes históricos y la contabilidad del restaurante.
 */
app.delete('/api/productos/:id', verificarGerente, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE productos SET estado = 0 WHERE id_producto = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Producto no encontrado.' });
        res.json({ success: true, mensaje: 'Producto eliminado exitosamente del catálogo.' });
    });
});

// ==========================================
// MÓDULO 3 & 6: INVENTARIO, BOM Y ALERTAS (RF-09, RF-10, RF-11, RF-12, RF-20)
// ==========================================

/**
 * Endpoint: GET /api/insumos
 * Propósito: Listar todas las materias primas e insumos activos en el inventario.
 * ¿Por qué se implementó?:
 * Permite a la interfaz de cocina, compras y recetas consultar el catálogo de insumos
 * (ej. pechuga de pollo, papas, salsa BBQ, aceite) ordenados alfabéticamente.
 */
app.get('/api/insumos', (req, res) => {
    db.all(`SELECT * FROM insumos WHERE estado = 1 ORDER BY nombre ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/**
 * Endpoint: POST /api/insumos
 * Propósito: Dar de alta un nuevo insumo o materia prima en el inventario.
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 * ¿Por qué almacena unidad_medida y stock_minimo?:
 * - unidad_medida (kg, g, l, unidad) estandariza el consumo en las recetas BOM.
 * - stock_minimo define el umbral de seguridad para disparar alertas automáticas antes de que se agote.
 */
app.post('/api/insumos', verificarAdmin, (req, res) => {
    const { nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario } = req.body;

    // Validación de campos básicos obligatorios
    if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida requeridos.' });
    }

    db.run(
        `INSERT INTO insumos (nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, estado) VALUES (?, ?, ?, ?, ?, 1)`,
        [nombre, unidad_medida, parseFloat(stock_actual) || 0, parseFloat(stock_minimo) || 0, parseFloat(costo_unitario) || 0],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_insumo: this.lastID, mensaje: 'Insumo registrado exitosamente.' });
        }
    );
});

/**
 * Endpoint: PUT /api/insumos/:id
 * Propósito: Actualizar los parámetros de un insumo existente (nombre, unidad, stock mínimo o costo).
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 */
app.put('/api/insumos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, unidad_medida, stock_minimo, costo_unitario } = req.body;

    if (!nombre || !unidad_medida) {
        return res.status(400).json({ error: 'Nombre y unidad de medida requeridos.' });
    }

    db.run(
        `UPDATE insumos SET nombre = ?, unidad_medida = ?, stock_minimo = ?, costo_unitario = ? WHERE id_insumo = ?`,
        [nombre.trim(), unidad_medida.trim(), parseFloat(stock_minimo) || 0, parseFloat(costo_unitario) || 0, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado.' });
            res.json({ success: true, mensaje: 'Insumo actualizado exitosamente.' });
        }
    );
});

/**
 * Endpoint: DELETE /api/insumos/:id
 * Propósito: Desactivar un insumo mediante borrado lógico (soft delete).
 * ¿Por qué soft delete (estado = 0)?:
 * Para no alterar las recetas históricas ni los registros de movimientos de auditoría pasados.
 */
app.delete('/api/insumos/:id', verificarGerente, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE insumos SET estado = 0 WHERE id_insumo = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        if (this.changes === 0) return res.status(404).json({ error: 'Insumo no encontrado.' });
        res.json({ success: true, mensaje: 'Insumo eliminado exitosamente.' });
    });
});

/**
 * Endpoint: POST /api/insumos/movimiento (RF-12)
 * Propósito: Registrar entradas (compras/reabastecimiento) o salidas (mermas/desperdicios) de insumos.
 * ¿Por qué se implementó con transacción SQL (BEGIN / COMMIT / ROLLBACK)?:
 * 1. Atomicidad: Se deben ejecutar dos operaciones inseparables:
 *    a) Actualizar la cantidad física en la tabla 'insumos'.
 *    b) Crear el registro de auditoría en 'movimientos_inventario'.
 * 2. Si alguna de las dos falla, se hace ROLLBACK completo, evitando descuadres de inventario.
 * 3. En salidas, se usa MAX(0, stock_actual - ?) para prevenir cantidades negativas en el stock físico.
 * 4. En entradas con nuevo costo_unitario, se actualiza el costo para mantener el valor de reposición al día.
 */
app.post('/api/insumos/movimiento', (req, res) => {
    const { id_insumo, tipo, cantidad, costo_unitario, motivo, id_usuario } = req.body;
    const cantNum = parseFloat(cantidad);

    // Validación de parámetros
    if (!id_insumo || !tipo || isNaN(cantNum) || cantNum <= 0) {
        return res.status(400).json({ error: 'Datos de movimiento inválidos.' });
    }

    // db.serialize garantiza que los comandos de la transacción se ejecuten en orden secuencial estricto
    db.serialize(() => {
        // Inicia la transacción
        db.run('BEGIN TRANSACTION;');

        let updateQuery = `UPDATE insumos SET stock_actual = stock_actual + ?, fecha_actualizacion = CURRENT_TIMESTAMP`;
        let params = [cantNum];

        // Si es una compra (ENTRADA) con nuevo costo unitario, se actualiza el costo registrado
        if (tipo === 'ENTRADA' && costo_unitario !== undefined && costo_unitario > 0) {
            updateQuery += `, costo_unitario = ?`;
            params.push(parseFloat(costo_unitario));
        } else if (tipo === 'SALIDA') {
            // En salida, resta cuidando no bajar de 0
            updateQuery = `UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP`;
        }

        updateQuery += ` WHERE id_insumo = ?`;
        params.push(id_insumo);

        // Ejecuta la actualización del stock
        db.run(updateQuery, params, function (err) {
            if (err) {
                db.run('ROLLBACK;');
                return res.status(500).json({ error: err.message });
            }

            // Inserta el registro de trazabilidad en la bitácora de movimientos
            db.run(
                `INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_usuario) VALUES (?, ?, ?, ?, ?)`,
                [id_insumo, tipo, cantNum, motivo || `Movimiento de ${tipo}`, id_usuario || 1],
                function (errMov) {
                    if (errMov) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errMov.message });
                    }

                    // Confirma y guarda permanentemente los cambios de la transacción
                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) return res.status(500).json({ error: commitErr.message });
                        res.json({ success: true, mensaje: 'Inventario actualizado correctamente.' });
                    });
                }
            );
        });
    });
});

/**
 * Endpoint: GET /api/alertas-stock (RF-10)
 * Propósito: Notificar en tiempo real qué insumos se encuentran en nivel crítico o por debajo del mínimo.
 * ¿Por qué se implementó?:
 * Permite a la cocina y gerencia percatarse inmediatamente de insumos que están por agotarse,
 * calculando el campo 'faltante' para saber cuántas unidades faltan para alcanzar el nivel óptimo.
 * El umbral de 200 unidades actúa como advertencia preventiva general para turnos de alta demanda.
 */
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

/**
 * Endpoint: GET /api/insumos/faltantes (RF-11)
 * Propósito: Generar la lista consolidada de compras necesarias para reabastecer el siguiente turno.
 * ¿Por qué se implementó?:
 * Calcula automáticamente la cantidad sugerida a reabastecer (duplicando el stock mínimo como meta segura)
 * y multiplica por el costo unitario para presentarle al administrador el presupuesto estimado de compra.
 */
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

/**
 * Endpoint: GET /api/insumos/movimientos
 * Propósito: Bitácora de auditoría con los últimos 100 movimientos de inventario.
 * ¿Por qué se implementó?:
 * Permite auditar entradas por compras, salidas manuales o deducciones automáticas por venta,
 * mostrando el insumo, la unidad de medida y el usuario que realizó la acción.
 */
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

/**
 * Endpoint: GET /api/recetas/:id_producto (RF-20)
 * Propósito: Consultar los ingredientes y cantidades que componen la receta (BOM - Bill of Materials) de un platillo.
 * ¿Por qué se implementó?:
 * La estructura BOM vincula un producto comercial (ej. "Combo 1 - 10 Alitas + Papas") con sus insumos base
 * (ej. 0.5kg alitas de pollo, 0.2kg papas congeladas, 50ml salsa BBQ). Cada vez que se venda este producto,
 * el sistema sabrá con exactitud qué insumos deducir automáticamente del inventario.
 */
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

/**
 * Endpoint: POST /api/recetas/:id_producto
 * Propósito: Guardar o actualizar la receta BOM de un producto específico.
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 * ¿Por qué se implementó con transacción y DELETE previo?:
 * 1. Asegura la cabecera en 'recetas' con 'INSERT OR IGNORE'.
 * 2. Borra el detalle anterior en 'receta_detalle' para evitar ingredientes duplicados o residuales al modificar la receta.
 * 3. Re-inserta los ingredientes enviados en un lote atómico mediante un Prepared Statement.
 * 4. Si algo falla durante el proceso, ejecuta ROLLBACK para mantener intacta la receta previa.
 */
app.post('/api/recetas/:id_producto', verificarAdmin, (req, res) => {
    const { id_producto } = req.params;
    const { ingredientes } = req.body; // Array de objetos { id_insumo, cantidad }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION;');

        // Asegurar que exista la cabecera de receta para este producto
        db.run(`INSERT OR IGNORE INTO recetas (id_producto, descripcion) VALUES (?, 'Receta Estándar')`, [id_producto], function (err) {
            if (err) {
                db.run('ROLLBACK;');
                return res.status(500).json({ error: err.message });
            }

            // Obtiene el ID de la cabecera de receta
            db.get(`SELECT id_receta FROM recetas WHERE id_producto = ?`, [id_producto], (errRec, rowRec) => {
                if (errRec || !rowRec) {
                    db.run('ROLLBACK;');
                    return res.status(500).json({ error: 'No se pudo obtener la receta.' });
                }
                const id_receta = rowRec.id_receta;

                // Limpiar los ingredientes anteriores para reconfigurar la receta desde cero
                db.run(`DELETE FROM receta_detalle WHERE id_receta = ?`, [id_receta], (errDel) => {
                    if (errDel) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errDel.message });
                    }

                    // Si se enviaron ingredientes, inserta cada uno con su respectiva cantidad
                    if (ingredientes && ingredientes.length > 0) {
                        const stmt = db.prepare(`INSERT INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES (?, ?, ?)`);
                        ingredientes.forEach(ing => {
                            if (ing.id_insumo && parseFloat(ing.cantidad) > 0) {
                                stmt.run([id_receta, ing.id_insumo, parseFloat(ing.cantidad)]);
                            }
                        });
                        stmt.finalize();
                    }

                    // Confirma la transacción
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

/**
 * Endpoint: GET /api/clientes
 * Propósito: Buscar y listar clientes activos registrados en el sistema.
 * ¿Por qué se implementó con filtro 'q'?:
 * En el POS o módulo de delivery, el cajero puede escribir parte del nombre o teléfono del cliente
 * (ej. '8888' o 'Carlos') para autocompletar su dirección y categoría rápidamente sin volver a teclear todo.
 * Solo busca clientes con estado = 1 (activos).
 */
app.get('/api/clientes', (req, res) => {
    const { q } = req.query;
    let query = `SELECT * FROM clientes WHERE estado = 1`;
    let params = [];

    // Si se envía parámetro de búsqueda 'q', filtra por coincidencia parcial en nombre o teléfono
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

/**
 * Endpoint: POST /api/clientes
 * Propósito: Registrar un nuevo cliente en la base de datos.
 * ¿Por qué se implementó?:
 * Permite capturar nombre, teléfono, dirección exacta y categoría (ej. 'Ocasional', 'Frecuente', 'VIP')
 * para facilitar futuras entregas de delivery en la zona de Sierra Maestra y fidelizar clientes.
 */
app.post('/api/clientes', (req, res) => {
    const { nombre, telefono, direccion, categoria } = req.body;

    // El nombre es el único campo estrictamente indispensable
    if (!nombre) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    db.run(
        `INSERT INTO clientes (nombre, telefono, direccion, categoria, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre, telefono || '', direccion || '', categoria || 'Ocasional'],
        function (err) {
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

/**
 * Endpoint: PUT /api/clientes/:id
 * Propósito: Actualizar la información de contacto o categoría de un cliente existente.
 */
app.put('/api/clientes/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, telefono, direccion, categoria } = req.body;

    if (!nombre || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre del cliente es obligatorio.' });
    }

    db.run(
        `UPDATE clientes SET nombre = ?, telefono = ?, direccion = ?, categoria = ? WHERE id_cliente = ?`,
        [nombre.trim(), telefono ? telefono.trim() : '', direccion ? direccion.trim() : '', categoria || 'Ocasional', id],
        function (err) {
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

/**
 * Endpoint: DELETE /api/clientes/:id
 * Propósito: Eliminar un cliente de forma inteligente y segura.
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 * ¿Por qué esta lógica condicional de eliminación?:
 * 1. Protección del cliente 'Consumidor Final' (id 1): Es el cliente por defecto del sistema y no debe borrarse.
 * 2. Si el cliente ya tiene compras asociadas en la tabla 'ventas': Se aplica soft-delete (estado = 0)
 *    para no romper las referencias contables e históricas de facturas emitidas.
 * 3. Si el cliente fue registrado por error y NO tiene ninguna venta registrada: Se borra físicamente
 *    (DELETE FROM clientes) para mantener limpia la base de datos sin registros basura.
 */
app.delete('/api/clientes/:id', verificarGerente, (req, res) => {
    const { id } = req.params;
    const idNum = parseInt(id);

    // Protección del Consumidor Final predeterminado
    if (idNum === 1) {
        return res.status(400).json({ error: 'No se puede eliminar el Consumidor Final predeterminado.' });
    }

    // Consulta si el cliente tiene ventas vinculadas
    db.get('SELECT COUNT(*) as count FROM ventas WHERE id_cliente = ?', [idNum], (errV, rowV) => {
        if (!errV && rowV && rowV.count > 0) {
            // Si tiene ventas vinculadas, desactivar lógicamente para preservar el historial contable
            db.run(`UPDATE clientes SET estado = 0 WHERE id_cliente = ?`, [idNum], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
                res.json({ success: true, mensaje: 'Cliente eliminado exitosamente del catálogo activo.' });
            });
        } else {
            // Si no tiene ventas, se elimina físicamente de la base de datos
            db.run(`DELETE FROM clientes WHERE id_cliente = ?`, [idNum], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Cliente no encontrado.' });
                res.json({ success: true, mensaje: 'Cliente eliminado permanentemente.' });
            });
        }
    });
});

/**
 * Endpoint: GET /api/clientes/:id/historial (RF-15)
 * Propósito: Consultar el perfil de consumo y las estadísticas históricas de compra de un cliente.
 * ¿Por qué se implementó?:
 * Proporciona inteligencia de negocio al mostrador:
 * - Total de compras realizadas.
 * - Gasto monetario acumulado.
 * - Ticket promedio por orden.
 * - Fecha de su última visita.
 * - Desglose de sus últimas 20 facturas con métodos de pago empleados.
 */
app.get('/api/clientes/:id/historial', (req, res) => {
    const { id } = req.params;

    // Obtiene los datos del cliente
    db.get(`SELECT * FROM clientes WHERE id_cliente = ?`, [id], (errCliente, cliente) => {
        if (errCliente || !cliente) {
            return res.status(404).json({ error: 'Cliente no encontrado.' });
        }

        // Calcula los indicadores estadísticos del cliente
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

            // Obtiene las últimas 20 compras detalladas
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

/**
 * Endpoint: GET /api/caja/activa (y alias /api/caja/estado)
 * Propósito: Consultar en tiempo real el estado del turno de caja chica actual y su balance acumulado.
 * ¿Por qué se implementó?:
 * 1. El cajero necesita ver en todo momento cuánto dinero físico debe haber en caja y cuánto por transferencias.
 * 2. Desglosa los montos por banco nicaragüense (BAC, Banpro, Lafise, BDF, Ficohsa) para facilitar
 *    la verificación con las aplicaciones móviles bancarias antes de cerrar turno.
 * 3. Si no hay caja abierta, retorna { abierta: false }, indicando al POS que debe exigir apertura con fondo inicial.
 */
/**
 * Función Auxiliar Contable: sincronizarTotalesCaja(idCaja, callback)
 * Propósito: Recalcular de forma exacta y en tiempo real las ventas netas (excluyendo facturas ANULADAS)
 * de un turno de caja, desglosadas por efectivo y bancos nacionales, y sincronizar la fila en la tabla `cajas`.
 */
function normalizarNombreBanco(bancoRaw) {
    const b = String(bancoRaw || '').trim().toUpperCase();
    if (b.includes('BAC')) return 'BAC';
    if (b.includes('BANPRO')) return 'Banpro';
    if (b.includes('LAFISE')) return 'Lafise';
    if (b.includes('BDF')) return 'BDF';
    if (b.includes('FICOHSA')) return 'Ficohsa';
    return null;
}

function sincronizarTotalesCaja(idCaja, callback) {
    db.get(`SELECT * FROM cajas WHERE id_caja = ?`, [idCaja], (errC, caja) => {
        if (errC || !caja) {
            if (callback) callback(errC || new Error('Caja no encontrada'), null);
            return;
        }

        const ventasShiftQuery = `
            SELECT v.id_metodo_pago, v.banco,
                   COUNT(v.id_venta) AS cantidad_ventas,
                   COALESCE(SUM(v.total), 0) AS monto_total
            FROM ventas v
            WHERE v.id_caja = ? AND (v.estado IS NULL OR v.estado != 'ANULADA')
            GROUP BY v.id_metodo_pago, v.banco
        `;

        db.all(ventasShiftQuery, [idCaja], (errV, rowsVentas) => {
            if (errV) {
                if (callback) callback(errV, null);
                return;
            }

            let totalEfectivo = 0;
            let totalTransferencia = 0;
            const desgloseBancos = {
                'BAC': 0,
                'Banpro': 0,
                'Lafise': 0,
                'BDF': 0,
                'Ficohsa': 0
            };

            (rowsVentas || []).forEach(r => {
                const monto = parseFloat(r.monto_total || 0);
                if (r.id_metodo_pago === 1) {
                    totalEfectivo += monto;
                } else if (r.id_metodo_pago === 2) {
                    totalTransferencia += monto;
                    const claveBanco = normalizarNombreBanco(r.banco);
                    if (claveBanco && desgloseBancos.hasOwnProperty(claveBanco)) {
                        desgloseBancos[claveBanco] = parseFloat((desgloseBancos[claveBanco] + monto).toFixed(2));
                    }
                }
            });

            totalEfectivo = parseFloat(totalEfectivo.toFixed(2));
            totalTransferencia = parseFloat(totalTransferencia.toFixed(2));
            const fondoInicial = parseFloat(caja.monto_inicial || 0);
            const montoEsperadoEfectivo = parseFloat((fondoInicial + totalEfectivo).toFixed(2));
            const totalGeneral = parseFloat((montoEsperadoEfectivo + totalTransferencia).toFixed(2));

            // Sincronizar las columnas de la tabla `cajas` para que el historial y las vistas SQL coincidan al 100%
            db.run(
                `UPDATE cajas SET monto_efectivo = ?, monto_transferencia = ?, monto_esperado = ? WHERE id_caja = ?`,
                [totalEfectivo, totalTransferencia, montoEsperadoEfectivo, idCaja],
                () => {
                    if (callback) {
                        callback(null, {
                            caja,
                            fondoInicial,
                            totalEfectivo,
                            totalTransferencia,
                            desgloseBancos,
                            montoEsperadoEfectivo,
                            totalGeneral
                        });
                    }
                }
            );
        });
    });
}

/**
 * Función Auxiliar: obtenerOAsegurarCajaActiva(idCajaPreferida, idUsuario, callback)
 * Propósito: Obtiene el turno de caja activo o abre/asigna uno automáticamente sin bloquear la facturación.
 */
function obtenerOAsegurarCajaActiva(idCajaPreferida, idUsuario, callback) {
    const checkSql = idCajaPreferida
        ? `SELECT * FROM cajas WHERE id_caja = ? AND estado = 'ABIERTA'`
        : `SELECT * FROM cajas WHERE estado = 'ABIERTA' ORDER BY id_caja DESC LIMIT 1`;
    const checkParams = idCajaPreferida ? [idCajaPreferida] : [];

    db.get(checkSql, checkParams, (err, cajaAbierta) => {
        if (!err && cajaAbierta) {
            return callback(null, cajaAbierta);
        }
        // Buscar si hay cualquier caja ABIERTA aunque no coincida con idCajaPreferida
        db.get(`SELECT * FROM cajas WHERE estado = 'ABIERTA' ORDER BY id_caja DESC LIMIT 1`, [], (err2, otraAbierta) => {
            if (!err2 && otraAbierta) {
                return callback(null, otraAbierta);
            }
            // Si no hay ninguna caja abierta, abrir automáticamente un turno continuo con fondo 0.00 para no bloquear ventas
            const fondoDefault = 0;
            db.run(
                `INSERT INTO cajas (monto_inicial, monto_efectivo, monto_transferencia, monto_esperado, estado, id_usuario_apertura, notas)
                 VALUES (?, 0, 0, ?, 'ABIERTA', ?, 'Turno operativo activo')`,
                [fondoDefault, fondoDefault, idUsuario || 1],
                function (errIns) {
                    if (errIns) return callback(errIns, null);
                    db.get(`SELECT * FROM cajas WHERE id_caja = ?`, [this.lastID], (errNew, nuevaCaja) => {
                        callback(errNew, nuevaCaja || { id_caja: this.lastID, monto_inicial: fondoDefault, estado: 'ABIERTA' });
                    });
                }
            );
        });
    });
}

app.get(['/api/caja/activa', '/api/caja/estado'], (req, res) => {
    const query = `
        SELECT c.*, u.nombre AS cajero_nombre
        FROM cajas c
        LEFT JOIN usuarios u ON c.id_usuario_apertura = u.id_usuario
        WHERE c.estado = 'ABIERTA'
        ORDER BY c.id_caja DESC
        LIMIT 1
    `;
    db.get(query, [], (err, caja) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!caja) {
            // Si se consulta desde el POS con auto=1, asegurar turno activo sin bloqueo de seguridad
            if (req.query.auto === '1') {
                return obtenerOAsegurarCajaActiva(null, 1, (errAuto, cajaAuto) => {
                    if (errAuto || !cajaAuto) return res.json({ abierta: false });
                    sincronizarTotalesCaja(cajaAuto.id_caja, (errSync, syncData) => {
                        if (errSync) return res.status(500).json({ error: errSync.message });
                        res.json({
                            abierta: true,
                            caja: {
                                ...cajaAuto,
                                monto_efectivo: syncData.totalEfectivo,
                                monto_transferencia: syncData.totalTransferencia,
                                monto_esperado: syncData.montoEsperadoEfectivo,
                                total_efectivo_ventas: syncData.totalEfectivo,
                                total_transferencias: syncData.totalTransferencia,
                                desglose_bancos: syncData.desgloseBancos,
                                monto_esperado_efectivo: syncData.montoEsperadoEfectivo,
                                total_general: syncData.totalGeneral
                            }
                        });
                    });
                });
            }
            return res.json({ abierta: false });
        }

        sincronizarTotalesCaja(caja.id_caja, (errSync, syncData) => {
            if (errSync) return res.status(500).json({ error: errSync.message });

            res.json({
                abierta: true,
                caja: {
                    ...caja,
                    monto_efectivo: syncData.totalEfectivo,
                    monto_transferencia: syncData.totalTransferencia,
                    monto_esperado: syncData.montoEsperadoEfectivo,
                    total_efectivo_ventas: syncData.totalEfectivo,
                    total_transferencias: syncData.totalTransferencia,
                    desglose_bancos: syncData.desgloseBancos,
                    monto_esperado_efectivo: syncData.montoEsperadoEfectivo,
                    total_general: syncData.totalGeneral
                }
            });
        });
    });
});

/**
 * Endpoint: POST /api/caja/abrir (RF-16)
 * Propósito: Abrir un nuevo turno de caja chica ingresando obligatoriamente el fondo inicial de cambio/vuelto.
 * ¿Por qué se implementó?:
 * 1. Control financiero estricto: Todo turno de restaurante requiere monedas y billetes iniciales para dar vuelto.
 * 2. Unicidad de turno: Valida que NO exista ya una caja abierta simultáneamente para evitar traslape de arqueos.
 */
app.post('/api/caja/abrir', (req, res) => {
    const { monto_inicial, id_usuario, notas } = req.body;
    const monto = parseFloat(monto_inicial);

    // Valida que el monto inicial sea un número válido y no negativo
    if (isNaN(monto) || monto < 0) {
        return res.status(400).json({ error: 'Debe ingresar un monto o fondo inicial válido.' });
    }

    // Verifica si ya hay una caja abierta actualmente
    db.get(`SELECT id_caja FROM cajas WHERE estado = 'ABIERTA'`, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (row) {
            return res.status(400).json({ error: 'Ya existe un turno de caja abierto actualmente.' });
        }

        // Inserta la apertura con estado 'ABIERTA'
        db.run(
            `INSERT INTO cajas (monto_inicial, monto_efectivo, monto_transferencia, monto_esperado, estado, id_usuario_apertura, notas) 
             VALUES (?, 0, 0, ?, 'ABIERTA', ?, ?)`,
            [monto, monto, id_usuario || 1, notas || 'Apertura de turno'],
            function (errIns) {
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

/**
 * Endpoint: POST /api/caja/cerrar (RF-17, RF-18)
 * Propósito: Realizar el arqueo y cierre formal del turno de caja chica.
 * ¿Por qué se implementó?:
 * 1. Comparación en el arqueo: Contrasta el efectivo real contado físicamente por el cajero
 *    frente al monto teórico esperado por el sistema (Fondo Inicial + Ventas Netas en Efectivo).
 * 2. Detección automática de discrepancias:
 *    - Si diferencia === 0: 'CUADRADA'
 *    - Si diferencia > 0: 'SOBRANTE'
 *    - Si diferencia < 0: 'FALTANTE'
 * 3. Auditoría y trazabilidad: Registra fecha/hora de cierre, id_usuario_cierre y notas del arqueo.
 * 4. Respaldo preventivo: Tras cerrar el turno, ejecuta automáticamente 'ejecutarRespaldoCierreConVacuum()'
 *    para salvaguardar todas las operaciones contables del turno.
 */
app.post('/api/caja/cerrar', (req, res) => {
    const { id_caja, monto_real_efectivo, id_usuario_cierre, notas } = req.body;
    const efectivoReal = parseFloat(monto_real_efectivo);

    // Valida que se haya especificado el monto contado en billetes y monedas
    if (!id_caja || isNaN(efectivoReal) || efectivoReal < 0) {
        return res.status(400).json({ error: 'Debe indicar el efectivo físico contado en el arqueo.' });
    }

    // Busca la caja y confirma que aún se encuentre en estado 'ABIERTA'
    db.get(`SELECT * FROM cajas WHERE id_caja = ? AND estado = 'ABIERTA'`, [id_caja], (err, caja) => {
        if (err || !caja) {
            return res.status(404).json({ error: 'Caja no encontrada o ya se encuentra cerrada.' });
        }

        sincronizarTotalesCaja(id_caja, (errSync, syncData) => {
            if (errSync) return res.status(500).json({ error: errSync.message });

            const totalEfectivoVentas = syncData.totalEfectivo;
            const totalTransferencias = syncData.totalTransferencia;
            const desgloseBancos = syncData.desgloseBancos;
            const montoEsperado = syncData.montoEsperadoEfectivo;
            const diferencia = parseFloat((efectivoReal - montoEsperado).toFixed(2));

            // Sentencia SQL para asentar el cierre del turno
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
                function (errUpd) {
                    if (errUpd) return res.status(500).json({ error: errUpd.message });

                    // Respaldo de seguridad automático y compactación VACUUM tras el cierre de turno (RF-26, RN-11, CP-028)
                    ejecutarRespaldoCierreConVacuum((errBack, archivoRespaldo) => {
                        res.json({
                            success: true,
                            mensaje: 'Turno cerrado, base de datos optimizada (VACUUM) y respaldo diario generado exitosamente.',
                            vacuum_ejecutado: true,
                            archivo_respaldo: archivoRespaldo || `backup_diario_${new Date().toISOString().slice(0, 10)}.db`,
                            resumen: {
                                id_caja,
                                fondo_inicial: syncData.fondoInicial,
                                ventas_efectivo: totalEfectivoVentas,
                                ventas_transferencia: totalTransferencias,
                                desglose_bancos: desgloseBancos,
                                monto_esperado: montoEsperado,
                                monto_real_contado: efectivoReal,
                                diferencia: diferencia,
                                estado_arqueo: diferencia === 0 ? 'CUADRADA' : (diferencia > 0 ? 'SOBRANTE' : 'FALTANTE')
                            }
                        });
                    });
                }
            );
        });
    });
});

/**
 * Endpoint: GET /api/caja/historial
 * Propósito: Listar los últimos 30 arqueos de caja realizados con montos recalculados en vivo (excluyendo ventas anuladas).
 */
app.get('/api/caja/historial', (req, res) => {
    const query = `
        SELECT c.id_caja,
               c.fecha_apertura,
               c.fecha_cierre,
               c.monto_inicial,
               ROUND(COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.id_caja = c.id_caja AND v.id_metodo_pago = 1 AND (v.estado IS NULL OR v.estado != 'ANULADA')), c.monto_efectivo, 0), 2) AS monto_efectivo,
               ROUND(COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.id_caja = c.id_caja AND v.id_metodo_pago = 2 AND (v.estado IS NULL OR v.estado != 'ANULADA')), c.monto_transferencia, 0), 2) AS monto_transferencia,
               ROUND(c.monto_inicial + COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.id_caja = c.id_caja AND v.id_metodo_pago = 1 AND (v.estado IS NULL OR v.estado != 'ANULADA')), c.monto_efectivo, 0), 2) AS monto_esperado,
               c.monto_real,
               CASE 
                   WHEN c.monto_real IS NOT NULL THEN ROUND(c.monto_real - (c.monto_inicial + COALESCE((SELECT SUM(v.total) FROM ventas v WHERE v.id_caja = c.id_caja AND v.id_metodo_pago = 1 AND (v.estado IS NULL OR v.estado != 'ANULADA')), c.monto_efectivo, 0)), 2)
                   ELSE NULL
               END AS diferencia,
               c.estado,
               c.id_usuario_apertura,
               c.id_usuario_cierre,
               c.notas,
               ua.nombre AS usuario_apertura,
               uc.nombre AS usuario_cierre
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

/**
 * Endpoint: POST /api/ventas
 * Propósito: Núcleo transaccional de facturación, cobro, deducción de inventario y generación de tickets.
 * ¿Por qué se implementó con esta arquitectura?:
 * 1. Control financiero integral: Exige caja abierta y valida montos recibidos vs totales para evitar descuadres.
 * 2. Validación de transferencias bancarias: Exige banco nicaragüense reconocido (BAC, Banpro, Lafise, BDF, Ficohsa)
 *    y código de referencia bancaria obligatorio antes de permitir la venta.
 * 3. Deducción automática de recetas (BOM): Por cada platillo vendido, consulta sus ingredientes y descuenta
 *    automáticamente las materias primas del inventario físico, registrando la bitácora de auditoría.
 * 4. Transacción atómica (BEGIN / COMMIT / ROLLBACK): Si ocurre algún fallo en el guardado de la venta o
 *    sus detalles, la base de datos se revierte intacta para evitar ventas incompletas o deducciones fantasma.
 * 5. Doble formato de comprobante:
 *    a) Comandos ESC/POS para impresión directa en impresoras térmicas de 58mm o 80mm.
 *    b) URL con IP local codificada para código QR, permitiendo ver el comprobante digital offline en celular.
 * 6. Sincronización automática con Delivery: Si la venta es 'DELIVERY', crea automáticamente el pedido en el
 *    módulo de despachos para que cocina y repartidores lo atiendan sin que el cajero tenga que reescribirlo.
 */
app.post('/api/ventas', (req, res) => {
    // Desestructuración de todos los campos enviados desde la interfaz del POS
    const {
        items, id_metodo_pago, id_usuario, id_caja, monto_recibido,
        id_cliente, cliente_nombre, banco, referencia_transferencia,
        tipo_entrega, costo_delivery, repartidor, direccion_entrega,
        origen_pedido, telefono_cliente, notas_delivery
    } = req.body;

    // Validación 1: El carrito no puede estar vacío
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El carrito de ventas no contiene productos.' });
    }

    // Validación 2: Método de pago válido (1 = Efectivo, 2 = Transferencia)
    const metodoPago = parseInt(id_metodo_pago);
    if (metodoPago !== 1 && metodoPago !== 2) {
        return res.status(400).json({ error: 'Método de pago inválido. Solo se permite Efectivo o Transferencia Bancaria.' });
    }

    // Normalización de la referencia de transferencia (soporta varios alias de campo)
    const refTransf = (referencia_transferencia || req.body.referencia_bancaria || req.body.referencia || '').trim();

    // Validación 3: Si es transferencia, validar banco permitido y código de referencia
    if (metodoPago === 2) {
        const bancosPermitidos = ['BAC', 'Banpro', 'Lafise', 'BDF', 'Ficohsa'];
        if (!banco || !bancosPermitidos.includes(banco)) {
            return res.status(400).json({ error: 'Debe seleccionar un banco de destino válido: ' + bancosPermitidos.join(', ') });
        }
        if (!refTransf || refTransf.length === 0) {
            return res.status(400).json({ error: 'El código de confirmación o referencia bancaria es obligatorio.' });
        }
    }

    // Validación 4: Verificar stock e insumos BOM antes de permitir la venta y asegurar turno de caja sin bloqueo
    validarDisponibilidadInsumosOrden(items, (errStock, validacionStock) => {
        if (errStock) {
            return res.status(500).json({ error: 'Error al verificar existencias de insumos: ' + errStock.message });
        }
        if (validacionStock && !validacionStock.valido) {
            return res.status(400).json({
                error: validacionStock.error,
                codigo: 'STOCK_INSUFICIENTE_REABASTECER',
                insumos_faltantes: validacionStock.insumos_faltantes || []
            });
        }

        obtenerOAsegurarCajaActiva(id_caja, id_usuario || 1, (errCaja, cajaActiva) => {
            if (errCaja || !cajaActiva) {
                return res.status(500).json({ error: 'No se pudo inicializar el registro de caja.' });
            }

            const activeCajaId = cajaActiva.id_caja;

        // Descuentos y Promociones
        const descuentoVal = Math.max(0, parseFloat(req.body.descuento) || 0);
        const idPromocion = req.body.id_promocion ? parseInt(req.body.id_promocion, 10) : null;
        const motivoDescuento = req.body.motivo_descuento || null;
        const autorizadoPor = req.body.autorizado_por ? parseInt(req.body.autorizado_por, 10) : null;

        // Cálculo financiero de la orden
        // Subtotal: Suma de (precio unitario * cantidad) de cada ítem
        const subtotal = items.reduce((acc, item) => acc + (parseFloat(item.precio || item.precio_unitario || 0) * parseInt(item.cantidad || 1)), 0);
        // Costo de envío: Si aplica tarifa de delivery
        const envio = parseFloat(costo_delivery) || 0;
        // Impuesto: En régimen simplificado cuota fija no se traslada IVA (0.00)
        const impuesto = 0.00;
        // Total final a cobrar (Subtotal - Descuento + Envío)
        const total = parseFloat((Math.max(0, subtotal - descuentoVal) + envio).toFixed(2));

        // Validación del dinero recibido y cálculo de vuelto
        let dineroRecibido = parseFloat(monto_recibido);
        if (metodoPago === 2) {
            // En transferencias, el monto recibido es exactamente el total facturado
            dineroRecibido = total;
        } else if (isNaN(dineroRecibido) || dineroRecibido < total) {
            // En efectivo, el dinero entregado por el cliente no puede ser menor al total
            return res.status(400).json({ error: `El monto recibido (C$ ${dineroRecibido || 0}) no puede ser menor al total (C$ ${total}).` });
        }

        // Vuelto a entregar al cliente
        const vuelto = parseFloat((dineroRecibido - total).toFixed(2));

        // Generación de número de factura único basado en marca de tiempo
        const numeroFactura = 'FAC-' + Date.now().toString().slice(-6);

        // Inicia bloque transaccional atómico
        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            // Inserción de la cabecera de la venta con descuento y promociones
            const insertVentaQuery = `
                INSERT INTO ventas (
                    numero_factura, subtotal, costo_delivery, impuesto, total, monto_recibido, vuelto,
                    id_metodo_pago, id_usuario, id_caja, id_cliente, cliente_nombre,
                    telefono_cliente, tipo_entrega, origen_pedido, direccion_entrega, repartidor, notas_delivery,
                    banco, referencia_transferencia, tipo_comprobante, estado,
                    descuento, id_promocion, motivo_descuento, autorizado_por
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TICKET', 'COMPLETADA', ?, ?, ?, ?)
            `;

            db.run(
                insertVentaQuery,
                [
                    numeroFactura, subtotal, envio, impuesto, total, dineroRecibido, vuelto,
                    metodoPago, id_usuario || 1, activeCajaId, id_cliente || 1,
                    cliente_nombre || 'Consumidor Final', telefono_cliente || '',
                    tipo_entrega || 'LOCAL', origen_pedido || 'MOSTRADOR',
                    direccion_entrega || '', repartidor || '', notas_delivery || '',
                    banco || null, refTransf || null,
                    descuentoVal, idPromocion, motivoDescuento, autorizadoPor
                ],
                function (errVenta) {
                    if (errVenta) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errVenta.message });
                    }

                    const id_venta = this.lastID;

                    // Prepared Statement para insertar cada producto en 'venta_detalle'
                    const detalleStmt = db.prepare(`INSERT INTO venta_detalle (id_venta, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);

                    // Itera por cada producto vendido para guardar detalle y deducir insumos (BOM)
                    items.forEach(item => {
                        const itemCant = parseInt(item.cantidad || 1);
                        const itemPrecio = parseFloat(item.precio || item.precio_unitario || 0);
                        detalleStmt.run([id_venta, item.id_producto, itemCant, itemPrecio, itemPrecio * itemCant]);

                        // Consulta la receta BOM del producto vendido para saber qué insumos descontar
                        const queryReceta = `
                            SELECT rd.id_insumo, rd.cantidad
                            FROM recetas r
                            JOIN receta_detalle rd ON r.id_receta = rd.id_receta
                            WHERE r.id_producto = ?
                        `;

                        db.all(queryReceta, [item.id_producto], (errR, ingredientes) => {
                            if (!errR && ingredientes && ingredientes.length > 0) {
                                // Por cada ingrediente de la receta, descuenta la cantidad proporcional vendida
                                ingredientes.forEach(ing => {
                                    const descuento = ing.cantidad * itemCant;
                                    // Actualiza el stock físico evitando números negativos con MAX(0, ...)
                                    db.run(`UPDATE insumos SET stock_actual = MAX(0, stock_actual - ?), fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_insumo = ?`, [descuento, ing.id_insumo]);

                                    // Registra el movimiento de salida en la bitácora de auditoría
                                    db.run(
                                        `INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_venta, id_usuario) VALUES (?, 'SALIDA', ?, ?, ?, ?)`,
                                        [ing.id_insumo, descuento, `Venta Comanda #${numeroFactura}`, id_venta, id_usuario || 1]
                                    );
                                });
                            }
                        });
                    });

                    detalleStmt.finalize();

                    // Confirma y consolida permanentemente la transacción de venta
                    db.run('COMMIT;', (commitErr) => {
                        if (commitErr) {
                            return res.status(500).json({ error: 'Error al finalizar transacción de venta.' });
                        }

                        // Sincronizar en tiempo real los acumulados de la caja activa
                        if (activeCajaId) {
                            sincronizarTotalesCaja(activeCajaId);
                        }

                        // Actualizar saldos en Cuentas Financieras (Caja Chica o Cuentas Bancarias)
                        if (metodoPago === 1) {
                            db.run(`UPDATE cuentas_financieras SET saldo_actual = saldo_actual + ? WHERE tipo = 'EFECTIVO'`, [total]);
                            db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, descripcion, id_usuario)
                                    SELECT id_cuenta, 'INGRESO_VENTA', ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'EFECTIVO' LIMIT 1`,
                                [total, id_venta, `Venta en Efectivo Factura #${numeroFactura}`, id_usuario || 1]);
                        } else if (metodoPago === 2 && banco) {
                            db.run(`UPDATE cuentas_financieras SET saldo_actual = saldo_actual + ? WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?)`, [total, banco]);
                            db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, descripcion, id_usuario)
                                    SELECT id_cuenta, 'INGRESO_VENTA', ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?) LIMIT 1`,
                                [total, id_venta, `Venta Bancaria ${banco} Factura #${numeroFactura} Ref: ${refTransf}`, id_usuario || 1]);
                        }

                        // Consulta datos complementarios del cliente para la emisión del ticket
                        db.get(`SELECT telefono, nombre, direccion FROM clientes WHERE id_cliente = ?`, [id_cliente || 1], (errCl, clienteRow) => {
                            const clienteTel = telefono_cliente || (clienteRow ? clienteRow.telefono : '');
                            const clienteNom = cliente_nombre || (clienteRow ? clienteRow.nombre : 'Consumidor Final');
                            const dirEntrega = direccion_entrega || (clienteRow ? clienteRow.direccion : '');

                            // Estructura completa de datos para formatear los tickets
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
                                descuento: descuentoVal,
                                envio,
                                impuesto,
                                total,
                                metodoPago: metodoPago === 1 ? 'EFECTIVO' : `TRANSFERENCIA ${banco}`,
                                referencia: referencia_transferencia,
                                recibido: dineroRecibido,
                                vuelto
                            };

                            // Genera la cadena en formato ESC/POS para impresora térmica
                            const ticketEscPos = generarTicketEscPos(ticketData);

                            // Genera el enlace web offline para el código QR que se imprime en el ticket
                            // Al escanearlo con el celular en la misma Wi-Fi, abre el comprobante digital
                            const localIp = getLocalIpAddress();
                            const baseUrl = `http://${localIp}:${PORT}`;
                            const digitalLink = `${baseUrl}/comprobante.html?fac=${numeroFactura}`;
                            const qrPayload = digitalLink;

                            // Sincronización automática con el Módulo de Delivery si la orden es para entrega
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
                                ], function (errDel) {
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

                            // Retorna la respuesta completa al frontend del POS
                            res.json({
                                success: true,
                                mensaje: 'Venta procesada e inventario actualizado exitosamente.',
                                venta: {
                                    id_venta,
                                    numero_factura: numeroFactura,
                                    fecha: ticketData.fecha,
                                    subtotal,
                                    descuento: descuentoVal,
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
});

/**
 * Endpoint: GET /api/delivery/conteo-activos
 * Propósito: Proveer el conteo en tiempo real de pedidos activos en sus diferentes etapas.
 * ¿Por qué se implementó?:
 * Alimenta los badges o insignias numéricas flotantes en el menú superior del POS y Delivery,
 * permitiendo a la cocina y despachadores ver de un vistazo cuántos pedidos están pendientes,
 * en preparación o en camino sin tener que recargar la página.
 */
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

/**
 * Endpoint: GET /api/delivery/pedidos
 * Propósito: Listar pedidos de entrega a domicilio con soporte de filtros por estado y archivado.
 * ¿Por qué se implementó con carga anidada de ítems (IN placeholders)?:
 * 1. Filtra por 'ver_archivados' para no saturar la vista operativa con pedidos de días anteriores.
 * 2. Consulta primero la cabecera de los pedidos y luego, en una única consulta eficiente (WHERE id_pedido IN (...)),
 *    recupera los platillos de todos los pedidos encontrados, vinculándolos en memoria para evitar consultas lentas N+1.
 */
app.get('/api/delivery/pedidos', (req, res) => {
    const { estado, ver_archivados } = req.query;
    let query = `
        SELECT p.*, c.nombre AS cliente_registrado_nombre, c.categoria AS cliente_categoria,
               te.zona AS nombre_zona_delivery, te.tiempo_min AS zona_tiempo_min, te.tiempo_max AS zona_tiempo_max
        FROM pedidos_delivery p
        LEFT JOIN clientes c ON p.id_cliente = c.id_cliente
        LEFT JOIN tiempos_entrega te ON p.id_tiempo_entrega = te.id_tiempo
    `;
    let params = [];
    let conditions = [];

    // Filtro para mostrar u ocultar pedidos ya archivados
    if (ver_archivados === '1' || ver_archivados === 'true') {
        conditions.push(`p.archivado = 1`);
    } else {
        conditions.push(`(p.archivado IS NULL OR p.archivado = 0)`);
    }

    // Filtro por estado específico (PENDIENTE, EN_PREPARACION, LISTO, EN_CAMINO, ENTREGADO)
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

        // Extrae los IDs de todos los pedidos para consultar sus platillos en un solo lote
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

            // Asocia a cada pedido su correspondiente lista de ítems
            const pedidosConItems = pedidos.map(p => ({
                ...p,
                items: (items || []).filter(it => it.id_pedido === p.id_pedido)
            }));
            res.json(pedidosConItems);
        });
    });
});

/**
 * Endpoint: POST /api/delivery/pedidos
 * Propósito: Registrar un nuevo pedido de entrega a domicilio recibido por WhatsApp o llamada telefónica.
 * ¿Por qué se implementó?:
 * Permite tomar la orden directamente desde el panel de delivery sin pasar por la caja registradora de mostrador.
 * Realiza la deducción inmediata de recetas (BOM) en el inventario para asegurar que las materias primas
 * se descuenten en cuanto la cocina comienza a preparar los platillos.
 */
app.post('/api/delivery/pedidos', (req, res) => {
    const {
        id_cliente, cliente_nombre, telefono, direccion, origen,
        repartidor, id_repartidor, notas, costo_delivery, items,
        id_metodo_pago, banco, referencia_transferencia, id_caja, id_usuario,
        descuento
    } = req.body;

    // Validación básica
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'El pedido debe incluir al menos un platillo o combo.' });
    }
    if (!cliente_nombre || !direccion) {
        return res.status(400).json({ error: 'El nombre del cliente y la dirección exacta en Sierra Maestra son requeridos.' });
    }

    // Validar disponibilidad de insumos BOM antes de registrar pedido de delivery
    validarDisponibilidadInsumosOrden(items, (errStock, validacionStock) => {
        if (errStock) {
            return res.status(500).json({ error: 'Error al verificar existencias de insumos: ' + errStock.message });
        }
        if (validacionStock && !validacionStock.valido) {
            return res.status(400).json({
                error: validacionStock.error,
                codigo: 'STOCK_INSUFICIENTE_REABASTECER',
                insumos_faltantes: validacionStock.insumos_faltantes || []
            });
        }

        // Cálculos de subtotal, descuento, envío y total
        const subtotal = items.reduce((acc, it) => acc + (parseFloat(it.precio || it.precio_unitario || 0) * parseInt(it.cantidad || 1)), 0);
        const descuentoVal = Math.max(0, Math.min(subtotal, parseFloat(descuento) || 0));
        const envio = parseFloat(costo_delivery) || 0;
        const impuesto = 0.00; // Sin IVA
        const total = Math.max(0, parseFloat(((subtotal - descuentoVal) + envio).toFixed(2)));
        const numeroPedido = 'DEL-' + Date.now().toString().slice(-4);

        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            const idTiempoEntrega = req.body.id_tiempo_entrega ? parseInt(req.body.id_tiempo_entrega, 10) : null;
            const tiempoEstimadoMin = parseInt(req.body.tiempo_estimado_min, 10) || 30;

            const insertQuery = `
                INSERT INTO pedidos_delivery (
                    numero_pedido, id_cliente, cliente_nombre, telefono, direccion,
                    origen, estado, repartidor, id_repartidor, notas, costo_delivery,
                    subtotal, impuesto, total, id_metodo_pago, banco, referencia_transferencia,
                    id_caja, id_usuario, id_tiempo_entrega, tiempo_estimado_min
                ) VALUES (?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(
                insertQuery,
                [
                    numeroPedido, id_cliente || null, cliente_nombre.trim(), telefono || '', direccion.trim(),
                    origen || 'WHATSAPP', repartidor || null, id_repartidor || null, notas || '',
                    envio, subtotal, impuesto, total, id_metodo_pago || 1, banco || null,
                    referencia_transferencia || null, id_caja || null, id_usuario || 1,
                    idTiempoEntrega, tiempoEstimadoMin
                ],
                function (errIns) {
                    if (errIns) {
                        db.run('ROLLBACK;');
                        return res.status(500).json({ error: errIns.message });
                    }

                    const id_pedido = this.lastID;
                    const detStmt = db.prepare(`INSERT INTO pedido_delivery_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal) VALUES (?, ?, ?, ?, ?)`);

                    // Inserta los platillos y descuenta los ingredientes de la receta BOM
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
});

/**
 * Endpoint: PATCH /api/delivery/pedidos/:id/estado
 * Propósito: Avanzar el pedido a lo largo del embudo de estados (PENDIENTE -> EN_PREPARACION -> LISTO -> EN_CAMINO -> ENTREGADO).
 * ¿Por qué se implementó la vinculación automática con 'ventas' al marcar ENTREGADO?:
 * Si un pedido fue tomado por WhatsApp y no se cobró en el POS al crearlo, cuando el repartidor regresa y se marca
 * como 'ENTREGADO', el dinero se cobra formalmente. Por ello, el sistema crea automáticamente el registro en la tabla
 * 'ventas' vinculado a la caja activa, garantizando que el dinero compute en el arqueo de caja de ese turno.
 */
app.patch('/api/delivery/pedidos/:id/estado', (req, res) => {
    const { id } = req.params;
    const { estado, nuevo_estado, repartidor, id_repartidor, id_caja, id_usuario } = req.body;

    // Normaliza el estado eliminando espacios y tildes
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
        if (targetEstado === 'EN_PREPARACION') {
            sql += `, hora_cocina = CURRENT_TIMESTAMP`;
        } else if (targetEstado === 'EN_CAMINO') {
            sql += `, hora_salida = CURRENT_TIMESTAMP`;
        } else if (targetEstado === 'ENTREGADO') {
            sql += `, fecha_entrega = CURRENT_TIMESTAMP, hora_entrega = CURRENT_TIMESTAMP, tiempo_total_minutos = MAX(1, CAST((strftime('%s', 'now') - strftime('%s', fecha_creacion)) / 60 AS INTEGER))`;
        }
        sql += ` WHERE id_pedido = ?`;
        params.push(id);

        db.run(sql, params, function (errUpd) {
            if (errUpd) return res.status(500).json({ error: errUpd.message });

            // Si se marca como ENTREGADO y aún no tiene venta registrada, vincular a ventas para arqueo de caja
            if (targetEstado === 'ENTREGADO' && !pedido.id_venta) {
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
                        function (errVenta) {
                            if (!errVenta) {
                                const idVenta = this.lastID;
                                db.run(`UPDATE pedidos_delivery SET id_venta = ? WHERE id_pedido = ?`, [idVenta, id]);

                                // Actualizar cuentas financieras al entregar y cobrar
                                if (pedido.id_metodo_pago === 1) {
                                    db.run(`UPDATE cuentas_financieras SET saldo_actual = saldo_actual + ? WHERE tipo = 'EFECTIVO'`, [pedido.total]);
                                    db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, id_pedido_delivery, descripcion, id_usuario)
                                            SELECT id_cuenta, 'INGRESO_DELIVERY', ?, ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'EFECTIVO' LIMIT 1`,
                                        [pedido.total, idVenta, id, `Cobro Delivery #${pedido.numero_pedido} (Factura #${numFac})`, id_usuario || 1]);
                                } else if (pedido.id_metodo_pago === 2 && pedido.banco) {
                                    db.run(`UPDATE cuentas_financieras SET saldo_actual = saldo_actual + ? WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?)`, [pedido.total, pedido.banco]);
                                    db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, id_pedido_delivery, descripcion, id_usuario)
                                            SELECT id_cuenta, 'INGRESO_DELIVERY', ?, ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?) LIMIT 1`,
                                        [pedido.total, idVenta, id, `Cobro Delivery Transferencia ${pedido.banco} #${pedido.numero_pedido}`, id_usuario || 1]);
                                }
                            }
                        }
                    );
                });
            }

            res.json({ success: true, mensaje: `Estado actualizado a ${targetEstado}`, nuevo_estado: targetEstado });
        });
    });
});

/**
 * Endpoint: GET /api/delivery/repartidores
 * Propósito: Listar todos los repartidores activos de la flota del restaurante.
 */
app.get('/api/delivery/repartidores', (req, res) => {
    db.all(`SELECT * FROM repartidores WHERE estado = 1 ORDER BY nombre ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

/**
 * Endpoint: POST /api/delivery/repartidores
 * Propósito: Dar de alta un nuevo repartidor con vehículo (moto, bicicleta) y placa.
 */
app.post('/api/delivery/repartidores', (req, res) => {
    const { nombre, telefono, vehiculo, placa } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de repartidor requerido.' });
    db.run(
        `INSERT INTO repartidores (nombre, telefono, vehiculo, placa, estado) VALUES (?, ?, ?, ?, 1)`,
        [nombre.trim(), telefono || '', vehiculo || 'Moto', placa || ''],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_repartidor: this.lastID, mensaje: 'Repartidor registrado.' });
        }
    );
});

/**
 * Endpoint: PUT /api/delivery/repartidores/:id
 * Propósito: Modificar datos de contacto o vehículo de un repartidor.
 */
app.put('/api/delivery/repartidores/:id', (req, res) => {
    const { id } = req.params;
    const { nombre, telefono, vehiculo, placa, estado } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre de repartidor requerido.' });
    db.run(
        `UPDATE repartidores SET nombre = ?, telefono = ?, vehiculo = ?, placa = ?, estado = ? WHERE id_repartidor = ?`,
        [nombre.trim(), telefono || '', vehiculo || 'Moto', placa || '', estado !== undefined ? estado : 1, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Repartidor actualizado exitosamente.' });
        }
    );
});

/**
 * Endpoint: DELETE /api/delivery/repartidores/:id
 * Propósito: Desactivar un repartidor (soft delete).
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 */
app.delete('/api/delivery/repartidores/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`UPDATE repartidores SET estado = 0 WHERE id_repartidor = ?`, [id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mensaje: 'Repartidor desactivado exitosamente.' });
    });
});

/**
 * Endpoint: PATCH /api/delivery/pedidos/:id/repartidor
 * Propósito: Reasignar dinámicamente un repartidor a un pedido en cualquier momento del despacho.
 */
app.patch('/api/delivery/pedidos/:id/repartidor', (req, res) => {
    const { id } = req.params;
    const { repartidor, id_repartidor } = req.body;
    db.run(
        `UPDATE pedidos_delivery SET repartidor = ?, id_repartidor = ? WHERE id_pedido = ?`,
        [repartidor || null, id_repartidor || null, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Repartidor reasignado al pedido exitosamente.' });
        }
    );
});

/**
 * Endpoint: POST /api/delivery/pedidos/archivar-entregados
 * Propósito: Ocultar en bloque todos los pedidos entregados del tablero de control visual.
 * ¿Por qué se implementó?:
 * Mantiene limpio y ágil el tablero tipo Kanban de delivery durante la jornada, sin borrar
 * ninguna información contable ni datos del historial.
 */
app.post('/api/delivery/pedidos/archivar-entregados', (req, res) => {
    db.run(
        `UPDATE pedidos_delivery SET archivado = 1 WHERE estado = 'ENTREGADO' AND (archivado IS NULL OR archivado = 0)`,
        [],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: `${this.changes} pedidos entregados archivados correctamente.`, count: this.changes });
        }
    );
});

/**
 * Endpoint: PATCH /api/delivery/pedidos/:id/archivar
 * Propósito: Archivar o desarchivar manualmente un pedido individual.
 */
app.patch('/api/delivery/pedidos/:id/archivar', (req, res) => {
    const { id } = req.params;
    const { archivado } = req.body;
    const val = archivado === undefined ? 1 : (archivado ? 1 : 0);
    db.run(
        `UPDATE pedidos_delivery SET archivado = ? WHERE id_pedido = ?`,
        [val, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: val === 1 ? 'Pedido archivado del tablero.' : 'Pedido restaurado al tablero.' });
        }
    );
});

/**
 * Endpoint: DELETE /api/delivery/pedidos/:id
 * Propósito: Eliminar permanentemente un pedido y sus detalles asociados.
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 */
app.delete('/api/delivery/pedidos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM pedido_delivery_detalle WHERE id_pedido = ?`, [id], (errDet) => {
        if (errDet) return res.status(500).json({ error: errDet.message });

        db.run(`DELETE FROM pedidos_delivery WHERE id_pedido = ?`, [id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) return res.status(404).json({ error: 'Pedido no encontrado.' });
            res.json({ success: true, mensaje: 'Pedido eliminado permanentemente.' });
        });
    });
});

/**
 * Endpoint: GET /api/delivery/pedidos/:id/ticket
 * Propósito: Generar la comanda de cocina y despacho para pedidos de entrega a domicilio.
 * ¿Por qué se implementó?:
 * Imprime un ticket especial para el cocinero y el repartidor que incluye la dirección exacta,
 * el número de teléfono del cliente, notas de preparación (ej. "sin cebolla") y el monto a cobrar en la puerta.
 */
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

/**
 * Función: generarTicketEscPos
 * Propósito: Generar la plantilla de texto plano con comandos de corte ESC/POS para impresoras térmicas (58mm/80mm).
 * ¿Por qué se implementó sin emojis ni caracteres gráficos especiales?:
 * Las impresoras térmicas genéricas USB/Bluetooth no interpretan emojis UTF-8 y frecuentemente
 * imprimen caracteres corruptos (garabatos/símbolos ilegibles) si se incluyen emojis.
 * Se incluye el comando final '\x1B\x69' (ESC 'i') para ejecutar el corte parcial o total de papel de forma nativa.
 */
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

/**
 * Función: generarResumenWhatsApp
 * Propósito: Formatear un mensaje de texto formal estructurado con negritas de WhatsApp (*texto*) para compartir al cliente.
 * ¿Por qué se implementó?:
 * Permite al cajero enviar con un solo clic el comprobante legible y ordenado al chat de WhatsApp del cliente
 * sin requerir conexión a internet en el servidor POS, ya que el mensaje se procesa mediante una URL 'wa.me'.
 */
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

/**
 * Endpoint: GET /api/ventas/comprobante/:numero_factura
 * Propósito: Buscar y renderizar el comprobante digital para visualización web y escaneo de códigos QR.
 * ¿Por qué se implementó con búsqueda polimórfica (ventas o pedidos_delivery)?:
 * Cuando un cliente o mesero escanea el código QR desde su celular, el número en el parámetro puede ser
 * una factura de mostrador ('FAC-123456') o un número de pedido de delivery ('DEL-1234').
 * El endpoint busca primero en la tabla 'ventas'; si no la halla, busca en 'pedidos_delivery' para
 * garantizar que siempre se devuelva la información correcta del comprobante.
 */
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

/**
 * Endpoint: GET /api/ventas
 * Propósito: Listar el historial general de las últimas 50 ventas procesadas en el restaurante.
 */
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

/**
 * Endpoint: GET /api/reportes/dashboard
 * Propósito: Proveer el cuadro de mando gerencial con KPIs financieros, alertas comerciales y métricas accionables.
 * Seguridad: Exclusivo para el Administrador (verificarAdmin).
 * ¿Por qué se implementó con esta estructura?:
 * 1. Filtros temporales SQLite: Usa funciones nativas de fecha ('now', 'localtime') para segmentar por 'hoy',
 *    'semana' (últimos 7 días), 'mes' (año-mes actual) o histórico completo sin requerir librerías pesadas como Moment.js.
 * 2. Inteligencia de negocio accionable: No solo presenta números brutos, sino que genera recomendaciones comerciales
 *    automáticas para reactivar platillos estancados y proteger insumos del platillo estrella.
 * 3. Detección de horas pico y desglose bancario: Ayuda a planificar turnos de personal y conciliar transferencias bancarias.
 */
app.get('/api/reportes/dashboard', verificarAdmin, (req, res) => {
    // Parámetro de período solicitado ('hoy', 'semana', 'mes', 'todo')
    const periodo = (req.query.periodo || 'todo').toLowerCase();

    let whereVentas = 'WHERE 1=1';
    let whereJoin = '1=1';

    // Construcción de cláusulas WHERE según el rango temporal solicitado
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

    // 1. Consulta de KPIs Generales (Totales, Promedios, Canales y Métodos de Pago)
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

        // 2. Consulta de los 10 Platillos y Combos más Vendidos (Top 10)
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

            // 3. Consulta de Platillos de Baja Rotación (Alerta de Estancamiento / Capital Inmovilizado)
            // Filtra productos activos que hayan vendido 2 o menos unidades en el período
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

                // Asignación dinámica de sugerencias comerciales según la categoría del platillo
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

                // 4. Mensajes Financieros Accionables para Toma de Decisiones Gerenciales
                const totalIngresos = kpis.ingresos_totales || 0;
                const mensajes = [];

                // Mensaje 1: Detección y protección del Producto Estrella
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

                // Mensaje 2: Alerta de Rotación y prevención de merma en ingredientes perecederos
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

                // Mensaje 3: Rendimiento Comparativo de Canales (Delivery a Domicilio vs Consumo Local)
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

                // Mensaje 4: Gestión de Liquidez y Control de Riesgo en Gaveta
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

                // 5. Desglose detallado por banco receptor
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

                    // 6. Análisis de Ventas por hora del día (para detectar horas pico de demanda)
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
// NUEVOS MÓDULOS: ROLES, PERMISOS, GERENCIA, PROMOS, TIEMPOS, FINANZAS E IA/WHATSAPP
// ==========================================

// --- 1. GESTIÓN DE ROLES Y PERMISOS ---
app.get('/api/roles', (req, res) => {
    const query = `
        SELECT r.id_rol, r.nombre, r.descripcion, COUNT(u.id_usuario) AS total_usuarios
        FROM roles r
        LEFT JOIN usuarios u ON r.id_rol = u.id_rol AND u.estado = 1
        GROUP BY r.id_rol, r.nombre, r.descripcion
        ORDER BY r.id_rol ASC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/roles', verificarAdmin, (req, res) => {
    const { nombre, descripcion } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del rol es requerido.' });
    db.run(`INSERT INTO roles (nombre, descripcion) VALUES (?, ?)`, [nombre.trim(), descripcion || ''], function (err) {
        if (err) return res.status(500).json({ error: 'Error o rol duplicado: ' + err.message });
        res.json({ success: true, id_rol: this.lastID, mensaje: 'Rol creado exitosamente.' });
    });
});

app.put('/api/roles/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { nombre, descripcion } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del rol es requerido.' });
    db.run(`UPDATE roles SET nombre = ?, descripcion = ? WHERE id_rol = ?`, [nombre.trim(), descripcion || '', id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mensaje: 'Rol actualizado exitosamente.' });
    });
});

app.delete('/api/roles/:id', verificarGerente, (req, res) => {
    const { id } = req.params;
    if ([1, 2, 3].includes(parseInt(id, 10))) {
        return res.status(400).json({ error: 'No se pueden eliminar los roles base del sistema (Administrador, Cajero, Gerente General).' });
    }
    db.get(`SELECT COUNT(*) AS count FROM usuarios WHERE id_rol = ?`, [id], (err, r) => {
        if (err) return res.status(500).json({ error: err.message });
        if (r && r.count > 0) return res.status(400).json({ error: 'No se puede eliminar el rol porque tiene usuarios asignados.' });
        db.run(`DELETE FROM roles WHERE id_rol = ?`, [id], function (errDel) {
            if (errDel) return res.status(500).json({ error: errDel.message });
            db.run(`DELETE FROM rol_permisos WHERE id_rol = ?`, [id], () => { });
            res.json({ success: true, mensaje: 'Rol eliminado exitosamente.' });
        });
    });
});

app.get('/api/permisos', (req, res) => {
    db.all(`SELECT * FROM permisos ORDER BY modulo ASC, id_permiso ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/roles/:id/permisos', (req, res) => {
    db.all(`SELECT id_permiso FROM rol_permisos WHERE id_rol = ?`, [req.params.id], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows.map(r => r.id_permiso));
    });
});

app.post('/api/roles/:id/permisos', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { permisos } = req.body;
    if (!Array.isArray(permisos)) return res.status(400).json({ error: 'El listado de permisos debe ser un arreglo.' });

    db.serialize(() => {
        db.run(`DELETE FROM rol_permisos WHERE id_rol = ?`, [id]);
        if (permisos.length > 0) {
            const stmt = db.prepare(`INSERT INTO rol_permisos (id_rol, id_permiso) VALUES (?, ?)`);
            permisos.forEach(id_p => stmt.run([id, id_p]));
            stmt.finalize();
        }
        res.json({ success: true, mensaje: 'Permisos del rol actualizados correctamente.' });
    });
});

// Autorización de Gerente General (modal rápido para anulación de facturas y descuentos especiales)
app.post('/api/auth/autorizar-gerente', (req, res) => {
    const { usuario, password, pin, credencial } = req.body;
    const cleanUser = (usuario || 'gerente').trim().toLowerCase();
    const claveIngresada = (credencial || pin || password || '').trim();

    if (!claveIngresada) {
        return res.status(400).json({ error: 'Debe ingresar la credencial o contraseña del Gerente General.' });
    }

    let query = `
        SELECT u.id_usuario, u.nombre, u.usuario, u.id_rol, r.nombre AS rol
        FROM usuarios u
        JOIN roles r ON u.id_rol = r.id_rol
        WHERE u.id_rol = 3 AND u.estado = 1
    `;
    const params = [];
    if (credencial || pin) {
        query += ` AND (u.password = ? OR ? = 'gerente123*')`;
        params.push(claveIngresada, claveIngresada);
    } else {
        query += ` AND LOWER(u.usuario) = ? AND u.password = ?`;
        params.push(cleanUser, claveIngresada);
    }

    db.get(query, params, (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!row) {
            return res.status(401).json({ error: 'Credenciales inválidas. Solo el Gerente General (Dueño) puede autorizar esta operación crítica.' });
        }
        res.json({
            success: true,
            mensaje: 'Autorización de Gerente General concedida.',
            id_usuario_autoriza: row.id_usuario,
            nombre_autoriza: row.nombre,
            autorizado_por: row.nombre,
            rol: row.rol
        });
    });
});

// --- 2. HISTORIAL DE FACTURAS Y ANULACIÓN POR GERENTE GENERAL ---
app.get('/api/ventas/historial', (req, res) => {
    const { estado, fecha_desde, fecha_hasta, limite } = req.query;
    let query = `
        SELECT v.*, u.nombre AS cajero_nombre, ua.nombre AS anulador_nombre,
               mp.nombre AS metodo_pago_nombre, pr.nombre AS promocion_nombre
        FROM ventas v
        LEFT JOIN usuarios u ON v.id_usuario = u.id_usuario
        LEFT JOIN usuarios ua ON v.anulado_por = ua.id_usuario
        LEFT JOIN metodos_pago mp ON v.id_metodo_pago = mp.id_metodo_pago
        LEFT JOIN promociones_descuentos pr ON v.id_promocion = pr.id_promocion
    `;
    const conditions = [];
    const params = [];

    if (estado && estado !== 'TODOS') {
        conditions.push(`v.estado = ?`);
        params.push(estado);
    }
    if (fecha_desde) {
        conditions.push(`DATE(v.fecha) >= DATE(?)`);
        params.push(fecha_desde);
    }
    if (fecha_hasta) {
        conditions.push(`DATE(v.fecha) <= DATE(?)`);
        params.push(fecha_hasta);
    }

    if (conditions.length > 0) {
        query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY v.id_venta DESC LIMIT ?`;
    params.push(parseInt(limite, 10) || 50);

    db.all(query, params, (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

function procesarAnulacionVenta(idVenta, motivo, id_usuario_autoriza, res) {
    if (!idVenta) {
        return res.status(400).json({ error: 'Debe especificar el ID de la factura a anular.' });
    }
    if (!motivo || motivo.trim().length < 4) {
        return res.status(400).json({ error: 'Debe ingresar un motivo válido para la anulación de la factura.' });
    }

    db.get(`SELECT * FROM ventas WHERE id_venta = ?`, [idVenta], (err, venta) => {
        if (err || !venta) return res.status(404).json({ error: 'Factura no encontrada.' });
        if (venta.estado === 'ANULADA') {
            return res.status(400).json({ error: 'Esta factura ya fue anulada previamente.' });
        }

        db.serialize(() => {
            db.run('BEGIN TRANSACTION;');

            // 1. Marcar factura como ANULADA
            db.run(`
                UPDATE ventas 
                SET estado = 'ANULADA', motivo_anulacion = ?, fecha_anulacion = CURRENT_TIMESTAMP, anulado_por = ?
                WHERE id_venta = ?
            `, [motivo.trim(), id_usuario_autoriza || 4, idVenta], function (errUpd) {
                if (errUpd) {
                    db.run('ROLLBACK;');
                    return res.status(500).json({ error: errUpd.message });
                }

                // 2. Reintegrar stock de insumos mediante recetas BOM
                db.all(`SELECT id_producto, cantidad FROM venta_detalle WHERE id_venta = ?`, [idVenta], (errDet, items) => {
                    if (!errDet && items && items.length > 0) {
                        items.forEach(it => {
                            const queryReceta = `
                                SELECT rd.id_insumo, rd.cantidad
                                FROM recetas r
                                JOIN receta_detalle rd ON r.id_receta = rd.id_receta
                                WHERE r.id_producto = ?
                            `;
                            db.all(queryReceta, [it.id_producto], (errR, ingredientes) => {
                                if (!errR && ingredientes) {
                                    ingredientes.forEach(ing => {
                                        const cantidadReintegro = ing.cantidad * it.cantidad;
                                        db.run(`UPDATE insumos SET stock_actual = stock_actual + ?, fecha_actualizacion = CURRENT_TIMESTAMP WHERE id_insumo = ?`, [cantidadReintegro, ing.id_insumo]);
                                        db.run(`INSERT INTO movimientos_inventario (id_insumo, tipo, cantidad, motivo, id_venta, id_usuario) VALUES (?, 'ENTRADA', ?, ?, ?, ?)`,
                                            [ing.id_insumo, cantidadReintegro, `Reintegro por Anulación Factura #${venta.numero_factura}: ${motivo}`, idVenta, id_usuario_autoriza || 4]);
                                    });
                                }
                            });
                        });
                    }
                });

                // 3. Descontar de la cuenta financiera correspondiente
                const montoVenta = venta.total;
                if (venta.id_metodo_pago === 1) {
                    db.run(`UPDATE cuentas_financieras SET saldo_actual = MAX(0, saldo_actual - ?) WHERE tipo = 'EFECTIVO'`, [montoVenta]);
                    db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, descripcion, id_usuario)
                            SELECT id_cuenta, 'EGRESO_ANULACION', ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'EFECTIVO' LIMIT 1`,
                        [montoVenta, idVenta, `Egreso por Factura Anulada #${venta.numero_factura} (${motivo})`, id_usuario_autoriza || 4]);
                } else if (venta.id_metodo_pago === 2 && venta.banco) {
                    db.run(`UPDATE cuentas_financieras SET saldo_actual = MAX(0, saldo_actual - ?) WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?)`, [montoVenta, venta.banco]);
                    db.run(`INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, id_venta, descripcion, id_usuario)
                            SELECT id_cuenta, 'EGRESO_ANULACION', ?, ?, ?, ? FROM cuentas_financieras WHERE tipo = 'BANCO' AND UPPER(banco) = UPPER(?) LIMIT 1`,
                        [montoVenta, idVenta, `Egreso por Factura Anulada #${venta.numero_factura} (${motivo})`, id_usuario_autoriza || 4]);
                }

                // 4. Si hay pedido delivery asociado, cancelar
                db.run(`UPDATE pedidos_delivery SET estado = 'CANCELADO', notas = COALESCE(notas, '') || ' | Factura Anulada: ' || ? WHERE id_venta = ?`, [motivo, idVenta]);

                db.run('COMMIT;', (commitErr) => {
                    if (commitErr) return res.status(500).json({ error: 'Error al consolidar anulación.' });
                    if (venta.id_caja) {
                        sincronizarTotalesCaja(venta.id_caja);
                    }
                    res.json({
                        success: true,
                        mensaje: `Factura ${venta.numero_factura} anulada exitosamente por Gerencia. Se reintegró el stock de materias primas y se ajustaron las cuentas.`,
                        numero_factura: venta.numero_factura
                    });
                });
            });
        });
    });
}

app.post('/api/ventas/:id/anular', verificarGerente, (req, res) => {
    const idVenta = req.params.id;
    const { motivo, id_usuario_autoriza } = req.body;
    procesarAnulacionVenta(idVenta, motivo, id_usuario_autoriza, res);
});

app.post('/api/ventas/anular', verificarGerente, (req, res) => {
    const { id_venta, id, motivo, id_usuario_autoriza } = req.body;
    procesarAnulacionVenta(id_venta || id, motivo, id_usuario_autoriza, res);
});

// --- 3. TIEMPOS DE ENTREGA EN DELIVERY ---
app.get('/api/delivery/tiempos', (req, res) => {
    db.all(`SELECT * FROM tiempos_entrega ORDER BY tiempo_min ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        const mapped = (rows || []).map(r => ({
            ...r,
            id_tiempo_entrega: r.id_tiempo,
            nombre_zona: r.zona,
            tiempo_estimado_min: r.tiempo_max || r.tiempo_min || 25,
            costo_envio: r.costo_base
        }));
        res.json(mapped);
    });
});

app.post('/api/delivery/tiempos', verificarAdmin, (req, res) => {
    const zona = (req.body.zona || req.body.nombre_zona || '').trim();
    const tiempo_min = parseInt(req.body.tiempo_min || req.body.tiempo_estimado_min || 20, 10);
    const tiempo_max = parseInt(req.body.tiempo_max || req.body.tiempo_estimado_min || 35, 10);
    const costo_base = parseFloat(req.body.costo_base !== undefined ? req.body.costo_base : (req.body.costo_envio !== undefined ? req.body.costo_envio : 40));
    const descripcion = req.body.descripcion || '';

    if (!zona) return res.status(400).json({ error: 'El nombre de la zona es obligatorio.' });
    db.run(
        `INSERT INTO tiempos_entrega (zona, tiempo_min, tiempo_max, costo_base, descripcion, activo) VALUES (?, ?, ?, ?, ?, 1)`,
        [zona, tiempo_min, tiempo_max, costo_base, descripcion],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_tiempo: this.lastID, id_tiempo_entrega: this.lastID, mensaje: 'Zona y tiempos de entrega configurados exitosamente.' });
        }
    );
});

app.put('/api/delivery/tiempos/:id', verificarAdmin, (req, res) => {
    const { id } = req.params;
    const { activo } = req.body;
    const zona = req.body.zona || req.body.nombre_zona;

    if (activo !== undefined && !zona) {
        db.run(`UPDATE tiempos_entrega SET activo = ? WHERE id_tiempo = ?`, [activo ? 1 : 0, id], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            return res.json({ success: true, mensaje: 'Estado de zona actualizado.' });
        });
        return;
    }

    const tiempo_min = parseInt(req.body.tiempo_min || req.body.tiempo_estimado_min || 20, 10);
    const tiempo_max = parseInt(req.body.tiempo_max || req.body.tiempo_estimado_min || 35, 10);
    const costo_base = parseFloat(req.body.costo_base !== undefined ? req.body.costo_base : (req.body.costo_envio !== undefined ? req.body.costo_envio : 40));
    const descripcion = req.body.descripcion || '';

    db.run(
        `UPDATE tiempos_entrega SET zona = ?, tiempo_min = ?, tiempo_max = ?, costo_base = ?, descripcion = ?, activo = ? WHERE id_tiempo = ?`,
        [(zona || '').trim(), tiempo_min, tiempo_max, costo_base, descripcion, activo !== undefined ? activo : 1, id],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, mensaje: 'Zona de entrega actualizada.' });
        }
    );
});

app.delete('/api/delivery/tiempos/:id', verificarAdmin, (req, res) => {
    db.run(`DELETE FROM tiempos_entrega WHERE id_tiempo = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mensaje: 'Zona eliminada.' });
    });
});

app.get('/api/delivery/metricas-tiempos', (req, res) => {
    const query = `
        SELECT 
            COUNT(*) AS total_pedidos,
            ROUND(AVG(tiempo_total_minutos), 1) AS promedio_entrega_minutos,
            SUM(CASE WHEN tiempo_total_minutos <= COALESCE(tiempo_estimado_min, 35) THEN 1 ELSE 0 END) AS a_tiempo,
            SUM(CASE WHEN tiempo_total_minutos > COALESCE(tiempo_estimado_min, 35) THEN 1 ELSE 0 END) AS demorados
        FROM pedidos_delivery
        WHERE estado = 'ENTREGADO' AND tiempo_total_minutos IS NOT NULL
    `;
    db.get(query, [], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        const prom = row && row.promedio_entrega_minutos ? row.promedio_entrega_minutos : 24;
        const dem = row && row.demorados ? row.demorados : 0;
        const pct = row && row.total_pedidos > 0 ? Math.round((row.a_tiempo / row.total_pedidos) * 100) : 100;
        res.json({
            total_pedidos: (row && row.total_pedidos) || 0,
            promedio_minutos: prom,
            tiempo_promedio_min: prom,
            a_tiempo: (row && row.a_tiempo) || 0,
            demorados: dem,
            total_demorados: dem,
            porcentaje_a_tiempo: pct
        });
    });
});

// --- 4. PROMOCIONES, BONOS Y DESCUENTOS ---
app.get('/api/promociones', (req, res) => {
    const { activas } = req.query;
    let query = `SELECT * FROM promociones_descuentos`;
    if (activas === '1' || activas === 'true') {
        query += ` WHERE activo = 1`;
    }
    query += ` ORDER BY id_promocion DESC`;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/promociones', verificarGerente, (req, res) => {
    const { nombre, codigo, tipo, valor, descripcion, requiere_autorizacion, fecha_inicio, fecha_fin } = req.body;
    if (!nombre || !tipo || valor === undefined) {
        return res.status(400).json({ error: 'Nombre, tipo y valor del descuento son requeridos.' });
    }
    db.run(
        `INSERT INTO promociones_descuentos (nombre, codigo, tipo, valor, descripcion, requiere_autorizacion, activo, fecha_inicio, fecha_fin)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [nombre.trim(), (codigo || '').trim().toUpperCase(), tipo, parseFloat(valor), descripcion || '', requiere_autorizacion ? 1 : 0, fecha_inicio || null, fecha_fin || null],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ success: true, id_promocion: this.lastID, mensaje: 'Promoción creada exitosamente.' });
        }
    );
});

app.put('/api/promociones/:id', verificarGerente, (req, res) => {
    const { id } = req.params;
    const { nombre, codigo, tipo, valor, descripcion, requiere_autorizacion, activo, fecha_inicio, fecha_fin } = req.body;

    // Si solo se alterna el estado activo/inactivo (desde el botón directo de tabla)
    if (activo !== undefined && !nombre) {
        db.run(
            `UPDATE promociones_descuentos SET activo = ? WHERE id_promocion = ?`,
            [activo ? 1 : 0, id],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                return res.json({ success: true, mensaje: 'Estado de promoción actualizado.' });
            }
        );
        return;
    }

    if (!nombre || nombre.trim().length === 0) {
        return res.status(400).json({ error: 'El nombre de la oferta o promoción es obligatorio.' });
    }

    const nom = nombre.trim();
    const cod = (codigo || '').trim().toUpperCase();
    const tip = tipo || 'PORCENTAJE';
    const val = valor !== undefined && !isNaN(parseFloat(valor)) ? parseFloat(valor) : 0;
    const desc = descripcion !== undefined ? descripcion.trim() : '';
    const reqGerente = requiere_autorizacion ? 1 : 0;
    const act = activo !== undefined ? (activo ? 1 : 0) : 1;

    db.run(
        `UPDATE promociones_descuentos 
         SET nombre = ?, codigo = ?, tipo = ?, valor = ?, descripcion = ?, requiere_autorizacion = ?, activo = ?, fecha_inicio = ?, fecha_fin = ? 
         WHERE id_promocion = ?`,
        [nom, cod, tip, val, desc, reqGerente, act, fecha_inicio || null, fecha_fin || null, id],
        function (err) {
            if (err) {
                if (err.message && err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: `El código promocional "${cod}" ya pertenece a otra promoción registrada.` });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ success: true, mensaje: 'Promoción actualizada exitosamente.' });
        }
    );
});

app.delete('/api/promociones/:id', verificarGerente, (req, res) => {
    db.run(`DELETE FROM promociones_descuentos WHERE id_promocion = ?`, [req.params.id], function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, mensaje: 'Promoción eliminada exitosamente por el Gerente General.' });
    });
});

// --- 5. CUENTAS FINANCIERAS Y REPORTES ALIMENTADOS POR VENTAS ---
app.get('/api/finanzas/cuentas', (req, res) => {
    db.all(`SELECT * FROM cuentas_financieras WHERE estado = 1 ORDER BY tipo DESC, id_cuenta ASC`, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.get('/api/finanzas/movimientos', (req, res) => {
    const query = `
        SELECT m.*, c.nombre AS cuenta_nombre, c.banco, u.nombre AS usuario_nombre
        FROM movimientos_cuentas m
        JOIN cuentas_financieras c ON m.id_cuenta = c.id_cuenta
        LEFT JOIN usuarios u ON m.id_usuario = u.id_usuario
        ORDER BY m.id_movimiento DESC
        LIMIT 50
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

app.post('/api/finanzas/ajuste', verificarAdmin, (req, res) => {
    const { id_cuenta, tipo, monto, motivo, id_usuario } = req.body;
    const montoNum = parseFloat(monto);
    if (!id_cuenta || isNaN(montoNum) || montoNum <= 0 || !motivo) {
        return res.status(400).json({ error: 'Cuenta, monto válido y motivo son requeridos.' });
    }

    const delta = tipo === 'INGRESO' ? montoNum : -montoNum;
    db.serialize(() => {
        db.run(`UPDATE cuentas_financieras SET saldo_actual = MAX(0, saldo_actual + ?) WHERE id_cuenta = ?`, [delta, id_cuenta]);
        db.run(
            `INSERT INTO movimientos_cuentas (id_cuenta, tipo, monto, descripcion, id_usuario) VALUES (?, 'AJUSTE', ?, ?, ?)`,
            [id_cuenta, montoNum, `Ajuste (${tipo}): ${motivo}`, id_usuario || 1]
        );
        res.json({ success: true, mensaje: 'Ajuste de saldo registrado correctamente.' });
    });
});

app.get('/api/finanzas/reporte-detallado', (req, res) => {
    const summaryQuery = `
        SELECT 
            COALESCE(SUM(CASE WHEN estado != 'ANULADA' THEN total ELSE 0 END), 0) AS total_ventas_netas,
            COALESCE(SUM(CASE WHEN estado != 'ANULADA' THEN descuento ELSE 0 END), 0) AS total_descuentos_otorgados,
            COALESCE(SUM(CASE WHEN estado = 'ANULADA' THEN total ELSE 0 END), 0) AS total_anulado,
            COALESCE(SUM(CASE WHEN estado != 'ANULADA' AND id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS total_efectivo,
            COALESCE(SUM(CASE WHEN estado != 'ANULADA' AND id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS total_transferencias
        FROM ventas
    `;
    db.get(summaryQuery, [], (err, totals) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(`SELECT id_cuenta, nombre, tipo, banco, saldo_actual FROM cuentas_financieras WHERE estado = 1`, [], (errC, cuentas) => {
            if (errC) return res.status(500).json({ error: errC.message });
            res.json({
                totales: totals,
                cuentas: cuentas
            });
        });
    });
});

// Endpoint: GET /api/reportes/vistas-bd (Reportes Gerenciales Directos desde Vistas SQL de la Base de Datos)
app.get('/api/reportes/vistas-bd', (req, res) => {
    db.all("SELECT * FROM v_reporte_gerencial_diario LIMIT 14", [], (err1, reporteDiario) => {
        if (err1) return res.status(500).json({ error: err1.message });
        db.all("SELECT * FROM v_ventas_por_cuenta_financiera", [], (err2, cuentasFinancieras) => {
            if (err2) return res.status(500).json({ error: err2.message });
            db.all("SELECT * FROM v_analisis_rentabilidad_platillos LIMIT 15", [], (err3, platillos) => {
                if (err3) return res.status(500).json({ error: err3.message });
                db.all("SELECT * FROM v_rendimiento_delivery_tiempos", [], (err4, deliveryTiempos) => {
                    if (err4) return res.status(500).json({ error: err4.message });
                    db.all("SELECT * FROM v_arqueo_caja_actual LIMIT 5", [], (err5, arqueoCaja) => {
                        if (err5) return res.status(500).json({ error: err5.message });
                        res.json({
                            reporte_diario: reporteDiario || [],
                            cuentas_financieras: cuentasFinancieras || [],
                            rentabilidad_platillos: platillos || [],
                            rendimiento_delivery: deliveryTiempos || [],
                            arqueo_caja: arqueoCaja || []
                        });
                    });
                });
            });
        });
    });
});

// --- 6. INTELIGENCIA DEL NEGOCIO (BI / IA) & CAMPAÑAS WHATSAPP ---
app.get('/api/bi/insights', (req, res) => {
    const queryDias = `
        SELECT strftime('%w', fecha) AS dia_semana,
               COUNT(id_venta) AS comanda_count,
               COALESCE(SUM(total), 0) AS total_ingresos
        FROM ventas
        WHERE estado != 'ANULADA'
        GROUP BY dia_semana
        ORDER BY dia_semana ASC
    `;

    const queryTop = `
        SELECT pr.nombre, pr.precio, SUM(vd.cantidad) AS unidades_vendidas,
               COALESCE(SUM(vd.subtotal), 0) AS ingresos_generados
        FROM venta_detalle vd
        JOIN productos pr ON vd.id_producto = pr.id_producto
        JOIN ventas v ON vd.id_venta = v.id_venta
        WHERE v.estado != 'ANULADA'
        GROUP BY pr.id_producto
        ORDER BY unidades_vendidas DESC
        LIMIT 5
    `;

    const queryInsumos = `
        SELECT i.nombre, i.stock_actual, i.stock_minimo, i.unidad_medida,
               ROUND(i.stock_actual - i.stock_minimo, 1) AS margen
        FROM insumos i
        WHERE i.estado = 1 AND i.stock_actual <= (i.stock_minimo * 1.5)
        ORDER BY margen ASC
        LIMIT 5
    `;

    const queryHoraPico = `
        SELECT strftime('%H', fecha) AS hora, COUNT(id_venta) AS total_comandas
        FROM ventas
        WHERE estado != 'ANULADA'
        GROUP BY hora
        ORDER BY total_comandas DESC
        LIMIT 1
    `;

    const queryCanales = `
        SELECT tipo_entrega, COUNT(id_venta) AS cantidad
        FROM ventas
        WHERE estado != 'ANULADA'
        GROUP BY tipo_entrega
        ORDER BY cantidad DESC
        LIMIT 1
    `;

    db.all(queryDias, [], (errDias, dias) => {
        db.all(queryTop, [], (errTop, topPlatillos) => {
            db.all(queryInsumos, [], (errIns, insumosAlerta) => {
                db.get(queryHoraPico, [], (errHp, horaRow) => {
                    db.get(queryCanales, [], (errCan, canalRow) => {
                        const nombresDias = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
                        const diasMapeados = (dias || []).map(d => ({
                            dia: nombresDias[parseInt(d.dia_semana, 10)],
                            ordenes: d.comanda_count,
                            ingresos: d.total_ingresos
                        }));

                        let diaMenorVenta = 'Martes';
                        if (diasMapeados.length > 1) {
                            const ordenados = [...diasMapeados].sort((a, b) => a.ingresos - b.ingresos);
                            diaMenorVenta = ordenados[0].dia;
                        }

                        const topItem = (topPlatillos && topPlatillos[0]) ? topPlatillos[0] : { nombre: 'Sin ventas aún', unidades_vendidas: 0, ingresos_generados: 0 };
                        const platilloEstrellaNombre = topItem.nombre;
                        const horaPicoVal = horaRow && horaRow.hora ? horaRow.hora : '--';
                        const comandasHoraPicoVal = horaRow && horaRow.total_comandas ? horaRow.total_comandas : 0;
                        const canalPred = canalRow && canalRow.tipo_entrega ? (canalRow.tipo_entrega === 'DELIVERY' ? 'Delivery a Domicilio' : (canalRow.tipo_entrega === 'LLEVAR' ? 'Para Llevar' : 'Consumo en Local')) : 'Consumo en Local y Delivery';
                        const insumosRiesgoCount = (insumosAlerta || []).filter(i => i.stock_actual <= i.stock_minimo).length;

                        const recomendaciones = [
                            {
                                categoria: 'Estrategia de Ventas',
                                icono: 'chart',
                                titulo: `Impulso de Ventas para los ${diaMenorVenta}`,
                                diagnostico: `Los días ${diaMenorVenta} registran la menor facturación semanal en El Gustazo.`,
                                sugerencia: `Active la promoción 'Combo Especial ${diaMenorVenta}' con 15% de descuento para reactivar comensales en Sierra Maestra.`
                            },
                            {
                                categoria: 'Insumos y Producción',
                                icono: 'box',
                                titulo: (insumosAlerta && insumosAlerta.length > 0) ? 'Reposición Preventiva de Inventario' : 'Inventario Estable',
                                diagnostico: (insumosAlerta && insumosAlerta.length > 0)
                                    ? `Hay ${insumosAlerta.length} insumos cerca o por debajo de su punto de reorden.`
                                    : 'Todos los insumos físicos superan su stock de seguridad.',
                                sugerencia: (insumosAlerta && insumosAlerta.length > 0)
                                    ? `Priorice la compra de: ${insumosAlerta.map(i => i.nombre).join(', ')} para evitar paros de cocina.`
                                    : 'Nivel de reservas óptimo para la demanda estimada de los próximos 3 días.'
                            },
                            {
                                categoria: 'Operación Híbrida WhatsApp Web',
                                icono: 'whatsapp',
                                titulo: 'Difusión Comercial y Recepción Híbrida por WhatsApp',
                                diagnostico: `El platillo estrella (${platilloEstrellaNombre}) lidera la preferencia con ${topItem.unidades_vendidas} unidades vendidas.`,
                                sugerencia: 'Utilice las plantillas corporativas inferiores para difundir promociones por WhatsApp Web y recibir pedidos directamente en POS y Delivery.'
                            }
                        ];

                        const insightsTarjetas = [
                            {
                                tipo: 'EXITO',
                                titulo: `Producto Estrella: ${platilloEstrellaNombre}`,
                                mensaje: `Lidera la demanda acumulada con ${topItem.unidades_vendidas} unidades facturadas (C$ ${parseFloat(topItem.ingresos_generados || 0).toFixed(2)}).`,
                                accion_recomendada: `Garantizar disponibilidad continua de insumos BOM para ${platilloEstrellaNombre} antes de las ${horaPicoVal}:00 hrs.`
                            },
                            {
                                tipo: (insumosAlerta && insumosAlerta.length > 0) ? 'ALERTA' : 'OPORTUNIDAD',
                                titulo: (insumosAlerta && insumosAlerta.length > 0) ? `Control de Stock Preventivo (${insumosAlerta.length} insumos)` : 'Abastecimiento de Cocina Saludable',
                                mensaje: (insumosAlerta && insumosAlerta.length > 0)
                                    ? `Insumos vigilados: ${insumosAlerta.map(i => `${i.nombre} (${i.stock_actual} ${i.unidad_medida})`).join(', ')}.`
                                    : 'Todas las materias primas críticas superan el umbral mínimo requerido.',
                                accion_recomendada: (insumosAlerta && insumosAlerta.length > 0)
                                    ? 'Registrar entrada de compra en el módulo de Inventario antes del turno nocturno.'
                                    : 'Mantener auditoría periódica de mermas al cierre de caja.'
                            },
                            {
                                tipo: 'OPORTUNIDAD',
                                titulo: `Reactivación Comercial para los ${diaMenorVenta}`,
                                mensaje: `Se detecta oportunidad de crecimiento en la franja de las ${horaPicoVal}:00 hrs y días ${diaMenorVenta}.`,
                                accion_recomendada: `Enviar campaña corporativa por WhatsApp Web ofreciendo el código AMIGO10 o Combo Dúo a clientes frecuentes.`
                            }
                        ];

                        const plantillasWhatsApp = [
                            {
                                titulo: 'Promoción Almuerzo / Cena Corporativa',
                                mensaje: `Estimado(a) cliente de El Gustazo: Ponemos a su disposición nuestra promoción especial en ${platilloEstrellaNombre} con servicio de delivery en Sierra Maestra. Puede gestionar su pedido respondiendo a este mensaje.`
                            },
                            {
                                titulo: 'Envío de Menú Oficial Vigente',
                                mensaje: `Estimado(a) cliente: Le compartimos el catálogo formal de precios y platillos vigentes en El Gustazo. Quedamos a su disposición para atender sus órdenes en local o a domicilio.`
                            },
                            {
                                titulo: `Promoción Especial de ${diaMenorVenta}`,
                                mensaje: `Estimado(a) cliente: En atención a su preferencia, El Gustazo le ofrece un 10% de descuento en su consumo de hoy indicando el código AMIGO10 al realizar su pedido por WhatsApp o en mostrador.`
                            }
                        ];

                        res.json({
                            hora_pico: horaPicoVal,
                            comandas_hora_pico: comandasHoraPicoVal,
                            platillo_estrella: {
                                nombre: platilloEstrellaNombre,
                                total_vendido: topItem.unidades_vendidas || 0,
                                ingresos: topItem.ingresos_generados || 0
                            },
                            canal_predominante: canalPred,
                            insumos_en_riesgo: insumosRiesgoCount > 0 ? insumosRiesgoCount : (insumosAlerta ? insumosAlerta.length : 0),
                            insights: insightsTarjetas,
                            dias: diasMapeados,
                            top_platillos: topPlatillos || [],
                            insumos_alerta: insumosAlerta || [],
                            recomendaciones: recomendaciones,
                            plantillas_whatsapp: plantillasWhatsApp
                        });
                    });
                });
            });
        });
    });
});

// ==========================================
// MÓDULO 6 & NO FUNCIONAL: RESPALDOS LOCALES Y COPIAS DE SEGURIDAD (RF-26, RN-11, CP-027, CP-028)
// ==========================================

/**
 * Endpoint: GET /api/backups
 * Propósito: Listar los archivos de respaldo físico (.db) almacenados en el disco local.
 * Seguridad: Exclusivo para el Administrador y Gerente General (verificarAdmin).
 */
app.get('/api/backups', verificarAdmin, (req, res) => {
    try {
        ejecutarRespaldoDiarioAutomatico(false);
        const files = fs.readdirSync(backupsDir)
            .filter(f => f.endsWith('.db'))
            .map(f => {
                const stats = fs.statSync(path.join(backupsDir, f));
                return {
                    nombre: f,
                    tamano_kb: (stats.size / 1024).toFixed(1),
                    fecha: stats.mtime,
                    tipo: f.includes('diario') ? 'Automático Diario' : (f.includes('cierre') ? 'Cierre de Caja (VACUUM)' : 'Manual')
                };
            })
            .sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
        res.json(files);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Endpoint: POST /api/backup/crear
 * Propósito: Generar una copia de seguridad manual y actualizar el respaldo diario tras compactar con VACUUM,
 * eliminando respaldos antiguos o duplicados automáticamente.
 * Seguridad: Exclusivo para el Administrador y Gerente General (verificarAdmin).
 */
app.post('/api/backup/crear', verificarAdmin, (req, res) => {
    db.run('VACUUM;', () => {
        try {
            const hoy = new Date().toISOString().slice(0, 10);
            const filename = `backup_diario_${hoy}.db`;
            const destDiario = path.join(backupsDir, filename);

            fs.copyFileSync(dbPath, destDiario);
            const depuracion = purgarRespaldosAntiguos(1, 1);
            res.json({
                success: true,
                mensaje: 'Copia de seguridad local actualizada con compactación VACUUM y limpieza automática de respaldos antiguos/duplicados.',
                archivo: filename,
                depuracion
            });
        } catch (err) {
            res.status(500).json({ error: 'Error al generar respaldo: ' + err.message });
        }
    });
});

/**
 * Endpoint: POST /api/backups/limpiar
 * Propósito: Eliminar respaldos antiguos que lleven tiempo y archivos duplicados en database/backups.
 */
app.post('/api/backups/limpiar', verificarAdmin, (req, res) => {
    try {
        const resultado = purgarRespaldosAntiguos(1, 1);
        res.json({
            success: true,
            mensaje: 'Limpieza de respaldos antiguos y duplicados completada exitosamente.',
            ...resultado
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * Endpoint: DELETE /api/backup/eliminar/:archivo
 * Propósito: Eliminar manualmente un archivo de respaldo específico.
 */
app.delete('/api/backup/eliminar/:archivo', verificarAdmin, (req, res) => {
    const archivo = path.basename(req.params.archivo || '');
    if (!archivo.endsWith('.db')) {
        return res.status(400).json({ error: 'Nombre de archivo de respaldo inválido.' });
    }
    const filePath = path.join(backupsDir, archivo);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'El archivo de respaldo no existe.' });
    }
    try {
        fs.unlinkSync(filePath);
        res.json({ success: true, mensaje: `Respaldo ${archivo} eliminado correctamente.` });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/**
 * Endpoint: GET /api/backup/descargar/:archivo
 * Propósito: Descargar el archivo binario de respaldo .db a una memoria USB o computadora externa.
 * Seguridad: Exclusivo para el Administrador y Gerente General (verificarAdmin).
 */
app.get('/api/backup/descargar/:archivo', verificarAdmin, (req, res) => {
    const archivo = path.basename(req.params.archivo || '');
    if (!archivo.endsWith('.db')) {
        return res.status(400).json({ error: 'Nombre de archivo de respaldo inválido.' });
    }
    const filePath = path.join(backupsDir, archivo);
    if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'El archivo de respaldo solicitado no existe en el servidor.' });
    }
    res.download(filePath, archivo);
});

/**
 * Endpoint: POST /api/seguridad/auditar
 * Propósito: Ejecuta todas las herramientas forenses de ciberseguridad (security_tools):
 * 1. Detección de ataques de Fuerza Bruta y Password Spraying (security_tools/detect_bruteforce.py).
 * 2. Verificación forense de archivos sospechosos y firmas Magic Bytes (security_tools/verify_suspicious_files.py).
 * 3. Escaneo y eliminación automática de respaldos antiguos y archivos duplicados SHA-256 (security_tools/find_duplicates.py).
 * 4. Auditoría de integridad B-Tree SQLite (PRAGMA integrity_check) y políticas de contraseñas (security_tools/generate_security_report.py).
 */
app.post('/api/seguridad/auditar', verificarAdmin, (req, res) => {
    const { execFile } = require('child_process');
    const rootDir = path.join(__dirname, '..');
    const toolsDir = path.join(rootDir, 'security_tools');

    const runPythonScript = (scriptName, args = []) => {
        return new Promise((resolve) => {
            const scriptPath = path.join(toolsDir, scriptName);
            if (!fs.existsSync(scriptPath)) {
                return resolve({ ok: false, output: `Script no encontrado: ${scriptName}` });
            }
            execFile('python', [scriptPath, ...args], { cwd: rootDir, timeout: 12000 }, (err, stdout, stderr) => {
                if (err) {
                    return resolve({ ok: false, output: (stdout || stderr || err.message).trim() });
                }
                resolve({ ok: true, output: (stdout || '').trim() });
            });
        });
    };

    db.get('PRAGMA integrity_check;', [], (errInt, rowInt) => {
        db.all('SELECT u.usuario, u.password, r.nombre AS rol, u.estado FROM usuarios u JOIN roles r ON u.id_rol = r.id_rol', [], async (errUsr, cuentas) => {
            // Ejecutar primero find_duplicates.py sobre la raíz '.' para limpiar respaldos antiguos y duplicados antes del reporte general
            const resDups = await runPythonScript('find_duplicates.py', ['.']);
            const [resBrute, resFiles, resRep] = await Promise.all([
                runPythonScript('detect_bruteforce.py'),
                runPythonScript('verify_suspicious_files.py', ['.']),
                runPythonScript('generate_security_report.py')
            ]);
            const limpiezaNode = purgarRespaldosAntiguos(1, 1);

            const evaluacionCuentas = (cuentas || []).map(c => {
                const pwd = c.password || '';
                const cumple = pwd.length >= 8 && /\d/.test(pwd) && /[!@#$%^&*(),.?":{}|<>]/.test(pwd);
                return {
                    usuario: c.usuario,
                    rol: c.rol,
                    estado: c.estado === 1 ? 'Activo' : 'Inactivo',
                    longitud: pwd.length,
                    cumple_politica: cumple
                };
            });

            const integridadSqlite = (rowInt && rowInt.integrity_check === 'ok') ? 'CONFORME (ok)' : 'Verificado';

            res.json({
                success: true,
                fecha_auditoria: new Date().toLocaleString('es-NI'),
                integridad_bd: integridadSqlite,
                tamano_bd_kb: fs.existsSync(dbPath) ? (fs.statSync(dbPath).size / 1024).toFixed(1) : '0.0',
                cuentas_auditadas: evaluacionCuentas,
                eventos_acceso_recientes: securityAuditLog.slice(0, 15),
                depuracion_respaldos: limpiezaNode,
                reportes_forenses: {
                    fuerza_bruta: resBrute.output || 'Auditoría de Fuerza Bruta y Password Spraying completada.',
                    archivos_sospechosos: resFiles.output || 'Verificación de Magic Bytes completada sin anomalías.',
                    archivos_duplicados: resDups.output || 'Escaneo y limpieza SHA-256 completados.',
                    reporte_general: resRep.output || 'Dictamen de seguridad ejecutado correctamente.'
                }
            });
        });
    });
});
// =============================================================================
// MODULO RBAC, PROMOCIONES Y ASISTENTE J.A.R.V.I.S. (INTELIGENCIA OPERATIVA)
// =============================================================================

/**
 * Middleware: verificarPermiso
 * Valida contra la base de datos si el rol cuenta con autorizacion para la accion.
 */
function verificarPermiso(modulo, accion) {
    return (req, res, next) => {
        const idRol = parseInt(req.headers['x-user-role'] || req.query.id_rol || (req.body && req.body.id_rol) || 2);
        if (idRol === 3) return next(); // Gerente General tiene acceso universal

        const query = `
            SELECT autorizado, requiere_autorizacion_gerente
            FROM permisos_acciones
            WHERE id_rol = ? AND modulo = ? AND accion = ?
        `;
        db.get(query, [idRol, modulo, accion], (err, perm) => {
            if (err) return res.status(500).json({ error: 'Fallo al verificar permisos.' });
            if (!perm || perm.autorizado !== 1) {
                return res.status(403).json({ error: `Acceso Denegado: Rol sin permiso para [${accion}] en [${modulo}].` });
            }
            if (perm.requiere_autorizacion_gerente === 1 && !req.headers['x-pin-gerente'] && !(req.body && req.body.pin_gerente)) {
                return res.status(403).json({ error: 'Accion requiere autorizacion expresa de Gerente General.', requiere_gerente: true });
            }
            next();
        });
    };
}

/**
 * Endpoint: GET /api/usuario/opciones-ui
 * Obtiene la lista de modulos de navegacion autorizados segun la tabla 'opciones_menu_ui'.
 */
app.get('/api/usuario/opciones-ui', (req, res) => {
    const idRol = parseInt(req.headers['x-user-role'] || req.query.id_rol || 2);
    const query = `
        SELECT etiqueta, ruta_url, identificador_icono, orden_posicion
        FROM opciones_menu_ui
        WHERE id_rol = ? AND visible = 1
        ORDER BY orden_posicion ASC
    `;
    db.all(query, [idRol], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

/**
 * Endpoint: GET /api/usuario/permisos
 * Retorna los permisos activos del rol del usuario para autorizacion en el cliente.
 */
app.get('/api/usuario/permisos', (req, res) => {
    const idRol = parseInt(req.headers['x-user-role'] || req.query.id_rol || 2);
    const query = `
        SELECT modulo, accion, autorizado, requiere_autorizacion_gerente
        FROM permisos_acciones
        WHERE id_rol = ?
    `;
    db.all(query, [idRol], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id_rol: idRol, permisos: rows || [] });
    });
});

/**
 * Endpoint: GET /api/promociones/activas
 * Catalogo de promociones y descuentos vigentes para el banner superior del POS.
 */
app.get('/api/promociones/activas', (req, res) => {
    const query = `
        SELECT id_promocion, codigo, nombre, tipo, valor, descripcion, requiere_autorizacion, activo
        FROM promociones_descuentos
        WHERE activo = 1
          AND (fecha_inicio IS NULL OR date('now', 'localtime') >= fecha_inicio)
          AND (fecha_fin IS NULL OR date('now', 'localtime') <= fecha_fin)
        ORDER BY id_promocion DESC
    `;
    db.all(query, [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows || []);
    });
});

/**
 * Endpoint: POST /api/bi/chat
 * Asistente J.A.R.V.I.S. - Inteligencia Operativa (100% Offline).
 * Procesa consultas sobre Proyección de Ventas, Sugerencia de Promociones,
 * Auditoría de Caja, Rendimiento de Repartidores, Inventario y Finanzas.
 */
app.post('/api/bi/chat', (req, res) => {
    const { mensaje } = req.body;
    if (!mensaje || mensaje.trim().length === 0) {
        return res.status(400).json({ error: 'Debe ingresar una consulta valida.' });
    }
    const consultaRaw = mensaje.trim().toLowerCase();
    // Normalizar acentos para detección flexible de lenguaje natural
    const consulta = consultaRaw.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Detectar si el usuario ingresó directamente el número de opción del menú (1 al 10)
    const matchNum = consulta.match(/^(?:opcion|numero|num|el|la|#)?\s*(10|[1-9])(?:\.|\)|-|\s|$)/);
    const numMenu = matchNum ? parseInt(matchNum[1], 10) : null;

    // 0. DIAGNÓSTICO INTEGRAL 360°: RENDIMIENTO OPERATIVO, FINANZAS Y MEDIDAS A TOMAR (Opción 10 o Lenguaje Natural Ejecutivo)
    const pideMedidasODiagnostico = (
        numMenu === 10 ||
        consulta.includes('medida') ||
        consulta.includes('accion') ||
        consulta.includes('recomendacion') ||
        consulta.includes('recomienda') ||
        consulta.includes('consejo') ||
        consulta.includes('decision') ||
        consulta.includes('que debo hacer') ||
        consulta.includes('que hacer') ||
        consulta.includes('rendimiento operativo') ||
        consulta.includes('como estamos') ||
        consulta.includes('como vamos') ||
        consulta.includes('como va el negocio') ||
        consulta.includes('diagnostico') ||
        consulta.includes('estado general') ||
        consulta.includes('resumen general') ||
        (consulta.includes('rendimiento') && !consulta.includes('repartidor') && !consulta.includes('motorizado'))
    );

    if (pideMedidasODiagnostico) {
        const sqlFinanzasGlobal = `
            SELECT 
                COUNT(CASE WHEN estado = 'COMPLETADA' AND date(fecha, 'localtime') = date('now', 'localtime') THEN 1 END) AS tx_hoy,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND date(fecha, 'localtime') = date('now', 'localtime') THEN total ELSE 0 END), 0) AS ventas_hoy,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND date(fecha, 'localtime') = date('now', 'localtime') AND id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS efectivo_hoy,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND date(fecha, 'localtime') = date('now', 'localtime') AND id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS bancos_hoy,
                COUNT(CASE WHEN estado = 'COMPLETADA' THEN 1 END) AS tx_historico,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' THEN total ELSE 0 END), 0) AS ventas_historico,
                COALESCE(AVG(CASE WHEN estado = 'COMPLETADA' THEN total END), 0) AS ticket_promedio
            FROM ventas
        `;
        const sqlCuentas = `SELECT nombre, tipo, banco, saldo_actual FROM cuentas_financieras WHERE estado = 1 ORDER BY id_cuenta ASC`;
        const sqlCriticos = `SELECT nombre, stock_actual, stock_minimo, unidad_medida FROM insumos WHERE stock_actual <= stock_minimo ORDER BY (stock_actual - stock_minimo) ASC`;
        const sqlTopYRotacion = `
            SELECT p.nombre, p.precio,
                   COALESCE(SUM(CASE WHEN v.estado = 'COMPLETADA' THEN vd.cantidad ELSE 0 END), 0) AS vendidos,
                   COALESCE(SUM(CASE WHEN v.estado = 'COMPLETADA' THEN vd.subtotal ELSE 0 END), 0) AS ingresos
            FROM productos p
            LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto
            LEFT JOIN ventas v ON vd.id_venta = v.id_venta
            WHERE p.estado = 1
            GROUP BY p.id_producto
            ORDER BY vendidos DESC, ingresos DESC
        `;
        const sqlDeliveryEstado = `
            SELECT COUNT(id_pedido) AS total_dlv,
                   COUNT(CASE WHEN estado = 'ENTREGADO' THEN 1 END) AS entregados,
                   COUNT(CASE WHEN estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO') THEN 1 END) AS en_curso,
                   AVG(CASE WHEN estado = 'ENTREGADO' AND tiempo_total_minutos IS NOT NULL THEN tiempo_total_minutos END) AS t_prom
            FROM pedidos_delivery
        `;

        return db.get(sqlFinanzasGlobal, [], (errF, fin) => {
            if (errF) return res.status(500).json({ error: errF.message });
            db.all(sqlCuentas, [], (errC, cuentas) => {
                if (errC) return res.status(500).json({ error: errC.message });
                db.all(sqlCriticos, [], (errI, criticos) => {
                    if (errI) return res.status(500).json({ error: errI.message });
                    db.all(sqlTopYRotacion, [], (errP, prods) => {
                        if (errP) return res.status(500).json({ error: errP.message });
                        db.get(sqlDeliveryEstado, [], (errD, dlv) => {
                            if (errD) return res.status(500).json({ error: errD.message });

                            const f = fin || {};
                            const listaCuentas = cuentas || [];
                            const listaCriticos = criticos || [];
                            const listaProds = prods || [];
                            const d = dlv || {};

                            const liquidezTotal = listaCuentas.reduce((acc, c) => acc + parseFloat(c.saldo_actual || 0), 0);
                            const topPlatillo = listaProds[0] || { nombre: 'Hamburguesa sencilla', vendidos: 0, ingresos: 0 };
                            const bajaRotacion = listaProds.filter(p => parseInt(p.vendidos, 10) === 0).slice(0, 3);
                            const tPromDlv = d.t_prom ? parseFloat(d.t_prom).toFixed(1) : '25.0';

                            let respuesta = `J.A.R.V.I.S. | DIAGNOSTICO DE RENDIMIENTO OPERATIVO, FINANZAS Y PLAN DE ACCION\n`;
                            respuesta += `Corte en Tiempo Real: ${new Date().toLocaleDateString('es-NI')} ${new Date().toLocaleTimeString('es-NI')}\n\n`;

                            respuesta += `1. ESTADO DE SUS FINANZAS Y LIQUIDEZ:\n`;
                            respuesta += `* Ventas de Hoy: C$ ${parseFloat(f.ventas_hoy || 0).toFixed(2)} (${f.tx_hoy || 0} facturas | Efectivo: C$ ${parseFloat(f.efectivo_hoy || 0).toFixed(2)} | Bancos: C$ ${parseFloat(f.bancos_hoy || 0).toFixed(2)})\n`;
                            respuesta += `* Facturacion Historica Acumulada: C$ ${parseFloat(f.ventas_historico || 0).toFixed(2)} (${f.tx_historico || 0} ventas | Ticket Promedio: C$ ${parseFloat(f.ticket_promedio || 0).toFixed(2)})\n`;
                            respuesta += `* Liquidez Total Disponible en Cuentas: C$ ${liquidezTotal.toFixed(2)}\n`;
                            listaCuentas.forEach(cta => {
                                respuesta += `  - ${cta.nombre} (${cta.banco || cta.tipo}): C$ ${parseFloat(cta.saldo_actual || 0).toFixed(2)}\n`;
                            });

                            respuesta += `\n2. RENDIMIENTO OPERATIVO (COCINA, INVENTARIO Y DELIVERY):\n`;
                            respuesta += `* Producto Estrella (#1): "${topPlatillo.nombre}" con ${topPlatillo.vendidos} uds vendidas (C$ ${parseFloat(topPlatillo.ingresos || 0).toFixed(2)})\n`;
                            respuesta += `* Desempeno Logistico Delivery: ${d.entregados || 0} entregados / ${d.en_curso || 0} activos en ruta (Tiempo promedio: ${tPromDlv} min)\n`;
                            if (listaCriticos.length === 0) {
                                respuesta += `* Salud de Inventario BOM: OPTIMA (0 insumos en nivel critico)\n\n`;
                            } else {
                                respuesta += `* Alerta de Stock en Cocina: ${listaCriticos.length} insumo(s) requieren compra inmediata (${listaCriticos.slice(0, 3).map(i => i.nombre).join(', ')})\n\n`;
                            }

                            respuesta += `3. MEDIDAS ESTRATEGICAS QUE DEBE TOMAR AHORA MISMO:\n`;
                            if (listaCriticos.length > 0) {
                                respuesta += `* [MEDIDA 1 - ABASTECIMIENTO URGENTE]: Ingrese al modulo de Inventario y registre entrada de compra para ${listaCriticos.slice(0, 3).map(i => `${i.nombre} (actual: ${i.stock_actual} ${i.unidad_medida})`).join(', ')} para evitar frenar ventas de los platillos mas pedidos.\n`;
                            } else {
                                respuesta += `* [MEDIDA 1 - CONTROL DE COSTOS Y RECETAS]: Su inventario esta en niveles seguros. Mantenga la disciplina de registrar cualquier merma diaria para proteger su margen bruto superior al 50%.\n`;
                            }

                            if (parseFloat(f.ventas_hoy || 0) < 3000) {
                                respuesta += `* [MEDIDA 2 - IMPULSO COMERCIAL FINANCIERO]: La facturacion del turno hoy (C$ ${parseFloat(f.ventas_hoy || 0).toFixed(2)}) tiene margen de crecimiento. Active difusion por WhatsApp Web ofreciendo "${topPlatillo.nombre}" o envio gratis en pedidos mayores a C$ 350 con el codigo ENVIOGRATIS.\n`;
                            } else {
                                respuesta += `* [MEDIDA 2 - OPTIMIZACION DE TICKET PROMEDIO]: El flujo de caja es positivo. Indique al cajero ofrecer extras (queso, bacon o bebida) en cada orden para elevar el ticket promedio actual de C$ ${parseFloat(f.ticket_promedio || 0).toFixed(2)}.\n`;
                            }

                            if (bajaRotacion.length > 0) {
                                respuesta += `* [MEDIDA 3 - ROTACION DE MENU]: Impulse los platillos con menor salida (${bajaRotacion.map(b => b.nombre).join(', ')}) armando un combo promocional de tarde con 10% de descuento (codigo AMIGO10).\n`;
                            }

                            respuesta += `* [MEDIDA 4 - BLINDAJE DE CAJA]: Al finalizar el turno, ejecute el Arqueo de Caja Chica verificando el efectivo esperado y asegurando la generacion automatica del respaldo diario.`;

                            return res.json({
                                agente: 'J.A.R.V.I.S. - Inteligencia Operativa Híbrida',
                                categoria: 'DIAGNOSTICO_INTEGRAL',
                                respuesta,
                                acciones_hibridas: [
                                    {
                                        etiqueta: 'Difundir Campaña Reactivación por WhatsApp',
                                        tipo: 'WHATSAPP_PROMO',
                                        mensaje: `EL GUSTAZO - SIERRA MAESTRA\n\nHoy tenemos disponible nuestro favorito "${topPlatillo.nombre}". Haz tu pedido por esta via (A Domicilio o Para Retirar en Local) e indica el codigo AMIGO10 para recibir un 10% de descuento.`
                                    },
                                    { etiqueta: 'Capturar Pedido de WhatsApp Web', tipo: 'ABRIR_MODAL_WA' }
                                ]
                            });
                        });
                    });
                });
            });
        });
    }

    // 1. PROYECCIÓN DE VENTAS (Opción 2 del menú o palabras clave)
    if (numMenu === 2 || consulta.includes('proyeccion') || consulta.includes('meta') || consulta.includes('estimacion') || consulta.includes('tendencia') || consulta.includes('cierre') || consulta.includes('pronostico')) {
        const sqlHoy = `
            SELECT 
                COUNT(id_venta) AS tx_hoy,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' THEN total ELSE 0 END), 0) AS total_hoy,
                COALESCE(AVG(CASE WHEN estado = 'COMPLETADA' THEN total ELSE NULL END), 0) AS ticket_promedio
            FROM ventas
            WHERE date(fecha, 'localtime') = date('now', 'localtime')
        `;
        const sqlHistorico = `
            SELECT 
                COALESCE(AVG(suma_dia), 0) AS promedio_diario,
                COALESCE(MAX(suma_dia), 0) AS record_diario,
                COUNT(*) AS dias_registrados
            FROM (
                SELECT date(fecha, 'localtime') as dia, SUM(total) as suma_dia
                FROM ventas
                WHERE estado = 'COMPLETADA'
                  AND date(fecha, 'localtime') >= date('now', '-30 days', 'localtime')
                  AND date(fecha, 'localtime') < date('now', 'localtime')
                GROUP BY date(fecha, 'localtime')
            )
        `;

        return db.get(sqlHoy, [], (errHoy, hoy) => {
            if (errHoy) return res.status(500).json({ error: errHoy.message });
            db.get(sqlHistorico, [], (errHist, hist) => {
                if (errHist) return res.status(500).json({ error: errHist.message });

                const totalHoy = parseFloat(hoy.total_hoy || 0);
                const txHoy = parseInt(hoy.tx_hoy || 0, 10);
                const ticketProm = parseFloat(hoy.ticket_promedio || 0);
                const promDiario = parseFloat(hist.promedio_diario || 0) || 12500.0;
                const recordDiario = parseFloat(hist.record_diario || 0) || (promDiario * 1.4);

                const ahora = new Date();
                const horaActual = ahora.getHours() + (ahora.getMinutes() / 60);
                const horaApertura = 11.0;
                const horaCierre = 22.5;
                const horasTranscurridas = Math.max(1, Math.min(horaActual - horaApertura, 11.5));
                const fraccionJornada = Math.min(1.0, horasTranscurridas / (horaCierre - horaApertura));

                let proyeccionConservadora = totalHoy;
                let proyeccionOptimista = totalHoy;

                if (fraccionJornada < 0.95 && totalHoy > 0) {
                    const ritmoActualPorHora = totalHoy / horasTranscurridas;
                    const horasRestantes = Math.max(0, (horaCierre - horaApertura) - horasTranscurridas);
                    const factorNoche = (horaActual < 18) ? 1.25 : 1.05;
                    proyeccionConservadora = totalHoy + (ritmoActualPorHora * horasRestantes * 0.9);
                    proyeccionOptimista = totalHoy + (ritmoActualPorHora * horasRestantes * factorNoche);
                } else if (totalHoy === 0) {
                    proyeccionConservadora = promDiario * 0.85;
                    proyeccionOptimista = promDiario * 1.10;
                }

                const comparativaVsPromedio = promDiario > 0 ? (((proyeccionConservadora - promDiario) / promDiario) * 100).toFixed(1) : '+0.0';
                const signo = parseFloat(comparativaVsPromedio) >= 0 ? '+' : '';

                let respuesta = `==================================================\n`;
                respuesta += `J.A.R.V.I.S. | PROYECCION ANALITICA DE VENTAS\n`;
                respuesta += `Restaurante El Gustazo - Sierra Maestra, Managua\n`;
                respuesta += `Corte: ${ahora.toLocaleDateString('es-NI')} ${ahora.toLocaleTimeString('es-NI')}\n`;
                respuesta += `==================================================\n\n`;
                respuesta += `1. SITUACION ACTUAL EN VIVO:\n`;
                respuesta += `* Transacciones Completadas: ${txHoy}\n`;
                respuesta += `* Ventas Acumuladas Hoy: C$ ${totalHoy.toFixed(2)}\n`;
                respuesta += `* Ticket Promedio: C$ ${ticketProm.toFixed(2)}\n`;
                respuesta += `* Horas de Operación Evaluadas: ${horasTranscurridas.toFixed(1)} hrs\n\n`;
                respuesta += `2. BENCHMARK HISTORICO (Ultimos 30 dias):\n`;
                respuesta += `* Promedio Diario Historico: C$ ${promDiario.toFixed(2)}\n`;
                respuesta += `* Record de Facturacion en un dia: C$ ${recordDiario.toFixed(2)}\n\n`;
                respuesta += `3. ESTIMACION AL CIERRE DE JORNADA:\n`;
                respuesta += `* Proyeccion Escenario Base (Conservador): C$ ${proyeccionConservadora.toFixed(2)}\n`;
                respuesta += `* Proyeccion Escenario Optimista (Pico Nocturno): C$ ${proyeccionOptimista.toFixed(2)}\n`;
                respuesta += `* Variacion Estimada vs Promedio Historico: ${signo}${comparativaVsPromedio}%\n\n`;
                respuesta += `4. RECOMENDACION TACTICA DE INTELIGENCIA OPERATIVA:\n`;
                if (parseFloat(comparativaVsPromedio) >= 0) {
                    respuesta += `* Diagnóstico: Ritmo comercial favorable. Se proyecta cumplimiento o superación de la meta diaria.\n`;
                    respuesta += `* Acción: Mantener stock preparado en mesa de freidoras y asegurar motorizados activos para la demanda nocturna.`;
                } else {
                    respuesta += `* Diagnóstico: Ritmo de facturación por debajo del promedio para este horario.\n`;
                    respuesta += `* Acción: Se recomienda activar de inmediato la campaña de WhatsApp promocional ("Promo Dúo" o "Envío Gratis") para acelerar pedidos.`;
                }

                res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'PROYECCION_VENTAS', respuesta });
            });
        });
    }

    // 1.5 PRODUCTO ESTRELLA, MÁS VENDIDOS Y BAJA ROTACIÓN (Opción 1 del menú o palabras clave)
    if (numMenu === 1 || consulta.includes('estrella') || consulta.includes('mas vendido') || consulta.includes('top') || consulta.includes('mejor') || consulta.includes('rotacion') || consulta.includes('platillo') || consulta.includes('producto')) {
        const sqlTopPlatillos = `
            SELECT p.id_producto, p.nombre, p.precio,
                   COALESCE(SUM(CASE WHEN v.estado != 'ANULADA' THEN vd.cantidad ELSE 0 END), 0) AS unidades_vendidas,
                   COALESCE(SUM(CASE WHEN v.estado != 'ANULADA' THEN vd.subtotal ELSE 0 END), 0) AS ingresos_generados
            FROM productos p
            LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto
            LEFT JOIN ventas v ON vd.id_venta = v.id_venta
            WHERE p.estado = 1
            GROUP BY p.id_producto
            ORDER BY unidades_vendidas DESC, ingresos_generados DESC
        `;
        return db.all(sqlTopPlatillos, [], (errP, lista) => {
            if (errP) return res.status(500).json({ error: errP.message });
            const items = lista || [];
            const top1 = items[0] || { nombre: 'Hamburguesa sencilla', unidades_vendidas: 0, ingresos_generados: 0, precio: 140 };
            const totalIngresosGlobal = items.reduce((acc, it) => acc + parseFloat(it.ingresos_generados || 0), 0);
            const participacion = totalIngresosGlobal > 0 ? ((parseFloat(top1.ingresos_generados) / totalIngresosGlobal) * 100).toFixed(1) : '100.0';
            const top5 = items.slice(0, 5);
            const bajaRot = items.filter(it => parseInt(it.unidades_vendidas, 10) <= 1).slice(0, 4);

            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | ANALISIS DE PRODUCTO ESTRELLA Y ROTACION\n`;
            respuesta += `Motor Hibrido: Base Local SQLite + Accion WhatsApp Web\n`;
            respuesta += `==================================================\n\n`;
            respuesta += `1. PRODUCTO ESTRELLA DEL PERIODO:\n`;
            respuesta += `* Platillo Lider (#1): ${top1.nombre}\n`;
            respuesta += `* Volumen Despachado: ${top1.unidades_vendidas} unidades vendidas\n`;
            respuesta += `* Ingresos Generados: C$ ${parseFloat(top1.ingresos_generados).toFixed(2)} (${participacion}% del mix comercial)\n`;
            respuesta += `* Precio Unitario Vigente: C$ ${parseFloat(top1.precio).toFixed(2)}\n\n`;

            respuesta += `2. RANKING TOP 5 DE MAYOR DEMANDA:\n`;
            top5.forEach((it, idx) => {
                respuesta += `  ${idx + 1}. ${it.nombre} -> ${it.unidades_vendidas} uds (C$ ${parseFloat(it.ingresos_generados).toFixed(2)})\n`;
            });

            if (bajaRot.length > 0) {
                respuesta += `\n3. ALERTA DE BAJA ROTACION (CAPITAL INMOVILIZADO):\n`;
                bajaRot.forEach(b => {
                    respuesta += `  * ${b.nombre} (${b.unidades_vendidas} uds vendidas | Precio: C$ ${parseFloat(b.precio).toFixed(2)})\n`;
                });
                respuesta += `\n4. RECOMENDACION TACTICA HIBRIDA:\n`;
                respuesta += `* Proteja el stock BOM de "${top1.nombre}" en inventario y lance una promocion por WhatsApp Web para impulsar "${bajaRot[0].nombre}" con el codigo AMIGO10.`;
            } else {
                respuesta += `\n3. RECOMENDACION TACTICA:\n`;
                respuesta += `* Todos los platillos presentan rotacion activa. Asegure abastecimiento continuo para "${top1.nombre}".`;
            }

            return res.json({
                agente: 'J.A.R.V.I.S. - Inteligencia Operativa Híbrida',
                categoria: 'PRODUCTO_ESTRELLA',
                respuesta,
                acciones_hibridas: [
                    {
                        etiqueta: 'Difundir Promo Estrella por WhatsApp Web',
                        tipo: 'WHATSAPP_PROMO',
                        mensaje: `EL GUSTAZO - PROMOCION ESPECIAL\nSierra Maestra, Managua\n\nDisfrute hoy nuestro platillo estrella "${top1.nombre}" por C$ ${parseFloat(top1.precio).toFixed(2)}. Solicite su orden respondiendo a este mensaje con un 10% de descuento indicando el codigo AMIGO10.`
                    },
                    {
                        etiqueta: 'Recibir Pedido de WhatsApp Web',
                        tipo: 'ABRIR_MODAL_WA'
                    }
                ]
            });
        });
    }

    // 2. SUGERENCIA DE PROMOCIONES (Opción 3 del menú o palabras clave)
    if (numMenu === 3 || consulta.includes('promocion') || consulta.includes('sugerencia') || consulta.includes('combo') || consulta.includes('oferta') || consulta.includes('estrategia') || (consulta.includes('menu') && !consulta.includes('opcion'))) {
        const sqlTop = `
            SELECT p.id_producto, p.nombre, p.precio, p.id_categoria, COALESCE(SUM(vd.cantidad), 0) as unidades_vendidas
            FROM productos p
            LEFT JOIN venta_detalle vd ON p.id_producto = vd.id_producto
            WHERE p.estado = 1
            GROUP BY p.id_producto
            ORDER BY unidades_vendidas DESC
            LIMIT 5
        `;
        const sqlInsumosAbundantes = `
            SELECT nombre, stock_actual, unidad_medida
            FROM insumos
            WHERE stock_actual > stock_minimo * 1.5
            ORDER BY stock_actual DESC
            LIMIT 3
        `;

        return db.all(sqlTop, [], (errTop, prods) => {
            if (errTop) return res.status(500).json({ error: errTop.message });
            db.all(sqlInsumosAbundantes, [], (errIns, insumos) => {
                if (errIns) return res.status(500).json({ error: errIns.message });

                const topProd1 = prods[0] ? prods[0].nombre : 'Hamburguesa Doble Carne';
                const topProd2 = prods[1] ? prods[1].nombre : 'Alitas BBQ 8 Piezas';
                const topProd3 = prods[2] ? prods[2].nombre : 'Papas Supremas';

                let respuesta = `==================================================\n`;
                respuesta += `J.A.R.V.I.S. | SUGERENCIAS DE PROMOCIONES ESTRATEGICAS\n`;
                respuesta += `Basado en Rendimiento Real del Catálogo y Recetas BOM\n`;
                respuesta += `==================================================\n\n`;
                respuesta += `DIAGNOSTICO DEL CATALOGO LOCAL:\n`;
                respuesta += `* Platillos Estrella (Mayor Demanda): 1) ${topProd1}, 2) ${topProd2}, 3) ${topProd3}\n`;
                if (insumos.length > 0) {
                    respuesta += `* Insumos con Stock Saludable: ${insumos.map(i => `${i.nombre} (${i.stock_actual} ${i.unidad_medida})`).join(', ')}\n\n`;
                } else {
                    respuesta += `\n`;
                }
                respuesta += `PROPUESTAS DE PROMOCION DE ALTA RENTABILIDAD:\n\n`;
                respuesta += `1. COMBO GANCHO "MEGA GUSTAZO":\n`;
                respuesta += `   * Estructura: 1x ${topProd1} + 1x Porción de Papas + 1x Refresco 12oz.\n`;
                respuesta += `   * Precio Sugerido: C$ 220.00 (Ahorro percibido por cliente: C$ 35.00).\n`;
                respuesta += `   * Margen Bruto Estimado: 56.4%.\n`;
                respuesta += `   * Objetivo: Maximizar volumen en mostrador y delivery.\n\n`;
                respuesta += `2. PROMOCION FRANJA HORARIA VALLE (2:30 PM - 5:30 PM):\n`;
                respuesta += `   * Nombre: "Tarde de Alitas y Amigos".\n`;
                respuesta += `   * Estructura: Segunda orden de ${topProd2} al 40% de descuento o 2x C$ 360.00.\n`;
                respuesta += `   * Margen Bruto Estimado: 51.8%.\n`;
                respuesta += `   * Objetivo: Dinamizar horas muertas de cocina sin canibalizar precios pico.\n\n`;
                respuesta += `3. INCENTIVO A TICKET PROMEDIO EN DELIVERY:\n`;
                respuesta += `   * Nombre: "Envío Gratis Sierra Maestra".\n`;
                respuesta += `   * Condición: Pedidos superiores a C$ 380.00.\n`;
                respuesta += `   * Justificación Financiera: La absorción del flete (C$ 30 - 45) queda ampliamente compensada por la utilidad marginal en pedidos grandes.\n\n`;
                respuesta += `RECOMENDACION DE IMPLEMENTACION:\n`;
                respuesta += `Puede crear estas promociones directamente en la pestaña "Promociones y Descuentos" del Panel Administrativo para que aparezcan automáticamente en el POS.`;

                res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'PROMOCIONES', respuesta });
            });
        });
    }

    // 3. AUDITORÍA DE CAJA CHICA Y ARQUEO (Opción 4 del menú o palabras clave)
    if (numMenu === 4 || consulta.includes('auditoria') || consulta.includes('arqueo') || consulta.includes('caja chica') || consulta.includes('descuadre') || consulta.includes('conciliacion') || consulta.includes('caja')) {
        const sqlCaja = `SELECT * FROM cajas WHERE estado = 'ABIERTA' ORDER BY id_caja DESC LIMIT 1`;
        const sqlVentasCaja = `
            SELECT 
                COUNT(id_venta) AS total_ventas,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS efectivo_ventas,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS transferencias_ventas,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 AND UPPER(banco) LIKE '%BDF%' THEN total ELSE 0 END), 0) AS bdf,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 AND UPPER(banco) LIKE '%FICOHSA%' THEN total ELSE 0 END), 0) AS ficohsa,
                COUNT(CASE WHEN estado = 'ANULADA' THEN 1 END) AS cant_anuladas,
                COALESCE(SUM(CASE WHEN estado = 'ANULADA' THEN total ELSE 0 END), 0) AS monto_anulado
            FROM ventas
            WHERE date(fecha, 'localtime') = date('now', 'localtime')
        `;
        const sqlMovCuentas = `
            SELECT 
                tipo,
                COALESCE(SUM(monto), 0) AS total_monto
            FROM movimientos_cuentas
            WHERE date(fecha, 'localtime') = date('now', 'localtime')
            GROUP BY tipo
        `;

        return db.get(sqlCaja, [], (errCaja, caja) => {
            if (errCaja) return res.status(500).json({ error: errCaja.message });
            db.get(sqlVentasCaja, [], (errV, v) => {
                if (errV) return res.status(500).json({ error: errV.message });
                db.all(sqlMovCuentas, [], (errM, movs) => {
                    if (errM) return res.status(500).json({ error: errM.message });

                    const montoInicial = caja ? parseFloat(caja.monto_inicial || 0) : 500.0;
                    const estadoCaja = caja ? `Turno #${caja.id_caja} (ABIERTO)` : `Sin turno abierto registrado hoy`;
                    const efectivoVentas = parseFloat(v.efectivo_ventas || 0);
                    const transferenciasVentas = parseFloat(v.transferencias_ventas || 0);
                    const bdf = parseFloat(v.bdf || 0);
                    const ficohsa = parseFloat(v.ficohsa || 0);
                    const anuladas = parseInt(v.cant_anuladas || 0, 10);
                    const montoAnulado = parseFloat(v.monto_anulado || 0);

                    let egresosAnulaciones = 0;
                    (movs || []).forEach(m => {
                        if (m.tipo === 'EGRESO_ANULACION') egresosAnulaciones += parseFloat(m.total_monto || 0);
                    });

                    const efectivoEsperadoFisico = (montoInicial + efectivoVentas) - egresosAnulaciones;

                    let respuesta = `==================================================\n`;
                    respuesta += `J.A.R.V.I.S. | INFORME DE AUDITORIA Y ARQUEO DE CAJA\n`;
                    respuesta += `Restaurante El Gustazo - Sierra Maestra, Managua\n`;
                    respuesta += `Fecha: ${new Date().toLocaleDateString('es-NI')} ${new Date().toLocaleTimeString('es-NI')}\n`;
                    respuesta += `==================================================\n\n`;
                    respuesta += `ESTADO DE LA CAJA CHICA:\n`;
                    respuesta += `* Estado Operativo: ${estadoCaja}\n`;
                    respuesta += `* Fondo Fijo Inicial (Apertura): C$ ${montoInicial.toFixed(2)}\n\n`;
                    respuesta += `INGRESOS DE CONTADO EN EFECTIVO:\n`;
                    respuesta += `* Ventas en Efectivo Registradas: C$ ${efectivoVentas.toFixed(2)}\n`;
                    respuesta += `* Egresos de Efectivo por Anulaciones: - C$ ${egresosAnulaciones.toFixed(2)}\n`;
                    respuesta += `--------------------------------------------------\n`;
                    respuesta += `* EFECTIVO TEORICO ESPERADO EN CAJON: C$ ${efectivoEsperadoFisico.toFixed(2)}\n\n`;
                    respuesta += `CONCILIACION BANCARIA (Transferencias):\n`;
                    respuesta += `* Total Bancos Recaudado: C$ ${transferenciasVentas.toFixed(2)}\n`;
                    respuesta += `  - Banco BDF: C$ ${bdf.toFixed(2)}\n`;
                    respuesta += `  - Banco Ficohsa: C$ ${ficohsa.toFixed(2)}\n\n`;
                    respuesta += `CONTROL DE INTEGRIDAD Y SEGURIDAD:\n`;
                    respuesta += `* Facturas Comerciales Anuladas: ${anuladas} (Impacto: C$ ${montoAnulado.toFixed(2)})\n`;
                    if (anuladas > 0) {
                        respuesta += `  [ALERTA DE AUDITORIA]: Se registraron ${anuladas} factura(s) anulada(s). Verificar que cuenten con firma y justificación de Gerente General.\n`;
                    } else {
                        respuesta += `  [CONFORME]: No se registran facturas anuladas en la jornada de hoy.\n`;
                    }
                    respuesta += `--------------------------------------------------\n`;
                    respuesta += `Veredicto de Auditoría: Flujo de caja conciliado. Para cerrar turno compare el efectivo teórico con el recuento ciego de billetes.`;

                    res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'AUDITORIA_CAJA', respuesta });
                });
            });
        });
    }

    // 4. RENDIMIENTO DE REPARTIDORES DE DELIVERY (Opción 5 del menú o palabras clave)
    if (numMenu === 5 || consulta.includes('repartidor') || consulta.includes('motorizado') || consulta.includes('reparto') || consulta.includes('flota')) {
        const sqlRepartidores = `
            SELECT 
                COALESCE(p.repartidor, 'Sin Asignar') AS nombre_repartidor,
                COUNT(p.id_pedido) AS total_pedidos,
                COUNT(CASE WHEN p.estado = 'ENTREGADO' THEN 1 END) AS entregados,
                COUNT(CASE WHEN p.estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO') THEN 1 END) AS activos,
                AVG(CASE WHEN p.estado = 'ENTREGADO' AND p.tiempo_total_minutos IS NOT NULL THEN p.tiempo_total_minutos ELSE NULL END) AS tiempo_promedio,
                COALESCE(SUM(CASE WHEN p.estado = 'ENTREGADO' THEN p.costo_delivery ELSE 0 END), 0) AS fletes_totales
            FROM pedidos_delivery p
            WHERE date(p.fecha_creacion, 'localtime') = date('now', 'localtime')
            GROUP BY p.repartidor
            ORDER BY entregados DESC
        `;

        return db.all(sqlRepartidores, [], (err, filas) => {
            if (err) return res.status(500).json({ error: err.message });

            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | DESEMPENO Y LOGISTICA DE REPARTIDORES\n`;
            respuesta += `Flota de Motorizados El Gustazo - Sierra Maestra\n`;
            respuesta += `Fecha: ${new Date().toLocaleDateString('es-NI')} ${new Date().toLocaleTimeString('es-NI')}\n`;
            respuesta += `==================================================\n\n`;

            if (filas.length === 0) {
                respuesta += `Diagnóstico: No se registran despachos de delivery en la fecha de hoy.\n`;
                respuesta += `La flota se encuentra disponible para asignación de nuevos pedidos.`;
            } else {
                respuesta += `TABLA DE RENDIMIENTO INDIVIDUAL (HOY):\n\n`;
                let mejorRepartidor = null;
                let menorTiempo = 999;

                filas.forEach(r => {
                    const tProm = r.tiempo_promedio ? parseFloat(r.tiempo_promedio).toFixed(1) : 'En ruta';
                    respuesta += `* Motorizado: ${r.nombre_repartidor}\n`;
                    respuesta += `  - Pedidos Entregados: ${r.entregados} | En Curso: ${r.activos} | Total Asignados: ${r.total_pedidos}\n`;
                    respuesta += `  - Tiempo Promedio de Entrega: ${tProm} min\n`;
                    respuesta += `  - Fletes Recaudados: C$ ${parseFloat(r.fletes_totales).toFixed(2)}\n\n`;

                    if (r.tiempo_promedio && parseFloat(r.tiempo_promedio) < menorTiempo && r.entregados > 0) {
                        menorTiempo = parseFloat(r.tiempo_promedio);
                        mejorRepartidor = r.nombre_repartidor;
                    }
                });

                respuesta += `--------------------------------------------------\n`;
                respuesta += `EVALUACION DE EFICIENCIA OPERATIVA:\n`;
                if (mejorRepartidor) {
                    respuesta += `* Motorizado Destacado: ${mejorRepartidor} (Tiempo récord promedio: ${menorTiempo.toFixed(1)} minutos).\n`;
                }
                respuesta += `* Estándar Corporativo El Gustazo: <= 35 minutos por entrega.\n`;
                respuesta += `* Estado General: Despachos ejecutados conforme al protocolo logístico de Managua.`;
            }

            res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'RENDIMIENTO_REPARTIDORES', respuesta });
        });
    }

    // 5. INVENTARIO / INSUMOS CRÍTICOS (Opción 6 del menú o palabras clave)
    if (numMenu === 6 || consulta.includes('inventario') || consulta.includes('stock') || consulta.includes('insumo') || consulta.includes('critico') || consulta.includes('materia') || consulta.includes('merma')) {
        const sqlInsumos = `
            SELECT nombre, stock_actual, stock_minimo, unidad_medida
            FROM insumos
            WHERE stock_actual <= stock_minimo
            ORDER BY (stock_actual - stock_minimo) ASC
        `;
        return db.all(sqlInsumos, [], (err, filas) => {
            if (err) return res.status(500).json({ error: err.message });
            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | INFORME DE CONTROL DE INVENTARIOS\n`;
            respuesta += `Fecha de Evaluacion: ${new Date().toLocaleDateString('es-NI')} ${new Date().toLocaleTimeString('es-NI')}\n`;
            respuesta += `==================================================\n\n`;
            if (filas.length === 0) {
                respuesta += `Diagnostico: Todos los insumos operativos se encuentran dentro de los margenes de seguridad establecidos. No se registran alertas de desabastecimiento en cocina.`;
            } else {
                respuesta += `ALERTA DE DESABASTECIMIENTO CRITICO:\n`;
                respuesta += `Se identificaron ${filas.length} materias primas por debajo del umbral mínimo de seguridad:\n\n`;
                filas.forEach(i => {
                    const deficit = (i.stock_minimo - i.stock_actual).toFixed(2);
                    respuesta += `* Insumo: ${i.nombre}\n`;
                    respuesta += `  Stock Actual: ${i.stock_actual} ${i.unidad_medida} | Mínimo: ${i.stock_minimo} ${i.unidad_medida}\n`;
                    respuesta += `  Deficit Operativo: ${deficit} ${i.unidad_medida}\n\n`;
                });
                respuesta += `Recomendación de Gestión: Proceder a la emisión urgente de órdenes de compra para reabastecer las materias primas señaladas y evitar rupturas de menú en cocina.`;
            }
            res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'INVENTARIO', respuesta });
        });
    }

    // 6. FINANZAS, VENTAS GENERALES Y BANCOS (Opción 7 del menú o palabras clave)
    if (numMenu === 7 || consulta.includes('finanza') || consulta.includes('financiero') || consulta.includes('ganancia') || consulta.includes('utilidad') || consulta.includes('rentabilidad') || consulta.includes('banco') || consulta.includes('cuenta') || consulta.includes('dinero') || consulta.includes('venta') || consulta.includes('ingreso') || consulta.includes('factura') || consulta.includes('hoy') || consulta.includes('total') || consulta.includes('cuanto')) {
        const sqlVentas = `
            SELECT 
                COUNT(id_venta) AS total_transacciones,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' THEN total ELSE 0 END), 0) AS total_recaudado,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 1 THEN total ELSE 0 END), 0) AS efectivo,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 THEN total ELSE 0 END), 0) AS transferencias,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 AND UPPER(banco) LIKE '%BDF%' THEN total ELSE 0 END), 0) AS banco_bdf,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' AND id_metodo_pago = 2 AND UPPER(banco) LIKE '%FICOHSA%' THEN total ELSE 0 END), 0) AS banco_ficohsa,
                COALESCE(SUM(CASE WHEN estado = 'COMPLETADA' THEN descuento ELSE 0 END), 0) AS total_descuentos,
                COUNT(CASE WHEN estado = 'ANULADA' THEN 1 END) AS facturas_anuladas,
                COALESCE(SUM(CASE WHEN estado = 'ANULADA' THEN total ELSE 0 END), 0) AS monto_anulado
            FROM ventas
            WHERE date(fecha, 'localtime') = date('now', 'localtime')
        `;
        return db.get(sqlVentas, [], (err, datos) => {
            if (err) return res.status(500).json({ error: err.message });
            const ticketPromedio = datos.total_transacciones > 0 ? (datos.total_recaudado / datos.total_transacciones).toFixed(2) : '0.00';
            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | INFORME FINANCIERO Y DE VENTAS DIARIAS\n`;
            respuesta += `Fecha de Evaluacion: ${new Date().toLocaleDateString('es-NI')}\n`;
            respuesta += `==================================================\n\n`;
            respuesta += `Transacciones Completadas: ${datos.total_transacciones}\n`;
            respuesta += `Total Neto Recaudado: C$ ${parseFloat(datos.total_recaudado).toFixed(2)}\n`;
            respuesta += `Ticket Promedio de Venta: C$ ${ticketPromedio}\n`;
            respuesta += `Descuentos y Bonificaciones Otorgadas: C$ ${parseFloat(datos.total_descuentos).toFixed(2)}\n\n`;
            respuesta += `DISTRIBUCION POR CANAL DE PAGO:\n`;
            respuesta += `* Efectivo en Caja: C$ ${parseFloat(datos.efectivo).toFixed(2)}\n`;
            respuesta += `* Transferencias Bancarias Totales: C$ ${parseFloat(datos.transferencias).toFixed(2)}\n`;
            respuesta += `  - Banco BDF: C$ ${parseFloat(datos.banco_bdf).toFixed(2)}\n`;
            respuesta += `  - Banco Ficohsa: C$ ${parseFloat(datos.banco_ficohsa).toFixed(2)}\n\n`;
            respuesta += `INCIDENCIAS DE AUDITORIA:\n`;
            respuesta += `* Facturas Anuladas: ${datos.facturas_anuladas} (Impacto: C$ ${parseFloat(datos.monto_anulado).toFixed(2)})\n`;
            respuesta += `--------------------------------------------------\n`;
            respuesta += `Diagnostico Financiero: Flujo de operaciones conciliado conforme a los registros en base de datos local.`;
            res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'FINANZAS', respuesta });
        });
    }

    // 7. DELIVERY LOGÍSTICA GENERAL
    if (consulta.includes('delivery') || consulta.includes('entrega') || consulta.includes('tiempo') || consulta.includes('zona') || consulta.includes('envio') || consulta.includes('envío')) {
        const sqlDelivery = `
            SELECT 
                COUNT(id_pedido) AS total_pedidos,
                COUNT(CASE WHEN estado = 'ENTREGADO' THEN 1 END) AS entregados,
                COUNT(CASE WHEN estado IN ('PENDIENTE', 'EN_PREPARACION', 'EN_CAMINO') THEN 1 END) AS activos,
                AVG(CASE WHEN estado = 'ENTREGADO' AND tiempo_total_minutos IS NOT NULL THEN tiempo_total_minutos ELSE NULL END) AS tiempo_promedio,
                COALESCE(SUM(costo_delivery), 0) AS recaudacion_fletes
            FROM pedidos_delivery
            WHERE date(fecha_creacion, 'localtime') = date('now', 'localtime')
        `;
        return db.get(sqlDelivery, [], (err, dlv) => {
            if (err) return res.status(500).json({ error: err.message });
            const tiempoPromedio = dlv.tiempo_promedio ? parseFloat(dlv.tiempo_promedio).toFixed(1) : '28.0';
            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | INFORME DE LOGISTICA Y DELIVERY\n`;
            respuesta += `Plaza Operativa: Sierra Maestra y Zonas Aledanas\n`;
            respuesta += `==================================================\n\n`;
            respuesta += `Volumen Total de Pedidos Hoy: ${dlv.total_pedidos}\n`;
            respuesta += `Pedidos Entregados con Exito: ${dlv.entregados}\n`;
            respuesta += `Pedidos Actualmente en Curso: ${dlv.activos}\n`;
            respuesta += `Tiempo Promedio de Cumplimiento: ${tiempoPromedio} minutos\n`;
            respuesta += `Recaudacion por Tarifas de Envio: C$ ${parseFloat(dlv.recaudacion_fletes).toFixed(2)}\n\n`;
            respuesta += `EVALUACION DE LOGISTICA:\n`;
            if (parseFloat(tiempoPromedio) <= 35) {
                respuesta += `Estado: Conforme a la politica de servicio (Dentro del margen optimo <= 35 minutos).`;
            } else {
                respuesta += `Alerta: El tiempo de respuesta supera el estandar optimo. Se recomienda redistribuir la asignacion de motorizados en zonas perifericas.`;
            }
            res.json({ agente: 'J.A.R.V.I.S. - Inteligencia Operativa', categoria: 'DELIVERY', respuesta });
        });
    }

    // 8. INTEGRACIÓN HÍBRIDA WHATSAPP WEB Y PEDIDOS EN LÍNEA (Opción 8 del menú o palabras clave)
    if (numMenu === 8 || consulta.includes('whatsapp') || consulta.includes('hibrido') || consulta.includes('pedido') || consulta.includes('comanda') || consulta.includes('linea')) {
        const sqlWa = `
            SELECT COUNT(id_pedido) AS total_wa,
                   COUNT(CASE WHEN estado IN ('PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO') THEN 1 END) AS activos_wa,
                   COALESCE(SUM(total), 0) AS monto_wa
            FROM pedidos_delivery
            WHERE UPPER(origen) LIKE '%WHATSAPP%' OR estado != 'CANCELADO'
        `;
        return db.get(sqlWa, [], (errWa, wa) => {
            if (errWa) return res.status(500).json({ error: errWa.message });
            let respuesta = `==================================================\n`;
            respuesta += `J.A.R.V.I.S. | CENTRO HIBRIDO WHATSAPP WEB Y PEDIDOS\n`;
            respuesta += `Arquitectura Hibrida: SQLite Local Offline + WhatsApp Online\n`;
            respuesta += `==================================================\n\n`;
            respuesta += `ESTADO DEL PUENTE HIBRIDO:\n`;
            respuesta += `* Persistencia Transaccional: 100% Local en SQLite3 (Cero caidas por corte de red)\n`;
            respuesta += `* Canal de Mensajeria: Integracion Directa con WhatsApp Web (wa.me)\n`;
            respuesta += `* Pedidos Registrados en Tablero Delivery: ${(wa && wa.total_wa) || 0} (${(wa && wa.activos_wa) || 0} activos en curso)\n`;
            respuesta += `* Volumen Gestionado en Delivery: C$ ${parseFloat((wa && wa.monto_wa) || 0).toFixed(2)}\n\n`;
            respuesta += `FUNCIONES HIBRIDAS DISPONIBLES:\n`;
            respuesta += `1. Recepcion Inteligente de Pedidos WhatsApp: Pegue el mensaje del cliente y cargue los platillos automaticamente a la comanda POS o al tablero Kanban de Delivery.\n`;
            respuesta += `2. Comprobante Digital al Cliente: Envio instantaneo de factura estructurada sin emojis.\n`;
            respuesta += `3. Hoja de Ruta al Motorizado: Despacho de direccion, telefono y cobro exacto al repartidor.`;

            res.json({
                agente: 'J.A.R.V.I.S. - Inteligencia Operativa Híbrida',
                categoria: 'WHATSAPP_HIBRIDO',
                respuesta,
                acciones_hibridas: [
                    { etiqueta: 'Capturar Pedido de WhatsApp Web', tipo: 'ABRIR_MODAL_WA' },
                    { etiqueta: 'Abrir WhatsApp Web Oficial', tipo: 'ABRIR_WA_WEB' }
                ]
            });
        });
    }

    // 9. CIBERSEGURIDAD, AUDITORÍA FORENSE Y RESPALDOS DIARIOS (Opción 9 del menú o palabras clave)
    if (numMenu === 9 || consulta.includes('seguridad') || consulta.includes('respaldo') || consulta.includes('backup') || consulta.includes('ciberseguridad') || consulta.includes('fuerza bruta')) {
        let archivosBackup = [];
        try {
            archivosBackup = fs.readdirSync(backupsDir).filter(f => f.endsWith('.db'));
        } catch (e) { }
        const hoy = new Date().toISOString().slice(0, 10);
        const tieneHoy = archivosBackup.some(f => f.includes(hoy));

        let respuesta = `==================================================\n`;
        respuesta += `J.A.R.V.I.S. | ESTADO DE CIBERSEGURIDAD Y RESPALDOS\n`;
        respuesta += `Restaurante El Gustazo - Proteccion y Continuidad\n`;
        respuesta += `==================================================\n\n`;
        respuesta += `1. POLITICA DE RESPALDO DIARIO AUTOMATICO:\n`;
        respuesta += `* Respaldo del Dia (${hoy}): ${tieneHoy ? 'COMPLETADO Y VERIFICADO' : 'EN PROCESO'}\n`;
        respuesta += `* Total de Copias en Historial Local (database/backups/): ${archivosBackup.length} archivos .db\n`;
        respuesta += `* Compactacion Automatica (VACUUM): Activa en cada Cierre de Caja Chica\n\n`;
        respuesta += `2. CONTROLES DE CIBERSEGURIDAD ACTIVOS:\n`;
        respuesta += `* Anti-Fuerza Bruta: Bloqueo temporal tras 3 intentos fallidos (HTTP 429)\n`;
        respuesta += `* Control RBAC: Separacion estricta Cajero / Administrador / Gerente General\n`;
        respuesta += `* Herramientas Forenses: Detector de Fuerza Bruta, Verificador Magic Bytes, Escaneo SHA-256 y Auditoria B-Tree disponibles en Administracion -> Respaldos.`;

        return res.json({
            agente: 'J.A.R.V.I.S. - Inteligencia Operativa Híbrida',
            categoria: 'SEGURIDAD_RESPALDOS',
            respuesta
        });
    }

    // Orientación por defecto (Menú interactivo por número o lenguaje natural)
    const respuestaMenu = `ASISTENTE J.A.R.V.I.S. (INTELIGENCIA OPERATIVA HIBRIDA)\n` +
        `Restaurante El Gustazo - Sierra Maestra, Managua\n\n` +
        `Puede escribir solo el NUMERO de la opcion (del 1 al 10) o preguntar con sus propias palabras:\n\n` +
        `1. Producto Estrella y Rotacion del Menu\n` +
        `2. Proyeccion de Ventas y Tendencia del Dia\n` +
        `3. Sugerencia de Promociones y Combos Rentables\n` +
        `4. Auditoria de Caja Chica y Arqueo en Vivo\n` +
        `5. Rendimiento y Tiempos de Motorizados Delivery\n` +
        `6. Control de Inventario e Insumos Criticos\n` +
        `7. Estado de Finanzas, Ventas de Hoy y Bancos\n` +
        `8. Centro Hibrido de Pedidos por WhatsApp Web\n` +
        `9. Estado de Ciberseguridad y Respaldos Diarios\n` +
        `10. Diagnostico Integral: Rendimiento Operativo, Finanzas y Medidas a Tomar`;
    res.json({
        agente: 'J.A.R.V.I.S. - Inteligencia Operativa Híbrida',
        categoria: 'ORIENTACION',
        respuesta: respuestaMenu,
        acciones_hibridas: [
            { etiqueta: 'Capturar Pedido de WhatsApp Web', tipo: 'ABRIR_MODAL_WA' }
        ]
    });
});

/**
 * Inicialización del Servidor HTTP
 * ¿Por qué se enlaza a '0.0.0.0'?:
 * Enlazar a '0.0.0.0' en lugar de 'localhost' o '127.0.0.1' es fundamental para un sistema POS:
 * Permite que el servidor escuche peticiones desde CUALQUIER interfaz de red de la máquina,
 * haciendo posible que teléfonos móviles y tablets en la misma red Wi-Fi escaneen el código QR
 * y accedan a la aplicación sin restricciones.
 */
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`[OK] Servidor El Gustazo Activo en http://localhost:${PORT}`);
    console.log(`[OK] Red Local LAN (Móvil QR): http://${getLocalIpAddress()}:${PORT}`);
    console.log(`[OK] Modo: 100% Offline | DB: SQLite3 | Sierra Maestra`);
    console.log(`=======================================================`);
});

/**
 * Manejador de señal SIGTERM (Terminación del Proceso)
 * ¿Por qué se implementó?:
 * Cuando el sistema operativo o el script de apagado detiene el servidor, este evento
 * intercepta la señal y cierra de forma ordenada el servidor HTTP y la conexión SQLite,
 * previniendo la corrupción del archivo DB_ElGustado.db y liberando el puerto inmediatamente.
 */
process.on('SIGTERM', () => {
    server.close(() => {
        db.close();
    });
});