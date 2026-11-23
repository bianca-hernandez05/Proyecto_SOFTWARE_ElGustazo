"""
=============================================================================
HERRAMIENTA DE CIBERSEGURIDAD: VERIFICADOR FORENSE DE ARCHIVOS SOSPECHOSOS
Archivo: security_tools/verify_suspicious_files.py
Empresa: El Gustazo - Sierra Maestra, Managua
Objetivo: Detectar dobles extensiones peligrosas, scripts en carpetas estaticas,
          y validar 'Magic Bytes' de firmas binarias (PNG, JPEG, PDF).
=============================================================================
"""

import os
import sys

# Firmas de cabecera binaria (Magic Bytes) estandar
MAGIC_SIGNATURES = {
    'png': [b'\x89PNG\r\n\x1a\n'],
    'jpg': [b'\xff\xd8\xff'],
    'jpeg': [b'\xff\xd8\xff'],
    'pdf': [b'%PDF-'],
    'ico': [b'\x00\x00\x01\x00']
}

EXTENSIONES_PELIGROSAS = {
    '.exe', '.bat', '.cmd', '.vbs', '.ps1', '.sh', '.php', '.asp', '.aspx', '.jsp', '.jar'
}

def verificar_firma_binaria(ruta_archivo, extension):
    ext = extension.lower().lstrip('.')
    if ext not in MAGIC_SIGNATURES:
        return True, "Extension no binaria validable por cabecera fija"

    firmas = MAGIC_SIGNATURES[ext]
    try:
        with open(ruta_archivo, 'rb') as f:
            cabecera = f.read(32)
            for f_esperada in firmas:
                if cabecera.startswith(f_esperada):
                    return True, "Firma de Magic Bytes valida"
            return False, f"Cabecera invalida (Posible camuflaje de ejecutable)"
    except Exception as e:
        return False, str(e)

def auditar_archivos_sospechosos(directorio_base):
    hallazgos = []
    print(f"[*] Analizando arbol de directorios en '{directorio_base}'...")

    for raiz, dirs, archivos in os.walk(directorio_base):
        # Descartar directorios de dependencias y git
        dirs[:] = [d for d in dirs if d not in {'.git', 'node_modules', '__pycache__', '.agents'}]
        for nombre in archivos:
            ruta = os.path.join(raiz, nombre)
            nombre_lower = nombre.lower()

            # 1. Deteccion de doble extension (ej. foto.png.exe)
            partes = nombre_lower.split('.')
            if len(partes) > 2:
                sub_ext = '.' + partes[-1]
                if sub_ext in EXTENSIONES_PELIGROSAS:
                    hallazgos.append({
                        'ruta': ruta,
                        'tipo': 'Doble Extension Peligrosa (Posible Malware)',
                        'detalle': f"Terminacion '{sub_ext}' sobre archivo secundario"
                    })

            # 2. Deteccion de scripts ejecutables en carpeta publica de imagenes
            if 'public' in raiz.lower() and ('img' in raiz.lower() or 'images' in raiz.lower()):
                _, ext = os.path.splitext(nombre_lower)
                if ext in {'.php', '.js', '.sh', '.py', '.exe', '.bat'}:
                    hallazgos.append({
                        'ruta': ruta,
                        'tipo': 'Script Peligroso en Directorio de Imagenes',
                        'detalle': f"Archivo ejecutable '{nombre}' ubicado en directorio estatico"
                    })

            # 3. Validacion de Magic Bytes en archivos multimedia
            _, ext = os.path.splitext(nombre_lower)
            ext_clean = ext.lstrip('.')
            if ext_clean in MAGIC_SIGNATURES:
                es_valido, motivo = verificar_firma_binaria(ruta, ext_clean)
                if not es_valido:
                    hallazgos.append({
                        'ruta': ruta,
                        'tipo': 'Discrepancia de Firma Binaria (Magic Bytes)',
                        'detalle': motivo
                    })

    return hallazgos

def emitir_informe_forense(hallazgos):
    print("\n" + "=" * 65)
    print("INFORME DE VERIFICACION DE ARCHIVOS SOSPECHOSOS Y MAGIC BYTES")
    print("El Gustazo - Seguridad e Integridad del Sistema")
    print("=" * 65)

    if not hallazgos:
        print("[OK] Todos los archivos verificados son legitimos y cumplen sus firmas binarias.")
        print("[OK] No se detectaron scripts intrusivos ni dobles extensiones peligrosas.")
        return

    print(f"Total de anomalias detectadas: {len(hallazgos)}\n")
    for i, h in enumerate(hallazgos, 1):
        print(f"Alerta #{i} | Tipo: {h['tipo']}")
        print(f"  Archivo: {h['ruta']}")
        print(f"  Detalle: {h['detalle']}")
        print("-" * 65)

if __name__ == '__main__':
    directorio = sys.argv[1] if len(sys.argv) > 1 else '.'
    anomalias = auditar_archivos_sospechosos(directorio)
    emitir_informe_forense(anomalias)
