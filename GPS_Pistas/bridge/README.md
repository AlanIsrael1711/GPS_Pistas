# Puente local del radar

Este proceso se ejecuta en la computadora que puede abrir `FrontMapaVuelos`.
Realiza conexiones **salientes** al host de GPS Pistas; no requiere abrir puertos
ni publicar los proyectos locales.

Requiere Node.js 18 o posterior. Configura en el host y en la computadora local
el mismo secreto largo y aleatorio como `RADAR_BRIDGE_TOKEN`.

PowerShell:

```powershell
$env:LOCAL_RADAR_API_URL='http://127.0.0.1:4001/api/vuelos-live'
$env:GPS_PISTAS_HOST_URL='https://tu-dominio.example'
$env:RADAR_BRIDGE_TOKEN='cambia-esto-por-un-secreto-largo'
node .\bridge\radarBridge.js
```

Bash:

```bash
LOCAL_RADAR_API_URL=http://127.0.0.1:4001/api/vuelos-live \
GPS_PISTAS_HOST_URL=https://tu-dominio.example \
RADAR_BRIDGE_TOKEN='cambia-esto-por-un-secreto-largo' \
node bridge/radarBridge.js
```

El puente consulta localmente cada cinco segundos, pero sólo sube información
cuando cambia. Cada treinta segundos manda un latido para recuperar el estado
si el host se reinició.
