"""
=============================================================================
HERRAMIENTA DE CIBERSEGURIDAD Y AUDITORIA FORENSE: BUSCADOR Y LIMPIADOR DE
ARCHIVOS DUPLICADOS Y RESPALDOS ANTIGUOS
Archivo: security_tools/find_duplicates.py
Empresa: El Gustazo - Sierra Maestra, Managua
Objetivo: Detectar y eliminar archivos duplicados por tamano y hash SHA-256,
          asi como depurar respaldos antiguos (.db) que lleven tiempo en disco
          para prevenir fugas de informacion y saturacion de almacenamiento.
=============================================================================
"""

import os
import sys
import time
import hashlib
from datetime import datetime
from collections import defaultdict

ARCHIVOS_PROTEGIDOS = {
    os.path.normcase(os.path.abspath(os.path.join('database', 'DB_ElGustazo.db'))),
    os.path.normcase(os.path.abspath(os.path.join('database', 'DB_ElGustado.db')))
}

def calcular_hash_sha256(ruta_archivo, tamano_bloque=65536):
    """Calcula el hash criptografico SHA-256 en bloques de memoria para archivos grandes."""
    sha256 = hashlib.sha256()
    try:
        with open(ruta_archivo, 'rb') as f:
            while True:
                datos = f.read(tamano_bloque)
                if not datos:
                    break
                sha256.update(datos)
        return sha256.hexdigest()
    except (PermissionError, FileNotFoundError, OSError):
        return None

def depurar_respaldos_antiguos(directorio_backups='database/backups', max_dias=1, dejar_max=1):
    """
    Elimina respaldos (.db) que lleven mas de max_dias de antiguedad o que excedan
    el limite dejar_max, conservando unicamente el respaldo mas reciente y valido.
    """
    eliminados = []
    if not os.path.exists(directorio_backups):
        return eliminados

    ahora = time.time()
    limite_segundos = max_dias * 86400
    archivos_db = []

    for nombre in os.listdir(directorio_backups):
        if not nombre.lower().endswith('.db'):
            continue
        ruta = os.path.join(directorio_backups, nombre)
        if not os.path.isfile(ruta):
            continue
        try:
            mtime = os.path.getmtime(ruta)
            tamano = os.path.getsize(ruta)
            archivos_db.append({'nombre': nombre, 'ruta': ruta, 'mtime': mtime, 'tamano': tamano})
        except OSError:
            continue

    # Ordenar del mas reciente al mas antiguo
    archivos_db.sort(key=lambda x: x['mtime'], reverse=True)

    for idx, info in enumerate(archivos_db):
        edad_segundos = ahora - info['mtime']
        edad_dias = edad_segundos / 86400.0
        # Eliminar si supera el maximo permitido o si lleva mas de max_dias y hay al menos 1 respaldo
        if idx >= dejar_max or (edad_segundos > limite_segundos and len(archivos_db) > 0):
            try:
                os.remove(info['ruta'])
                eliminados.append({
                    'archivo': info['nombre'],
                    'ruta': os.path.abspath(info['ruta']),
                    'tamano_kb': round(info['tamano'] / 1024.0, 2),
                    'edad_dias': round(edad_dias, 1),
                    'motivo': f"Respaldo antiguo ({round(edad_dias, 1)} dias) / excedente de retencion"
                })
            except OSError:
                pass

    return eliminados

def buscar_y_limpiar_archivos_duplicados(directorio_base='.', eliminar_duplicados=True, ignorar_directorios=None):
    """
    Algoritmo en 2 fases para detectar colisiones SHA-256 y eliminar copias redundantes
    en carpetas de respaldos o temporales, protegiendo siempre la base de datos activa.
    """
    if ignorar_directorios is None:
        ignorar_directorios = {'.git', 'node_modules', '__pycache__', '.agents'}

    archivos_por_tamano = defaultdict(list)

    print(f"[*] Fase 1: Escaneando estructura de directorios en '{directorio_base}'...")
    for raiz, dirs, archivos in os.walk(directorio_base):
        dirs[:] = [d for d in dirs if d not in ignorar_directorios]
        for nombre in archivos:
            ruta_completa = os.path.join(raiz, nombre)
            try:
                tamano = os.path.getsize(ruta_completa)
                if tamano > 0:
                    archivos_por_tamano[tamano].append(ruta_completa)
            except (OSError, PermissionError):
                continue

    candidatos_duplicados = {t: rutas for t, rutas in archivos_por_tamano.items() if len(rutas) > 1}
    print(f"[+] Archivos analizados. Grupos de tamano coincidente: {len(candidatos_duplicados)}")

    print("[*] Fase 2: Calculando hashes SHA-256 para confirmar colisiones binarias...")
    archivos_por_hash = defaultdict(list)
    for tamano, rutas in candidatos_duplicados.items():
        for ruta in rutas:
            h = calcular_hash_sha256(ruta)
            if h:
                archivos_por_hash[h].append(ruta)

    duplicados_detectados = {h: rutas for h, rutas in archivos_por_hash.items() if len(rutas) > 1}
    duplicados_eliminados = []
    duplicados_restantes = {}

    if eliminar_duplicados and duplicados_detectados:
        for h, rutas in duplicados_detectados.items():
            # Priorizar conservar el archivo principal protegido (ej. DB_ElGustazo.db) o el de ruta mas corta/principal
            rutas_ordenadas = sorted(
                rutas,
                key=lambda r: (
                    0 if os.path.normcase(os.path.abspath(r)) in ARCHIVOS_PROTEGIDOS else 1,
                    1 if ('backups' in r.lower() or 'scratch' in r.lower() or 'temp' in r.lower()) else 0,
                    -os.path.getmtime(r) if os.path.exists(r) else 0
                )
            )
            archivo_original = rutas_ordenadas[0]
            copias = rutas_ordenadas[1:]
            conservados = [archivo_original]
            backup_unico_conservado = False

            for copia in copias:
                abs_copia = os.path.normcase(os.path.abspath(copia))
                es_en_backups = 'backups' in abs_copia and copia.lower().endswith('.db')
                # Conservar 1 respaldo vigente del dia en database/backups aunque tenga el mismo hash que DB_ElGustazo.db
                if es_en_backups and not backup_unico_conservado and os.path.normcase(os.path.abspath(archivo_original)) in ARCHIVOS_PROTEGIDOS:
                    backup_unico_conservado = True
                    continue

                es_eliminable = (
                    abs_copia not in ARCHIVOS_PROTEGIDOS and
                    ('backups' in abs_copia or 'scratch' in abs_copia or copia.lower().endswith('.bak') or copia.lower().endswith('.tmp') or copia.lower().endswith('.db'))
                )
                if es_eliminable:
                    try:
                        tam = os.path.getsize(copia)
                        os.remove(copia)
                        duplicados_eliminados.append({
                            'ruta': os.path.abspath(copia),
                            'original': os.path.abspath(archivo_original),
                            'sha256': h,
                            'tamano_kb': round(tam / 1024.0, 2)
                        })
                    except OSError:
                        conservados.append(copia)
                else:
                    conservados.append(copia)

            if len(conservados) > 1:
                duplicados_restantes[h] = conservados
    else:
        duplicados_restantes = duplicados_detectados

    return duplicados_restantes, duplicados_eliminados

