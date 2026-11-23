"""
=============================================================================
HERRAMIENTA DE CIBERSEGURIDAD: DETECCION DE FUERZA BRUTA Y PASSWORD SPRAYING
Archivo: security_tools/detect_bruteforce.py
Empresa: El Gustazo - Sierra Maestra, Managua
Objetivo: Analizar registros de acceso mediante una ventana de tiempo deslizante
          (sliding window) para identificar ataques automatizados de adivinacion.
=============================================================================
"""

import sys
from datetime import datetime, timedelta
from collections import defaultdict

class DetectorFuerzaBruta:
    def __init__(self, ventana_segundos=120, umbral_fallos_usuario=3, umbral_fallos_ip=5):
        self.ventana = timedelta(seconds=ventana_segundos)
        self.umbral_usuario = umbral_fallos_usuario
        self.umbral_ip = umbral_fallos_ip
        self.historial_usuario = defaultdict(list)
        self.historial_ip = defaultdict(list)
        self.incidentes = []

    def registrar_intento(self, timestamp, ip, usuario, exitoso):
        usuario = usuario.strip().lower()
        ip = ip.strip()
        self.historial_usuario[usuario].append((timestamp, ip, exitoso))
        self.historial_ip[ip].append((timestamp, usuario, exitoso))

        if not exitoso:
            self._evaluar_usuario(usuario, timestamp)
            self._evaluar_ip(ip, timestamp)

    def _evaluar_usuario(self, usuario, timestamp):
        eventos = self.historial_usuario[usuario]
        limite = timestamp - self.ventana
        fallos = [e for e in eventos if e[0] >= limite and not e[2]]
        if len(fallos) >= self.umbral_usuario:
            ips = sorted(list(set(e[1] for e in fallos)))
            self.incidentes.append({
                'tipo': 'Ataque de Fuerza Bruta Dirigido',
                'objetivo': f"Usuario '{usuario}'",
                'fallos': len(fallos),
                'ips_involucradas': ips,
                'hora_deteccion': timestamp
            })

    def _evaluar_ip(self, ip, timestamp):
        eventos = self.historial_ip[ip]
        limite = timestamp - self.ventana
        fallos = [e for e in eventos if e[0] >= limite and not e[2]]
        usuarios = set(e[1] for e in fallos)
        if len(usuarios) >= self.umbral_ip:
            self.incidentes.append({
                'tipo': 'Ataque de Password Spraying (Multiples Usuarios)',
                'objetivo': f"Direccion IP '{ip}'",
                'fallos': len(fallos),
                'usuarios_afectados': sorted(list(usuarios)),
                'hora_deteccion': timestamp
            })

    def emitir_informe(self):
        print("\n" + "=" * 65)
        print("INFORME DE AUDITORIA: DETECCION DE FUERZA BRUTA Y ACCESOS ILICITOS")
        print("El Gustazo - Monitoreo de Seguridad de Autenticacion")
        print("=" * 65)

        if not self.incidentes:
            print("[OK] No se detectaron patrones anómalos o de fuerza bruta en los registros.")
            return

        print(f"Total de incidentes criticos registrados: {len(self.incidentes)}\n")
        for i, inc in enumerate(self.incidentes, 1):
            print(f"Alerta #{i} | Tipo: {inc['tipo']}")
            print(f"  Objetivo: {inc['objetivo']}")
            print(f"  Intentos Fallidos en Ventana de Tiempo: {inc['fallos']}")
            if 'ips_involucradas' in inc:
                print(f"  Direcciones IP Origen: {', '.join(inc['ips_involucradas'])}")
            if 'usuarios_afectados' in inc:
                print(f"  Usuarios Afectados: {', '.join(inc['usuarios_afectados'])}")
            print(f"  Marca Temporal: {inc['hora_deteccion'].strftime('%Y-%m-%d %H:%M:%S')}")
            print("-" * 65)

def ejecutar_auditoria_simulada():
    detector = DetectorFuerzaBruta(ventana_segundos=120, umbral_fallos_usuario=3, umbral_fallos_ip=4)
    base = datetime.now()

    # Simulacion de patrones de ataque
    detector.registrar_intento(base + timedelta(seconds=10), "192.168.1.105", "admin", False)
    detector.registrar_intento(base + timedelta(seconds=25), "192.168.1.105", "admin", False)
    detector.registrar_intento(base + timedelta(seconds=40), "192.168.1.105", "admin", False)
    detector.registrar_intento(base + timedelta(seconds=55), "192.168.1.105", "admin", True)

    detector.registrar_intento(base + timedelta(seconds=60), "192.168.1.200", "cajero", False)
    detector.registrar_intento(base + timedelta(seconds=65), "192.168.1.200", "gerente", False)
    detector.registrar_intento(base + timedelta(seconds=70), "192.168.1.200", "supervisor", False)
    detector.registrar_intento(base + timedelta(seconds=75), "192.168.1.200", "administrador", False)

    detector.emitir_informe()

if __name__ == '__main__':
    ejecutar_auditoria_simulada()
