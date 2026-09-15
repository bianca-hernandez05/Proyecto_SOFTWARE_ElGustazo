const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbDir = path.join(__dirname, 'database');
const backupsDir = path.join(dbDir, 'backups');
if (!fs.existsSync(backupsDir)) {
    fs.mkdirSync(backupsDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'DB_ElGustado.db');
const db = new sqlite3.Database(dbPath);

console.log('--- Iniciando inicialización y migración de DB_ElGustado.db ---');

db.serialize(async () => {
    // 1. Tablas estructurales
    db.run(`CREATE TABLE IF NOT EXISTS roles (
        id_rol INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        descripcion TEXT
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id_usuario INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        usuario TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        id_rol INTEGER NOT NULL,
        estado INTEGER NOT NULL DEFAULT 1,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_rol) REFERENCES roles(id_rol)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS categorias (
        id_categoria INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        descripcion TEXT,
        estado INTEGER NOT NULL DEFAULT 1
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS productos (
        id_producto INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL CHECK (precio >= 0),
        id_categoria INTEGER NOT NULL,
        es_combo INTEGER NOT NULL DEFAULT 0,
        estado INTEGER NOT NULL DEFAULT 1,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_categoria) REFERENCES categorias(id_categoria)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS insumos (
        id_insumo INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        unidad_medida TEXT NOT NULL,
        stock_actual REAL NOT NULL DEFAULT 0,
        stock_minimo REAL NOT NULL DEFAULT 0,
        costo_unitario REAL NOT NULL DEFAULT 0,
        estado INTEGER NOT NULL DEFAULT 1,
        fecha_actualizacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        CHECK (stock_actual >= 0),
        CHECK (stock_minimo >= 0)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS recetas (
        id_receta INTEGER PRIMARY KEY AUTOINCREMENT,
        id_producto INTEGER NOT NULL UNIQUE,
        descripcion TEXT,
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS receta_detalle (
        id_receta_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
        id_receta INTEGER NOT NULL,
        id_insumo INTEGER NOT NULL,
        cantidad REAL NOT NULL CHECK (cantidad > 0),
        FOREIGN KEY (id_receta) REFERENCES recetas(id_receta) ON DELETE CASCADE,
        FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo),
        UNIQUE(id_receta, id_insumo)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS combos (
        id_combo INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        descripcion TEXT,
        precio REAL NOT NULL CHECK (precio >= 0),
        estado INTEGER NOT NULL DEFAULT 1
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS combo_productos (
        id_combo_producto INTEGER PRIMARY KEY AUTOINCREMENT,
        id_combo INTEGER NOT NULL,
        id_producto INTEGER NOT NULL,
        cantidad INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (id_combo) REFERENCES combos(id_combo) ON DELETE CASCADE,
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS metodos_pago (
        id_metodo_pago INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE,
        estado INTEGER NOT NULL DEFAULT 1
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS clientes (
        id_cliente INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        telefono TEXT,
        direccion TEXT,
        categoria TEXT NOT NULL DEFAULT 'Ocasional',
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        estado INTEGER NOT NULL DEFAULT 1
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS cajas (
        id_caja INTEGER PRIMARY KEY AUTOINCREMENT,
        fecha_apertura DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        fecha_cierre DATETIME,
        monto_inicial REAL NOT NULL DEFAULT 0,
        monto_efectivo REAL NOT NULL DEFAULT 0,
        monto_transferencia REAL NOT NULL DEFAULT 0,
        monto_esperado REAL NOT NULL DEFAULT 0,
        monto_real REAL,
        diferencia REAL,
        estado TEXT NOT NULL DEFAULT 'ABIERTA',
        id_usuario_apertura INTEGER NOT NULL,
        id_usuario_cierre INTEGER,
        notas TEXT,
        FOREIGN KEY (id_usuario_apertura) REFERENCES usuarios(id_usuario),
        FOREIGN KEY (id_usuario_cierre) REFERENCES usuarios(id_usuario)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS ventas (
        id_venta INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_factura TEXT NOT NULL UNIQUE,
        fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        subtotal REAL NOT NULL DEFAULT 0,
        impuesto REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        monto_recibido REAL NOT NULL DEFAULT 0,
        vuelto REAL NOT NULL DEFAULT 0,
        id_metodo_pago INTEGER NOT NULL,
        id_usuario INTEGER NOT NULL,
        id_caja INTEGER NOT NULL,
        estado TEXT NOT NULL DEFAULT 'COMPLETADA',
        id_cliente INTEGER,
        cliente_nombre TEXT,
        banco TEXT,
        referencia_transferencia TEXT,
        tipo_comprobante TEXT DEFAULT 'TICKET',
        FOREIGN KEY (id_metodo_pago) REFERENCES metodos_pago(id_metodo_pago),
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
        FOREIGN KEY (id_caja) REFERENCES cajas(id_caja),
        FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS venta_detalle (
        id_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
        id_venta INTEGER NOT NULL,
        id_producto INTEGER NOT NULL,
        cantidad INTEGER NOT NULL CHECK (cantidad > 0),
        precio_unitario REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta) ON DELETE CASCADE,
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS movimientos_inventario (
        id_movimiento INTEGER PRIMARY KEY AUTOINCREMENT,
        id_insumo INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
        cantidad REAL NOT NULL CHECK (cantidad > 0),
        motivo TEXT,
        id_venta INTEGER,
        id_usuario INTEGER,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo),
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS alertas_stock (
        id_alerta INTEGER PRIMARY KEY AUTOINCREMENT,
        id_insumo INTEGER NOT NULL,
        stock_actual REAL NOT NULL,
        stock_minimo REAL NOT NULL,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        atendida INTEGER NOT NULL DEFAULT 0,
        FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo)
    );`);

    // Comprobar y agregar columnas faltantes directamente
    db.run("ALTER TABLE ventas ADD COLUMN id_cliente INTEGER", () => {});
    db.run("ALTER TABLE ventas ADD COLUMN cliente_nombre TEXT", () => {});
    db.run("ALTER TABLE ventas ADD COLUMN banco TEXT", () => {});
    db.run("ALTER TABLE ventas ADD COLUMN referencia_transferencia TEXT", () => {});
    db.run("ALTER TABLE ventas ADD COLUMN tipo_comprobante TEXT DEFAULT 'TICKET'", () => {});
    db.run("ALTER TABLE productos ADD COLUMN es_combo INTEGER NOT NULL DEFAULT 0", () => {});
    db.run("ALTER TABLE cajas ADD COLUMN notas TEXT", () => {});

    // 2. Semillas iniciales
    // Roles
    db.run(`INSERT OR IGNORE INTO roles (id_rol, nombre, descripcion) VALUES 
        (1, 'Administrador', 'Acceso completo al sistema'),
        (2, 'Cajero', 'Acceso limitado a ventas y facturación')`);

    // Usuarios
    db.run(`INSERT OR IGNORE INTO usuarios (id_usuario, nombre, usuario, password, id_rol, estado) VALUES 
        (1, 'Administrador El Gustazo', 'admin', 'admin123', 1, 1),
        (2, 'Cajero Turno Principal', 'cajero', 'cajero123', 2, 1)`);

    // Metodos de pago (Solo Efectivo y Transferencia)
    db.run(`INSERT OR IGNORE INTO metodos_pago (id_metodo_pago, nombre, estado) VALUES 
        (1, 'Efectivo', 1),
        (2, 'Transferencia', 1)`);

    // Categorias
    const categorias = [
        [1, 'Hamburguesas', 'Hamburguesas gourmet al estilo El Gustazo'],
        [2, 'Papas y Acompañamientos', 'Papas fritas crujientes y complementos'],
        [3, 'Pollo Crispy', 'Piezas de pollo crujiente empanizado'],
        [4, 'Bebidas', 'Refrescos, té frío y gaseosas'],
        [5, 'Combos', 'Combos y promociones especiales']
    ];
    categorias.forEach(c => {
        db.run(`INSERT OR IGNORE INTO categorias (id_categoria, nombre, descripcion, estado) VALUES (?, ?, ?, 1)`, c);
    });

    // Clientes iniciales
    const clientes = [
        [1, 'Consumidor Final', '0000-0000', 'En Local', 'Ocasional'],
        [2, 'Carlos Mendoza', '8899-7711', 'Sierra Maestra, Semáforos 2c al Sur', 'VIP'],
        [3, 'Ana Sofía Morales', '8765-4321', 'Reparto Schick, Managua', 'Frecuente'],
        [4, 'Taller San Judas S.A.', '8456-7890', 'Pista Suburbana, Frente a Gasolinera', 'Corporativo']
    ];
    clientes.forEach(cl => {
        db.run(`INSERT OR IGNORE INTO clientes (id_cliente, nombre, telefono, direccion, categoria, estado) VALUES (?, ?, ?, ?, ?, 1)`, cl);
    });

    // Insumos
    const insumos = [
        [1, 'Pan de Hamburguesa Clásico', 'unidad', 60, 15, 9.50],
        [2, 'Torta de Res Especial 150g', 'unidad', 50, 15, 38.00],
        [3, 'Queso Cheddar Fundido', 'lámina', 75, 20, 6.50],
        [4, 'Papas Corte Francés Congeladas', 'porción', 55, 15, 18.00],
        [5, 'Aceite Vegetal para Freír', 'litro', 30, 10, 52.00],
        [6, 'Presa de Pollo Fresco', 'pieza', 45, 15, 24.00],
        [7, 'Harina y Especias Crispy', 'porción', 60, 15, 6.00],
        [8, 'Salsa Secreta El Gustazo', 'porción', 90, 20, 4.50],
        [9, 'Tomate y Lechuga Seleccionada', 'porción', 12, 20, 5.00], // Alerta: Stock Bajo (12 <= 20)
        [10, 'Tiras de Tocino Ahumado', 'tiras', 10, 18, 14.00],        // Alerta: Stock Bajo (10 <= 18)
        [11, 'Gaseosa Botella 500ml', 'botella', 50, 15, 20.00],
        [12, 'Té Frío de la Casa', 'vaso', 40, 12, 10.00]
    ];
    insumos.forEach(ins => {
        db.run(`INSERT OR IGNORE INTO insumos (id_insumo, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, estado) VALUES (?, ?, ?, ?, ?, ?, 1)`, ins);
    });

    // Productos
    const productos = [
        [1, 'Hamburguesa Clásica El Gustazo', 'Pan artesanal, torta de res 150g, queso cheddar, vegetales frescos y salsa especial', 140.00, 1, 0],
        [2, 'Hamburguesa Doble Carne y Doble Queso', 'Doble torta de res 150g, doble queso cheddar, salsa secreta El Gustazo', 210.00, 1, 0],
        [3, 'Hamburguesa Bacon Deluxe', 'Torta de res, queso cheddar derretido, tocino crujiente y vegetales', 190.00, 1, 0],
        [4, 'Papas Supremas Fritas', 'Porción generosa de papas crujientes con toque de sal y salsa de la casa', 85.00, 2, 0],
        [5, 'Pollo Crispy (2 Piezas) con Papas', '2 crujientes piezas de pollo con papas fritas y aderezo', 160.00, 3, 0],
        [6, 'Pollo Crispy Familiar (4 Piezas)', '4 piezas de pollo crocante dorado con papas dobles', 280.00, 3, 0],
        [7, 'Gaseosa 500ml', 'Bebida gaseosa bien fría surtida', 35.00, 4, 0],
        [8, 'Té Helado de la Casa', 'Té natural helado con limón', 30.00, 4, 0],
        [9, 'Combo Gustazo Individual', 'Hamburguesa Clásica + Papas Supremas + Gaseosa 500ml', 230.00, 5, 1],
        [10, 'Combo Mega Familiar Gustazo', '2 Hamburguesas Clásicas + Pollo Crispy 2 Pzas + 2 Papas + 2 Gaseosas', 560.00, 5, 1]
    ];
    productos.forEach(p => {
        db.run(`INSERT OR IGNORE INTO productos (id_producto, nombre, descripcion, precio, id_categoria, es_combo, estado) VALUES (?, ?, ?, ?, ?, ?, 1)`, p);
    });

    // Recetas (BOM)
    // 1: Hamburguesa Clásica (Pan: 1, Torta: 1, Queso: 1, Salsa: 1, Vegetales: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (1, 1, 'Receta Hamburguesa Clásica')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (1, 1, 1),
        (1, 2, 1),
        (1, 3, 1),
        (1, 8, 1),
        (1, 9, 1)`);

    // 2: Doble Carne y Queso (Pan: 1, Torta: 2, Queso: 2, Salsa: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (2, 2, 'Receta Hamburguesa Doble')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (2, 1, 1),
        (2, 2, 2),
        (2, 3, 2),
        (2, 8, 1)`);

    // 3: Bacon Deluxe (Pan: 1, Torta: 1, Queso: 1, Tocino: 2, Salsa: 1, Vegetales: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (3, 3, 'Receta Bacon Deluxe')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (3, 1, 1),
        (3, 2, 1),
        (3, 3, 1),
        (3, 10, 2),
        (3, 8, 1),
        (3, 9, 1)`);

    // 4: Papas Supremas (Papas: 1, Aceite: 0.1, Salsa: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (4, 4, 'Receta Papas Supremas')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (4, 4, 1),
        (4, 5, 0.1),
        (4, 8, 1)`);

    // 5: Pollo Crispy 2 Pzas (Pollo: 2, Harina: 1, Papas: 1, Aceite: 0.15)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (5, 5, 'Receta Pollo Crispy 2 Piezas')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (5, 6, 2),
        (5, 7, 1),
        (5, 4, 1),
        (5, 5, 0.15)`);

    // 6: Pollo Crispy 4 Pzas (Pollo: 4, Harina: 2, Papas: 2, Aceite: 0.25)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (6, 6, 'Receta Pollo Familiar 4 Piezas')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (6, 6, 4),
        (6, 7, 2),
        (6, 4, 2),
        (6, 5, 0.25)`);

    // 7: Gaseosa (Gaseosa: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (7, 7, 'Receta Gaseosa 500ml')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES (7, 11, 1)`);

    // 8: Té Helado (Té: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (8, 8, 'Receta Té Helado')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES (8, 12, 1)`);

    // 9: Combo Gustazo Individual (Pan: 1, Torta: 1, Queso: 1, Salsa: 2, Vegetales: 1, Papas: 1, Aceite: 0.1, Gaseosa: 1)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (9, 9, 'Receta Combo Gustazo Individual')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (9, 1, 1),
        (9, 2, 1),
        (9, 3, 1),
        (9, 8, 2),
        (9, 9, 1),
        (9, 4, 1),
        (9, 5, 0.1),
        (9, 11, 1)`);

    // 10: Combo Mega Familiar Gustazo (Pan: 2, Torta: 2, Queso: 2, Salsa: 4, Vegetales: 2, Pollo: 2, Harina: 1, Papas: 2, Aceite: 0.25, Gaseosa: 2)
    db.run(`INSERT OR IGNORE INTO recetas (id_receta, id_producto, descripcion) VALUES (10, 10, 'Receta Combo Mega Familiar')`);
    db.run(`INSERT OR IGNORE INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES 
        (10, 1, 2),
        (10, 2, 2),
        (10, 3, 2),
        (10, 8, 4),
        (10, 9, 2),
        (10, 6, 2),
        (10, 7, 1),
        (10, 4, 2),
        (10, 5, 0.25),
        (10, 11, 2)`);

    console.log('--- Migración y semillero completado exitosamente ---');
});

setTimeout(() => {
    db.close();
}, 2000);