def generar_reporte_duplicados(duplicados_restantes, duplicados_eliminados, backups_antiguos_eliminados):
    """Muestra el diagnostico forense y resultado de limpieza en formato formal sin emojis."""
    print("\n" + "=" * 65)
    print("INFORME DE LIMPIEZA DE RESPALDOS ANTIGUOS Y ARCHIVOS DUPLICADOS")
    print("El Gustazo - Seguridad e Integridad del Almacenamiento")
    print("=" * 65)

    if backups_antiguos_eliminados:
        print(f"[LIMPIEZA] Respaldos antiguos eliminados automaticamente: {len(backups_antiguos_eliminados)}")
        for b in backups_antiguos_eliminados:
            print(f"  - Eliminado: {b['archivo']} ({b['tamano_kb']} KB | {b['motivo']})")
        print("-" * 65)
    else:
        print("[OK] No se encontraron respaldos vencidos pendientes de purga.")

    if duplicados_eliminados:
        print(f"[LIMPIEZA] Archivos duplicados eliminados por colision SHA-256: {len(duplicados_eliminados)}")
        for d in duplicados_eliminados:
            print(f"  - Eliminado duplicado: {d['ruta']} ({d['tamano_kb']} KB)")
            print(f"    Conservado original: {d['original']}")
        print("-" * 65)

    if not duplicados_restantes:
        print("[OK] Almacenamiento optimizado: 0 archivos duplicados activos en el sistema.")
        return

    total_grupos = len(duplicados_restantes)
    total_archivos = sum(len(rutas) for rutas in duplicados_restantes.values())
    print(f"Total de grupos redundantes restantes: {total_grupos} ({total_archivos} archivos)\n")

    for i, (h, rutas) in enumerate(duplicados_restantes.items(), 1):
        tamano_bytes = os.path.getsize(rutas[0]) if os.path.exists(rutas[0]) else 0
        tamano_kb = tamano_bytes / 1024.0
        print(f"Grupo {i} | SHA-256: {h}")
        print(f"Tamano por archivo: {tamano_kb:.2f} KB ({tamano_bytes} bytes)")
        for r in rutas:
            print(f"  - {os.path.abspath(r)}")
        print("-" * 65)

if __name__ == '__main__':
    directorio = sys.argv[1] if len(sys.argv) > 1 else '.'
    # 1. Purgar respaldos antiguos que lleven tiempo
    backups_purgados = depurar_respaldos_antiguos(os.path.join('database', 'backups'), max_dias=1, dejar_max=1)
    # 2. Detectar y eliminar archivos duplicados por SHA-256
    restantes, eliminados = buscar_y_limpiar_archivos_duplicados(directorio, eliminar_duplicados=True)
    # 3. Asegurar que exista al menos 1 respaldo del dia actual si la carpeta de backups quedo vacia
    backups_dir = os.path.join('database', 'backups')
    db_principal = os.path.join('database', 'DB_ElGustazo.db')
    if os.path.exists(db_principal) and os.path.exists(backups_dir):
        archivos_actuales = [f for f in os.listdir(backups_dir) if f.endswith('.db')]
        if len(archivos_actuales) == 0:
            import shutil
            hoy_str = datetime.now().strftime('%Y-%m-%d')
            nuevo_resp = os.path.join(backups_dir, f'backup_diario_{hoy_str}.db')
            try:
                shutil.copyfile(db_principal, nuevo_resp)
                print(f"[+] Respaldo vigente del dia asegurado: backup_diario_{hoy_str}.db")
            except OSError:
                pass
    generar_reporte_duplicados(restantes, eliminados, backups_purgados)

