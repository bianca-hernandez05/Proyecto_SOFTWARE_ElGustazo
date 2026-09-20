# Guía de Instalación y Despliegue Offline en Windows 8 - El Gustazo

Esta guía detalla los pasos para instalar y ejecutar el sistema de ventas **El Gustazo** en una computadora con **Windows 8** de forma **100% gratuita y sin conexión a Internet**.

---

## 1. Requisitos Previos

1. **Computadora con Windows 8 / 8.1** (también compatible con Windows 7, 10 y 11).
2. **Memoria USB (Pendrive)** para transferir los archivos.
3. **Instalador de Node.js para Windows**:
   - **Versión Recomendada para Windows 8**: **Node.js v16.20.2 LTS** (x86 o x64 según su arquitectura de Windows). Es la última versión oficial con soporte nativo directo para Windows 8.
   - Si utiliza **Node.js v18**, los lanzadores incluidos ya tienen configurada la variable `NODE_SKIP_PLATFORM_CHECK=1` para omitir la advertencia de plataforma.
4. **Navegador Web**: Google Chrome, Mozilla Firefox, Microsoft Edge o cualquier navegador moderno instalado en el equipo.
5. **Impresora Térmica de Tickets** (58mm o 80mm) conectada por USB con su controlador instalado.

---

## 2. Pasos de Instalación en la Computadora Windows 8

### Paso 1: Instalar Node.js
1. Descargue el instalador `.msi` de **Node.js v16.20.2** desde otro equipo o directamente si tiene conexión temporal:
   - 64 bits: `https://nodejs.org/dist/v16.20.2/node-v16.20.2-x64.msi`
   - 32 bits: `https://nodejs.org/dist/v16.20.2/node-v16.20.2-x86.msi`
2. Copie el archivo `.msi` a la memoria USB y conéctela a la computadora Windows 8.
3. Ejecute el instalador `.msi`, acepte los términos y complete la instalación dando clic en "Next" hasta finalizar.

### Paso 2: Copiar la Carpeta del Sistema
1. Copie la carpeta completa `ElGustazo_app` (con su carpeta `node_modules`, `src`, `database`, etc.) a la computadora Windows 8.
2. Se recomienda pegarla en una ruta cómoda, por ejemplo:
   - `C:\ElGustazo_app` o directamente en el **Escritorio**.

### Paso 3: Crear el Acceso Directo en el Escritorio
1. Abra la carpeta `ElGustazo_app`.
2. Busque el archivo **`ElGustazo_POS_Silencioso.vbs`**.
3. Haga clic derecho sobre él > **Enviar a** > **Escritorio (crear acceso directo)**.
4. En el Escritorio, puede renombrar el acceso directo a **"El Gustazo POS"** y asignarle el ícono del negocio si lo desea.

---

## 3. Modos de Ejecución Disponibles

### Modo 1: Lanzador Silencioso (Recomendado para el día a día)
- **Archivo**: `ElGustazo_POS_Silencioso.vbs`
- **Comportamiento**: Inicia el servidor de fondo de manera silenciosa (sin mostrar ninguna ventana de consola negra) y abre automáticamente el sistema en su navegador web en `http://localhost:3000`.

### Modo 2: Lanzador Estándar con Consola
- **Archivo**: `Iniciar_ElGustazo.bat`
- **Comportamiento**: Muestra una ventana de consola que confirma el estado de inicio del servidor y abre el navegador web.

### Para Cerrar el Sistema
- **Archivo**: `Detener_ElGustazo.bat`
- **Comportamiento**: Cierra de forma limpia los procesos de Node.js activos en el equipo.

---

## 4. Configuración de la Impresora Térmica de Tickets

El sistema cuenta con diseño optimizado para impresoras térmicas de rollos continuos de **58mm y 80mm**.

Al presionar el botón **"Imprimir Ticket Térmico"** (en POS o en Delivery):
1. Se abrirá la ventana de impresión del navegador.
2. **Destino / Impresora**: Seleccione su impresora térmica instalada (ej. POS-58, POS-80, Epson TM-T20, etc.).
3. **Márgenes**: Seleccione la opción **"Ninguno"** (None).
4. **Opciones adicionales**: Desmarque la casilla **"Encabezados y pies de página"** (Headers and Footers) para evitar que se impriman URLs o fechas del navegador en el papel.
5. Haga clic en **Imprimir**.

---

## 5. Respaldo de Datos y Operación Offline

- **Base de Datos Local**: Todos los datos (ventas, clientes, inventario, caja chica, pedidos) se guardan en el archivo `database/DB_ElGustado.db` con SQLite3.
- **Respaldo Rápido**: Para hacer una copia de seguridad de todas las ventas y datos del restaurante, simplemente copie el archivo `database/DB_ElGustado.db` a una memoria USB.
- **Cero Dependencia de Internet**: Ni el inicio de sesión, ni la impresión, ni la navegación requieren conexión a Internet. Todas las librerías, tipografías e imágenes (`src/public/img/`) están almacenadas localmente.
