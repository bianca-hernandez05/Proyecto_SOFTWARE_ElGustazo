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

console.log('--- Iniciando inicialización y migración completa de DB_ElGustado.db ---');

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
        costo_delivery REAL NOT NULL DEFAULT 0,
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
        telefono_cliente TEXT,
        tipo_entrega TEXT DEFAULT 'LOCAL', -- 'LOCAL', 'LLEVAR', 'DELIVERY'
        origen_pedido TEXT DEFAULT 'MOSTRADOR', -- 'MOSTRADOR', 'WHATSAPP', 'LLAMADA'
        direccion_entrega TEXT,
        repartidor TEXT,
        notas_delivery TEXT,
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

    db.run(`CREATE TABLE IF NOT EXISTS repartidores (
        id_repartidor INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        telefono TEXT,
        vehiculo TEXT DEFAULT 'Moto',
        placa TEXT,
        estado INTEGER NOT NULL DEFAULT 1
    );`);

    // TABLA DE PEDIDOS DELIVERY (Flujo: PENDIENTE -> EN_PREPARACION -> LISTO -> EN_CAMINO -> ENTREGADO)
    db.run(`CREATE TABLE IF NOT EXISTS pedidos_delivery (
        id_pedido INTEGER PRIMARY KEY AUTOINCREMENT,
        numero_pedido TEXT NOT NULL UNIQUE,
        id_cliente INTEGER,
        cliente_nombre TEXT NOT NULL,
        telefono TEXT,
        direccion TEXT NOT NULL,
        origen TEXT NOT NULL DEFAULT 'WHATSAPP', -- 'WHATSAPP', 'LLAMADA'
        estado TEXT NOT NULL DEFAULT 'PENDIENTE', -- 'PENDIENTE', 'EN_PREPARACION', 'LISTO', 'EN_CAMINO', 'ENTREGADO', 'CANCELADO'
        repartidor TEXT,
        id_repartidor INTEGER,
        notas TEXT,
        costo_delivery REAL NOT NULL DEFAULT 0,
        subtotal REAL NOT NULL DEFAULT 0,
        impuesto REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL DEFAULT 0,
        id_metodo_pago INTEGER NOT NULL DEFAULT 1,
        banco TEXT,
        referencia_transferencia TEXT,
        id_caja INTEGER,
        id_usuario INTEGER,
        id_venta INTEGER,
        fecha_creacion DATETIME DEFAULT CURRENT_TIMESTAMP,
        fecha_entrega DATETIME,
        FOREIGN KEY (id_cliente) REFERENCES clientes(id_cliente),
        FOREIGN KEY (id_repartidor) REFERENCES repartidores(id_repartidor),
        FOREIGN KEY (id_caja) REFERENCES cajas(id_caja),
        FOREIGN KEY (id_usuario) REFERENCES usuarios(id_usuario),
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS pedido_delivery_detalle (
        id_detalle INTEGER PRIMARY KEY AUTOINCREMENT,
        id_pedido INTEGER NOT NULL,
        id_producto INTEGER NOT NULL,
        cantidad INTEGER NOT NULL CHECK (cantidad > 0),
        precio_unitario REAL NOT NULL,
        subtotal REAL NOT NULL,
        FOREIGN KEY (id_pedido) REFERENCES pedidos_delivery(id_pedido) ON DELETE CASCADE,
        FOREIGN KEY (id_producto) REFERENCES productos(id_producto)
    );`);

    db.run(`CREATE TABLE IF NOT EXISTS movimientos_inventario (
        id_movimiento INTEGER PRIMARY KEY AUTOINCREMENT,
        id_insumo INTEGER NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('ENTRADA', 'SALIDA', 'AJUSTE')),
        cantidad REAL NOT NULL CHECK (cantidad > 0),
        motivo TEXT,
        id_venta INTEGER,
        id_pedido_delivery INTEGER,
        id_usuario INTEGER,
        fecha DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (id_insumo) REFERENCES insumos(id_insumo),
        FOREIGN KEY (id_venta) REFERENCES ventas(id_venta),
        FOREIGN KEY (id_pedido_delivery) REFERENCES pedidos_delivery(id_pedido),
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

    // Migraciones de columnas en tablas existentes si ya existían
    const columnasVentas = [
        "ALTER TABLE ventas ADD COLUMN costo_delivery REAL NOT NULL DEFAULT 0",
        "ALTER TABLE ventas ADD COLUMN tipo_entrega TEXT DEFAULT 'LOCAL'",
        "ALTER TABLE ventas ADD COLUMN origen_pedido TEXT DEFAULT 'MOSTRADOR'",
        "ALTER TABLE ventas ADD COLUMN direccion_entrega TEXT",
        "ALTER TABLE ventas ADD COLUMN repartidor TEXT",
        "ALTER TABLE ventas ADD COLUMN telefono_cliente TEXT",
        "ALTER TABLE ventas ADD COLUMN notas_delivery TEXT",
        "ALTER TABLE ventas ADD COLUMN id_cliente INTEGER",
        "ALTER TABLE ventas ADD COLUMN cliente_nombre TEXT",
        "ALTER TABLE ventas ADD COLUMN banco TEXT",
        "ALTER TABLE ventas ADD COLUMN referencia_transferencia TEXT",
        "ALTER TABLE ventas ADD COLUMN tipo_comprobante TEXT DEFAULT 'TICKET'",
        "ALTER TABLE productos ADD COLUMN es_combo INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE cajas ADD COLUMN notas TEXT",
        "ALTER TABLE movimientos_inventario ADD COLUMN id_pedido_delivery INTEGER"
    ];
    columnasVentas.forEach(sql => db.run(sql, () => {}));

    // 2. Semillas iniciales
    // Roles
    db.run(`INSERT OR IGNORE INTO roles (id_rol, nombre, descripcion) VALUES 
        (1, 'Administrador', 'Acceso completo al sistema'),
        (2, 'Cajero', 'Acceso a ventas, delivery y facturación')`);

    // Usuarios
    db.run(`INSERT OR IGNORE INTO usuarios (id_usuario, nombre, usuario, password, id_rol, estado) VALUES 
        (1, 'Administrador El Gustazo', 'admin', 'admin123', 1, 1),
        (2, 'Cajero Turno Principal', 'cajero', 'cajero123', 2, 1)`);

    // Metodos de pago
    db.run(`INSERT OR IGNORE INTO metodos_pago (id_metodo_pago, nombre, estado) VALUES 
        (1, 'Efectivo', 1),
        (2, 'Transferencia', 1)`);

    // Repartidores Oficiales
    const repartidores = [
        [1, 'Carlos Mendoza (Moto 1)', '8899-7711', 'Moto Génesis 150', 'M-98214'],
        [2, 'Maycol Rodríguez (Moto 2)', '8765-4321', 'Moto Serpento 125', 'M-34109'],
        [3, 'Personal de Turno El Gustazo', '8456-7890', 'A pie / Bici', 'Local']
    ];
    repartidores.forEach(r => {
        db.run(`INSERT OR IGNORE INTO repartidores (id_repartidor, nombre, telefono, vehiculo, placa, estado) VALUES (?, ?, ?, ?, ?, 1)`, r);
    });

    // Categorias Oficiales del Menú
    const categorias = [
        [1, 'Hamburguesas', 'Hamburguesas sencillas, dobles, triples y filete de pollo'],
        [2, 'Combos', 'Hamburguesas con papas fritas'],
        [3, 'Combos Especiales', 'Combo Pareja y Combo Amigos para compartir'],
        [4, 'Hot Dog', 'Hot dogs sencillos, con papas y especiales'],
        [5, 'Burritos o Quesadillas', 'Burritos y quesadillas sencillas o con papas'],
        [6, 'Papas', 'Papas clásicas, queso rayado, queso cheddar y salchipapas'],
        [7, 'Pollo a la Plancha', 'Filete de pollo con papas y ensalada'],
        [8, 'Snaks', 'Nachos mixtos con res y pollo'],
        [9, 'Extras', 'Salsas adicionales búfalo, cheddar, barbacoa, pico de gallo y ranch'],
        [10, 'Alitas', 'Combos de alitas de 4 a 36 piezas con papas y salsas'],
        [11, 'Bebidas', 'Gaseosas surtidas, jugos Hyci y agua purificada']
    ];
    categorias.forEach(c => {
        db.run(`INSERT OR REPLACE INTO categorias (id_categoria, nombre, descripcion, estado) VALUES (?, ?, ?, 1)`, c);
    });

    // Clientes iniciales con direcciones en Sierra Maestra y alrededores
    const clientes = [
        [1, 'Consumidor Final', '0000-0000', 'En Local / Mostrador', 'Ocasional'],
        [2, 'Carlos Mendoza', '8899-7711', 'Sierra Maestra, de los semáforos 2c al sur, casa esquinera color crema', 'VIP'],
        [3, 'Ana Sofía Morales', '8765-4321', 'Sierra Maestra, del Parque Infantil 1c abajo 1/2c al lago', 'Frecuente'],
        [4, 'Roberto Gutiérrez', '8456-7890', 'Reparto Schick, Managua, del portón 2c arriba', 'Frecuente'],
        [5, 'Lucía Fernández', '8912-3456', 'Sierra Maestra, contiguo a la pulpería La Bendición', 'VIP']
    ];
    clientes.forEach(cl => {
        db.run(`INSERT OR REPLACE INTO clientes (id_cliente, nombre, telefono, direccion, categoria, estado) VALUES (?, ?, ?, ?, ?, 1)`, cl);
    });

    // Insumos Medibles del Inventario
    const insumos = [
        [1, 'Pan de Hamburguesa', 'unidad', 120, 30, 8.50],
        [2, 'Carne de Hamburguesa', 'unidad', 100, 25, 30.00],
        [3, 'Pollo (Filete y Piezas Alitas)', 'pieza', 150, 35, 20.00],
        [4, 'Queso Amarillo / Cheddar', 'lámina', 140, 40, 6.00],
        [5, 'Papas (Porción / Orden)', 'porción', 110, 30, 18.00],
        [6, 'Pan de Hot Dog', 'unidad', 60, 20, 7.50],
        [7, 'Salchicha', 'unidad', 80, 25, 10.00],
        [8, 'Tortilla', 'unidad', 70, 20, 8.00],
        [9, 'Salsas Extras en Sobre', 'sobre', 100, 30, 8.00],
        [10, 'Gaseosa 12 onz', 'unidad', 60, 24, 18.00],
        [11, 'Gaseosa 1/2 litro', 'unidad', 50, 20, 22.00],
        [12, 'Gaseosa 1 litro', 'unidad', 40, 15, 28.00],
        [13, 'Gaseosa 2 litros desechable', 'unidad', 35, 12, 55.00],
        [14, 'Gaseosa 2 litros retornable', 'unidad', 30, 12, 40.00],
        [15, 'Jugo Té Hyci', 'unidad', 45, 15, 25.00],
        [16, 'Jugo Hyci Manzana', 'unidad', 40, 15, 25.00],
        [17, 'Agua 1 litro', 'unidad', 35, 15, 22.00]
    ];
    insumos.forEach(ins => {
        db.run(`INSERT OR REPLACE INTO insumos (id_insumo, nombre, unidad_medida, stock_actual, stock_minimo, costo_unitario, estado) VALUES (?, ?, ?, ?, ?, ?, 1)`, ins);
    });

    // Productos Oficiales de Menú
    const productos = [
        // Hamburguesas (Cat 1)
        [1, 'Hamburguesa sencilla', '2 panes, 1 carne, sin queso', 80.00, 1, 0],
        [2, 'Hamburguesa queso + bacon', '2 panes, 1 carne, 1 queso cheddar, bacon crujiente', 100.00, 1, 0],
        [3, 'Hamburguesa doble', '2 panes, 2 carnes de res, 1 queso cheddar', 120.00, 1, 0],
        [4, 'Hamburguesa triple', '2 panes, 3 carnes de res, 2 quesos cheddar, bacon', 150.00, 1, 0],
        [5, 'Hamburguesa filete de pollo', '2 panes artesanales y 1 filete de pollo jugoso', 120.00, 1, 0],

        // Combos (Cat 2)
        [6, 'Hamburguesa queso + bacon + papas', 'Hamburguesa con queso y bacon acompañada de orden de papas', 140.00, 2, 1],
        [7, 'Hamburguesa doble + papas', 'Hamburguesa doble carne con queso acompañada de orden de papas', 160.00, 2, 1],
        [8, 'Hamburguesa de filete + papas', 'Hamburguesa de filete de pollo acompañada de orden de papas', 160.00, 2, 1],

        // Combos Especiales (Cat 3)
        [9, 'Combo pareja', '6 alitas + 2 hamburguesas queso y bacon + 1 orden de papas + 2 gaseosas 12 onz', 470.00, 3, 1],
        [10, 'Combo amigos', '12 alitas + 4 hamburguesas queso y bacon + 2 órdenes de papas + 2 gaseosas 2 lts', 820.00, 3, 1],

        // Hot Dog (Cat 4)
        [11, 'Hot dog sencillo', '1 pan y 1 salchicha con salsas de la casa', 80.00, 4, 0],
        [12, 'Hot dog sencillo + papas', '1 hot dog sencillo acompañado de 1 orden de papas crujientes', 140.00, 4, 1],
        [13, 'Hot dog especial', 'Hot dog con salchicha especial de la casa', 90.00, 4, 0],

        // Burritos o Quesadillas (Cat 5)
        [14, 'Burrito sencillo', 'Tortilla de harina rellena al estilo El Gustazo', 120.00, 5, 0],
        [15, 'Burrito + papas', 'Burrito sencillo acompañado de 1 orden de papas fritas', 160.00, 5, 1],
        [16, 'Quesadilla sencilla', 'Tortilla tostada con queso fundido y relleno', 120.00, 5, 0],
        [17, 'Quesadilla + papas', 'Quesadilla sencilla acompañada de 1 orden de papas', 160.00, 5, 1],

        // Papas (Cat 6)
        [18, 'Papas Fritas clásicas', 'Orden completa de papas fritas crujientes', 70.00, 6, 0],
        [19, 'Papas Fritas con Queso Rayado', 'Papas fritas clásicas cubiertas con abundante queso rayado', 80.00, 6, 0],
        [20, 'Papas Fritas con Queso Cheddar', 'Papas crujientes bañadas en salsa queso cheddar fundido', 90.00, 6, 0],
        [21, 'Salchipapas', 'Orden de papas fritas combinadas con salchicha en rodajas', 90.00, 6, 0],

        // Pollo a la Plancha (Cat 7)
        [22, 'Orden de Filete de pollo', 'Filete de pollo a la plancha + orden de papas + ensalada pico de gallo', 200.00, 7, 0],

        // Snaks (Cat 8)
        [23, 'Nachos mixtos (Res y carne)', 'Nachos crujientes con combinación de res y carne al gusto', 300.00, 8, 0],

        // Extras (Cat 9)
        [24, 'Salsa Búfalo', 'Porción / sobre de salsa búfalo picante', 25.00, 9, 0],
        [25, 'Salsa Cheddar', 'Porción / sobre de queso cheddar fundido', 25.00, 9, 0],
        [26, 'Salsa barbacoa', 'Porción / sobre de salsa BBQ ahumada', 25.00, 9, 0],
        [27, 'Pico de Gallo', 'Porción fresca de pico de gallo', 25.00, 9, 0],
        [28, 'Salsa ranch', 'Porción / sobre de aderezo ranch', 30.00, 9, 0],

        // Alitas (Cat 10)
        [29, 'Alitas combo 4 piezas', '4 piezas de alitas + 1 orden de papas fritas', 170.00, 10, 1],
        [30, 'Alitas combo 6 piezas', '6 piezas de alitas + 1 orden de papas + 1 salsa extra', 250.00, 10, 1],
        [31, 'Alitas combo 10 piezas', '10 piezas de alitas + 1 orden de papas + 1 salsa extra', 380.00, 10, 1],
        [32, 'Alitas combo 12 piezas', '12 piezas de alitas + 2 órdenes de papas + 2 salsas extras', 480.00, 10, 1],
        [33, 'Alitas combo 20 piezas', '20 piezas de alitas + 2 órdenes de papas + 2 salsas extras', 690.00, 10, 1],
        [34, 'Alitas combo 24 piezas', '24 piezas de alitas + 3 órdenes de papas + 3 salsas extras', 890.00, 10, 1],
        [35, 'Alitas combo 36 piezas', '36 piezas de alitas + 4 órdenes de papas + 4 salsas extras', 1250.00, 10, 1],

        // Bebidas (Cat 11)
        [36, 'Gaseosa 12 onz', 'Gaseosa fría 12 onzas', 25.00, 11, 0],
        [37, 'Gaseosa 1/2 litro', 'Gaseosa 500ml fría', 30.00, 11, 0],
        [38, 'Gaseosa 1 litro', 'Gaseosa 1 litro fría', 40.00, 11, 0],
        [39, 'Gaseosa 2 litro desechable', 'Gaseosa 2 litros botella plástica no retornable', 75.00, 11, 0],
        [40, 'Gaseosa 2 litro retornable', 'Gaseosa 2 litros retornable', 55.00, 11, 0],
        [41, 'Jugo té hyci', 'Té helado Hyci refrescante', 35.00, 11, 0],
        [42, 'Jugo hyci manzana', 'Jugo natural de manzana Hyci', 35.00, 11, 0],
        [43, 'Agua 1 litro', 'Agua purificada 1 litro', 35.00, 11, 0]
    ];
    productos.forEach(p => {
        db.run(`INSERT OR REPLACE INTO productos (id_producto, nombre, descripcion, precio, id_categoria, es_combo, estado) VALUES (?, ?, ?, ?, ?, ?, 1)`, p);
    });

    // Limpiar y configurar Recetas Exactas (BOM)
    db.run(`DELETE FROM receta_detalle`);
    db.run(`DELETE FROM recetas`);

    const recetasData = [
        // Hamburguesas
        { prod: 1, desc: 'Hamburguesa sencilla', ings: [[1, 2], [2, 1]] }, // 2 panes, 1 carne
        { prod: 2, desc: 'Hamburguesa queso + bacon', ings: [[1, 2], [2, 1], [4, 1]] }, // 2 panes, 1 carne, 1 queso
        { prod: 3, desc: 'Hamburguesa doble', ings: [[1, 2], [2, 2], [4, 1]] }, // 2 panes, 2 carnes, 1 queso
        { prod: 4, desc: 'Hamburguesa triple', ings: [[1, 2], [2, 3], [4, 2]] }, // 2 panes, 3 carnes, 2 quesos
        { prod: 5, desc: 'Hamburguesa filete de pollo', ings: [[1, 2], [3, 1]] }, // 2 panes, 1 filete pollo

        // Combos
        { prod: 6, desc: 'Hamburguesa queso+bacon+papas', ings: [[1, 2], [2, 1], [4, 1], [5, 1]] },
        { prod: 7, desc: 'Hamburguesa doble+papas', ings: [[1, 2], [2, 2], [4, 1], [5, 1]] },
        { prod: 8, desc: 'Hamburguesa filete+papas', ings: [[1, 2], [3, 1], [5, 1]] },

        // Combos Especiales
        // Combo pareja: 6 alitas(pollo), 2 hamburguesas queso+bacon (4 panes, 2 carne, 1 queso total), 1 orden papas, 2 gaseosas 12 onz
        { prod: 9, desc: 'Combo pareja', ings: [[3, 6], [1, 4], [2, 2], [4, 1], [5, 1], [10, 2]] },
        // Combo amigos: 12 alitas(pollo), 4 hamburguesas (8 panes, 4 carne, 2 queso total), 2 órdenes papas, 2 gaseosas 2 lts
        { prod: 10, desc: 'Combo amigos', ings: [[3, 12], [1, 8], [2, 4], [4, 2], [5, 2], [13, 2]] },

        // Hot Dog
        { prod: 11, desc: 'Hot dog sencillo', ings: [[6, 1], [7, 1]] },
        { prod: 12, desc: 'Hot dog sencillo + papas', ings: [[6, 1], [7, 1], [5, 1]] },
        { prod: 13, desc: 'Hot dog especial', ings: [[6, 1], [7, 1]] },

        // Burritos y Quesadillas
        { prod: 14, desc: 'Burrito sencillo', ings: [[8, 1]] },
        { prod: 15, desc: 'Burrito + papas', ings: [[8, 1], [5, 1]] },
        { prod: 16, desc: 'Quesadilla sencilla', ings: [[8, 1]] },
        { prod: 17, desc: 'Quesadilla + papas', ings: [[8, 1], [5, 1]] },

        // Papas
        { prod: 18, desc: 'Papas clásicas', ings: [[5, 1]] },
        { prod: 19, desc: 'Papas queso rayado', ings: [[5, 1]] },
        { prod: 20, desc: 'Papas queso cheddar', ings: [[5, 1]] },
        { prod: 21, desc: 'Salchipapas', ings: [[5, 1], [7, 1]] },

        // Pollo a la plancha
        { prod: 22, desc: 'Filete de pollo con papas', ings: [[3, 1], [5, 1]] },

        // Extras (Salsas)
        { prod: 24, desc: 'Salsa Búfalo', ings: [[9, 1]] },
        { prod: 25, desc: 'Salsa Cheddar', ings: [[9, 1]] },
        { prod: 26, desc: 'Salsa barbacoa', ings: [[9, 1]] },
        { prod: 27, desc: 'Pico de Gallo', ings: [[9, 1]] },
        { prod: 28, desc: 'Salsa ranch', ings: [[9, 1]] },

        // Alitas
        { prod: 29, desc: 'Alitas combo 4 piezas', ings: [[3, 4], [5, 1]] },
        { prod: 30, desc: 'Alitas combo 6 piezas', ings: [[3, 6], [5, 1], [9, 1]] },
        { prod: 31, desc: 'Alitas combo 10 piezas', ings: [[3, 10], [5, 1], [9, 1]] },
        { prod: 32, desc: 'Alitas combo 12 piezas', ings: [[3, 12], [5, 2], [9, 2]] },
        { prod: 33, desc: 'Alitas combo 20 piezas', ings: [[3, 20], [5, 2], [9, 2]] },
        { prod: 34, desc: 'Alitas combo 24 piezas', ings: [[3, 24], [5, 3], [9, 3]] },
        { prod: 35, desc: 'Alitas combo 36 piezas', ings: [[3, 36], [5, 4], [9, 4]] },

        // Bebidas
        { prod: 36, desc: 'Gaseosa 12 onz', ings: [[10, 1]] },
        { prod: 37, desc: 'Gaseosa 1/2 litro', ings: [[11, 1]] },
        { prod: 38, desc: 'Gaseosa 1 litro', ings: [[12, 1]] },
        { prod: 39, desc: 'Gaseosa 2L desechable', ings: [[13, 1]] },
        { prod: 40, desc: 'Gaseosa 2L retornable', ings: [[14, 1]] },
        { prod: 41, desc: 'Jugo té hyci', ings: [[15, 1]] },
        { prod: 42, desc: 'Jugo hyci manzana', ings: [[16, 1]] },
        { prod: 43, desc: 'Agua 1 litro', ings: [[17, 1]] }
    ];

    recetasData.forEach(r => {
        db.run(`INSERT INTO recetas (id_receta, id_producto, descripcion) VALUES (?, ?, ?)`, [r.prod, r.prod, r.desc], function(err) {
            if (!err) {
                const idReceta = this.lastID;
                r.ings.forEach(([idIns, cant]) => {
                    db.run(`INSERT INTO receta_detalle (id_receta, id_insumo, cantidad) VALUES (?, ?, ?)`, [idReceta, idIns, cant]);
                });
            }
        });
    });

    // Semillas de Pedidos Delivery de Muestra
    db.run(`INSERT OR IGNORE INTO pedidos_delivery (
        id_pedido, numero_pedido, id_cliente, cliente_nombre, telefono, direccion, origen, estado, repartidor,
        notas, costo_delivery, subtotal, impuesto, total, id_metodo_pago, banco, referencia_transferencia
    ) VALUES 
    (1, 'DEL-1001', 2, 'Carlos Mendoza', '8899-7711', 'Sierra Maestra, semáforos 2c al sur', 'WHATSAPP', 'PENDIENTE', 'Carlos Mendoza (Moto 1)', 'Sin cebolla en las hamburguesas', 30.00, 240.00, 36.00, 306.00, 1, NULL, NULL),
    (2, 'DEL-1002', 3, 'Ana Sofía Morales', '8765-4321', 'Sierra Maestra, del Parque 1c abajo', 'LLAMADA', 'EN_PREPARACION', 'Maycol Rodríguez (Moto 2)', 'Agregar servilletas extra', 40.00, 470.00, 70.50, 580.50, 2, 'Banpro', '#TRF-554210'),
    (3, 'DEL-1003', 5, 'Lucía Fernández', '8912-3456', 'Sierra Maestra, contiguo a la pulpería La Bendición', 'WHATSAPP', 'LISTO', 'Carlos Mendoza (Moto 1)', 'Casa con portón negro', 30.00, 250.00, 37.50, 317.50, 1, NULL, NULL)
    `);

    // Detalle de los pedidos de muestra
    db.run(`INSERT OR IGNORE INTO pedido_delivery_detalle (id_pedido, id_producto, cantidad, precio_unitario, subtotal) VALUES 
        (1, 3, 2, 120.00, 240.00), -- 2 Hamburguesas dobles
        (2, 9, 1, 470.00, 470.00), -- 1 Combo pareja
        (3, 30, 1, 250.00, 250.00) -- 1 Combo 6 alitas
    `);

    db.run(`SELECT 1`, () => {
        console.log('--- Migración y semillero completado exitosamente con Menú Oficial y Módulo de Delivery ---');
        db.close();
    });
});
