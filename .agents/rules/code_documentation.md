# Regla de Documentación de Código - El Gustazo POS

Siempre que se agregue, modifique o refactorice código en este proyecto:
1. **Comentarios Explicativos del "Por qué"**: Cada función, middleware, endpoint, consulta SQL y bloque condicional debe incluir comentarios en español explicando no solo qué hace, sino **la razón por la cual se puso** (justificación técnica, requerimientos de negocio, seguridad, compatibilidad offline o rendimiento).
2. **Documentación Detallada Línea por Línea / Bloque por Bloque**: Explicar variables clave, transacciones atómicas, validaciones de seguridad (como regex de contraseñas, prevención de fuerza bruta, RBAC) y estructuras de retorno.
3. **Integridad de Código**: Mantener siempre la sintaxis válida y la compatibilidad estricta con Node.js y SQLite3 en entornos locales offline (Windows 8 / Sierra Maestra).
