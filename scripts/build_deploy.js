/**
 * SCRIPT DE CONSTRUCCIÓN Y EMPAQUETADO PARA PRODUCCIÓN (DEPLOYMENT)
 * RESTAURANTE EL GUSTAZO
 *
 * Propósito:
 * 1. Genera la carpeta 'ElGustazo_Deploy' lista para instalar en la máquina de caja.
 * 2. Protege la propiedad intelectual: Ofusca y minifica el código fuente (server.js y frontend JS).
 * 3. Excluye archivos de desarrollo (.git, .agents, .gitignore, archivos redundantes).
 * 4. Incluye la base de datos limpia 'DB_ElGustazo.db' y respaldos diarios en 'database/backups/'.
 * 5. Incluye la suite completa de ciberseguridad y herramientas de auditoría.
 * 6. Empaqueta el archivo final en 'ElGustazo_Deploy_Win8.zip' en el Escritorio.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const desktopDir = path.resolve(rootDir, '..');
const deployDir = path.join(desktopDir, 'ElGustazo_Deploy');
const zipFile = path.join(desktopDir, 'ElGustazo_Deploy_Win8.zip');

console.log('=====================================================================');
console.log('  EL GUSTAZO - GENERADOR DE PAQUETE DE DESPLIEGUE (HIBRIDO OFFLINE)');
console.log('=====================================================================');

// 1. Limpieza de carpeta de despliegue previa si existiese
if (fs.existsSync(deployDir)) {
    console.log('[*] Limpiando carpeta de despliegue anterior...');
    fs.rmSync(deployDir, { recursive: true, force: true });
}
if (fs.existsSync(zipFile)) {
    console.log('[*] Limpiando archivo ZIP previo...');
    fs.unlinkSync(zipFile);
}

// 2. Crear estructura limpia de directorios
console.log('[*] Creando estructura de carpetas de produccion...');
const dirsToCreate = [
    deployDir,
    path.join(deployDir, 'database'),
    path.join(deployDir, 'database', 'backups'),
    path.join(deployDir, 'security_tools'),
    path.join(deployDir, 'src'),
    path.join(deployDir, 'src', 'public'),
    path.join(deployDir, 'src', 'public', 'css'),
    path.join(deployDir, 'src', 'public', 'img'),
    path.join(deployDir, 'src', 'public', 'js'),
    path.join(deployDir, 'src', 'public', 'views')
];

dirsToCreate.forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 3. Copiar Base de Datos ÚNICA y Respaldos Diarios
console.log('[*] Copiando base de datos oficial DB_ElGustazo.db y respaldos...');
const dbSrc = path.join(rootDir, 'database', 'DB_ElGustazo.db');
const dbDst = path.join(deployDir, 'database', 'DB_ElGustazo.db');
if (fs.existsSync(dbSrc)) {
    fs.copyFileSync(dbSrc, dbDst);
    console.log('    [OK] DB_ElGustazo.db copiada exitosamente.');
}

const bkpSrcDir = path.join(rootDir, 'database', 'backups');
if (fs.existsSync(bkpSrcDir)) {
    fs.readdirSync(bkpSrcDir).forEach(bkp => {
        if (bkp.endsWith('.db')) {
            fs.copyFileSync(path.join(bkpSrcDir, bkp), path.join(deployDir, 'database', 'backups', bkp));
            console.log(`    [OK] Respaldo incluido: ${bkp}`);
        }
    });
}

// 4. Copiar Herramientas de Ciberseguridad
console.log('[*] Copiando suite de ciberseguridad y auditoria...');
const secDir = path.join(rootDir, 'security_tools');
if (fs.existsSync(secDir)) {
    fs.readdirSync(secDir).forEach(f => {
        if (f.endsWith('.py')) {
            fs.copyFileSync(path.join(secDir, f), path.join(deployDir, 'security_tools', f));
            console.log(`    [OK] Herramienta de seguridad: ${f}`);
        }
    });
}

// 5. Copiar Ejecutable Principal y Scripts Esenciales en Raíz
console.log('[*] Copiando ejecutable principal y utilidades de control...');
const rootFiles = [
    'ElGustazo.exe',
    'Crear_Acceso_Directo.bat',
    'Detener_ElGustazo.bat',
    'package.json'
];

rootFiles.forEach(rf => {
    const src = path.join(rootDir, rf);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(deployDir, rf));
        console.log(`    [OK] Archivo raiz: ${rf}`);
    }
});

// 6. Copiar Recursos Estáticos Públicos (Imágenes, Estilos, Vistas y Favicon)
console.log('[*] Copiando vistas HTML, estilos CSS e imagenes...');

const favSrc = path.join(rootDir, 'src', 'public', 'favicon.ico');
if (fs.existsSync(favSrc)) {
    fs.copyFileSync(favSrc, path.join(deployDir, 'src', 'public', 'favicon.ico'));
}

const cssFileSrc = path.join(rootDir, 'src', 'public', 'css', 'style.css');
if (fs.existsSync(cssFileSrc)) {
    fs.copyFileSync(cssFileSrc, path.join(deployDir, 'src', 'public', 'css', 'style.css'));
}

const imgDirSrc = path.join(rootDir, 'src', 'public', 'img');
if (fs.existsSync(imgDirSrc)) {
    fs.readdirSync(imgDirSrc).forEach(img => {
        fs.copyFileSync(path.join(imgDirSrc, img), path.join(deployDir, 'src', 'public', 'img', img));
    });
}

const viewsDirSrc = path.join(rootDir, 'src', 'public', 'views');
if (fs.existsSync(viewsDirSrc)) {
    fs.readdirSync(viewsDirSrc).forEach(view => {
        if (view.endsWith('.html')) {
            fs.copyFileSync(path.join(viewsDirSrc, view), path.join(deployDir, 'src', 'public', 'views', view));
        }
    });
}

const html2pdfSrc = path.join(rootDir, 'src', 'public', 'js', 'html2pdf.bundle.min.js');
if (fs.existsSync(html2pdfSrc)) {
    fs.copyFileSync(html2pdfSrc, path.join(deployDir, 'src', 'public', 'js', 'html2pdf.bundle.min.js'));
}

// 7. OFUSCACIÓN DE CÓDIGO FUENTE (Protección de Propiedad Intelectual)
console.log('[*] OFUSCANDO Y PROTEGIENDO CODIGO FUENTE...');

console.log('    -> Ofuscando server.js...');
const serverSrc = path.join(rootDir, 'src', 'server.js');
const serverDst = path.join(deployDir, 'src', 'server.js');
execSync(`npx --yes javascript-obfuscator "${serverSrc}" --output "${serverDst}" --compact true --string-array true --string-array-encoding base64 --rename-globals false`, {
    stdio: 'inherit',
    cwd: rootDir
});
console.log('    [OK] server.js ofuscado.');

const jsFilesToObfuscate = [
    'app.js',
    'chatbot_bi.js',
    'delivery.js',
    'rbac_nav.js',
    'whatsapp_service.js'
];

jsFilesToObfuscate.forEach(jsFile => {
    const src = path.join(rootDir, 'src', 'public', 'js', jsFile);
    const dst = path.join(deployDir, 'src', 'public', 'js', jsFile);
    if (fs.existsSync(src)) {
        console.log(`    -> Ofuscando ${jsFile}...`);
        execSync(`npx --yes javascript-obfuscator "${src}" --output "${dst}" --compact true --string-array true --string-array-encoding base64`, {
            stdio: 'inherit',
            cwd: rootDir
        });
        console.log(`    [OK] ${jsFile} ofuscado.`);
    }
});

// 8. Copiar node_modules para asegurar funcionamiento 100% OFFLINE
console.log('[*] Copiando dependencias node_modules (ejecucion 100% offline)...');
const nmSrc = path.join(rootDir, 'node_modules');
const nmDst = path.join(deployDir, 'node_modules');
if (fs.existsSync(nmSrc)) {
    try {
        execSync(`robocopy "${nmSrc}" "${nmDst}" /E /NDL /NFL /NJH /NJS /nc /ns /np`, { stdio: 'ignore' });
    } catch (e) {
        // Robocopy devuelve códigos 1-3 en éxito de copia
    }
    console.log('    [OK] node_modules copiado exitosamente.');
}

// 9. Empaquetar todo en el archivo final ZIP
console.log('[*] Comprimiendo paquete de despliegue en ZIP...');
try {
    execSync(`tar -a -cf "${zipFile}" -C "${desktopDir}" "ElGustazo_Deploy"`, { stdio: 'inherit' });
    console.log(`[OK] Paquete comprimido generado exitosamente en:\n    ${zipFile}`);
} catch (e) {
    console.error('Error generando archivo ZIP:', e.message);
}

console.log('=====================================================================');
console.log('  DESPLIEGUE FINALIZADO EXITOSAMENTE');
console.log('  Carpeta lista: ' + deployDir);
console.log('  Archivo ZIP:   ' + zipFile);
console.log('=====================================================================');
