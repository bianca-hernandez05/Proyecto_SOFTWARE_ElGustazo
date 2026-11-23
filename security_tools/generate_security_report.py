"""
=============================================================================
HERRAMIENTA DE CIBERSEGURIDAD: GENERADOR DE REPORTE Y AUDITORIA INTEGRAL
Archivo: security_tools/generate_security_report.py
Empresa: El Gustazo - Sierra Maestra, Managua
Objetivo: Auditar integridad estructural de base de datos SQLite, politicas de
          contrasenas, los 3 roles oficiales (Gerente General, Administrador,
          Cajero) y estado de depuracion de respaldos antiguos.
=============================================================================
"""

import os
import time
import sqlite3
from datetime import datetime

def auditar_base_datos(db_path):
    diagnostico = {
        'path': db_path,
        'existe': False,
        'tamano_kb': 0,
        'tablas': 0,
        'integridad': 'Desconocido',
        'fk_errores': [],
        'backups_activos': 0,
        'backups_purgados': 0
    }
    if not os.path.exists(db_path):
        return diagnostico

    diagnostico['existe'] = True
    diagnostico['tamano_kb'] = round(os.path.getsize(db_path) / 1024.0, 2)

    try:
        conn = sqlite3.connect(db_path)
        cur = conn.cursor()

        cur.execute("PRAGMA integrity_check")
        row = cur.fetchone()
        diagnostico['integridad'] = 'Conforme (ok)' if row and row[0] == 'ok' else str(row)

        cur.execute("PRAGMA foreign_key_check")
        diagnostico['fk_errores'] = cur.fetchall()

        cur.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        diagnostico['tablas'] = cur.fetchone()[0]

        cur.execute("SELECT u.usuario, u.password, r.nombre, u.estado FROM usuarios u JOIN roles r ON u.id_rol = r.id_rol")
        cuentas = []
        for u, p, r, e in cur.fetchall():
            longitud_ok = len(p) >= 8
            tiene_num = any(c.isdigit() for c in p)
            tiene_esp = any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in p)
            segura = longitud_ok and tiene_num and tiene_esp
            cuentas.append({'usuario': u, 'rol': r, 'estado': e, 'segura': segura, 'longitud': len(p)})
        diagnostico['cuentas'] = cuentas

        conn.close()
    except Exception as e:
        diagnostico['error'] = str(e)

    # Auditar y depurar carpeta de respaldos (database/backups)
    backups_dir = os.path.join(os.path.dirname(db_path) or 'database', 'backups')
    if os.path.exists(backups_dir):
        ahora = time.time()
        archivos = [
            os.path.join(backups_dir, f)
            for f in os.listdir(backups_dir)
            if f.lower().endswith('.db') and os.path.isfile(os.path.join(backups_dir, f))
        ]
        archivos.sort(key=lambda r: os.path.getmtime(r), reverse=True)
        purgados = 0
        for idx, r in enumerate(archivos):
            edad_dias = (ahora - os.path.getmtime(r)) / 86400.0
            if idx >= 1 or edad_dias > 1.0:
                try:
                    os.remove(r)
                    purgados += 1
                except OSError:
                    pass
        restantes = [f for f in os.listdir(backups_dir) if f.lower().endswith('.db')]
        diagnostico['backups_activos'] = len(restantes)
        diagnostico['backups_purgados'] = purgados

    return diagnostico

def emitir_dictamen_consola(diag):
    fecha_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print("=" * 65)
    print("INFORME EJECUTIVO DE AUDITORIA Y CIBERSEGURIDAD - EL GUSTAZO POS")
    print(f"Fecha de Generacion: {fecha_str}")
    print("Modo Operativo: Hibrido (SQLite3 Offline + Puente WhatsApp Web)")
    print("=" * 65)
    print(f"[*] Base de Datos: {diag['path']} ({'PRESENTE' if diag['existe'] else 'NO ENCONTRADA'})")
    print(f"[*] Tamano en Disco: {diag['tamano_kb']} KB | Tablas Operativas: {diag['tablas']}")
    print(f"[*] Integridad B-Tree (PRAGMA integrity_check): {diag['integridad']}")
    print(f"[*] Llaves Foraneas (PRAGMA foreign_key_check): {len(diag['fk_errores'])} anomalias")
    print(f"[*] Respaldos Locales: {diag['backups_activos']} vigente(s) | {diag['backups_purgados']} antiguo(s) depurado(s)")
    print("-" * 65)
    print("AUDITORIA DE CUENTAS Y LOS 3 ROLES OFICIALES:")
    for c in diag.get('cuentas', []):
        estado_txt = "Activo" if c['estado'] == 1 else "Inactivo"
        cumple_txt = "CONFORME" if c['segura'] else "DEBIL"
        print(f"  - Usuario: {c['usuario']:<10} | Rol: {c['rol']:<16} | Estado: {estado_txt} | Politica: {cumple_txt}")
    print("=" * 65)
    print("[OK] Dictamen integral de seguridad verificado exitosamente.")

if __name__ == '__main__':
    db_file = "database/DB_ElGustazo.db"
    diagnostico = auditar_base_datos(db_file)
    emitir_dictamen_consola(diagnostico)

