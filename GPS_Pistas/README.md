# GPS Pistas

Mapa de navegación terrestre aeroportuaria con rutas alternativas, selección
exclusiva de estructuras, aeronaves en vivo mediante un puente local y soporte
de bajo consumo/sin conexión.

## Destinos permitidos

Al tocar el mapa sólo se pueden elegir polígonos cargados como estructuras:

- edificios y hangares de `zonas_interes.geojson`;
- Terminal 1 y Terminal 2;
- cárcamos.

Rodajes, vialidades, plataformas, posiciones, pistas, áreas verdes y puntos
libres permanecen visibles, pero no crean destinos. El buscador aplica la misma
regla para evitar que el historial reintroduzca lugares no permitidos.

## Hospedaje y proyectos locales

Un servidor público no puede conectarse por sí mismo a una dirección privada
como `172.16.x.x` o `localhost`. Por eso la integración usa este flujo:

1. `LectorTransponder` alimenta a `FrontMapaVuelos` dentro de la red local.
2. `bridge/radarBridge.js`, ejecutado en esa misma computadora, consulta
   `FrontMapaVuelos`.
3. El puente abre una conexión HTTPS **saliente** y publica el estado reducido
   en el host de GPS Pistas usando un token compartido.
4. El host envía solamente cambios a los navegadores que tienen visible la capa
   de aeronaves.

No se abre ningún puerto de entrada ni se publican los proyectos locales. Las
instrucciones del proceso local están en [bridge/README.md](bridge/README.md).

### Variables del host

- `PORT`: opcional; la mayoría de proveedores la define automáticamente.
- `RADAR_BRIDGE_TOKEN`: secreto largo y aleatorio, igual al configurado en el
  puente local.
- `RADAR_STALE_MS`: opcional; tiempo antes de marcar los datos como obsoletos
  (45 segundos por defecto).

El comando de inicio es:

```bash
npm ci
npm start
```

La URL pública debe usar HTTPS para que el navegador permita geolocalización y
service workers. El estado del radar se mantiene en memoria; despliega una sola
instancia del servidor. Si en el futuro se requieren varias instancias, el
almacén debe moverse a Redis u otro servicio compartido.

## Bajo consumo y funcionamiento sin internet

- El mapa base de CARTO está apagado de forma predeterminada. El mapa vectorial
  del aeropuerto y el enrutamiento no lo necesitan.
- El interruptor **Mapa base en línea** permite activarlo voluntariamente.
- Leaflet, Turf, Bootstrap, iconos y fuentes se sirven desde el mismo proyecto;
  no hay CDN obligatoria.
- El servidor comprime GeoJSON, JavaScript y CSS antes de enviarlos.
- El GPS del usuario se procesa en el dispositivo y no se envía al servidor.
- Las aeronaves usan una suscripción por eventos, se pausa con la pestaña oculta
  o la capa desactivada y guarda el último estado conocido.
- El service worker conserva la interfaz, los GeoJSON necesarios y hasta 120
  teselas consultadas voluntariamente.

Después de abrir la aplicación en línea una vez y dejar que termine de cargar,
las estructuras, la búsqueda, el GPS y las rutas continúan funcionando sin
internet. En ese estado se muestran las últimas aeronaves guardadas como datos
obsoletos; no es posible recibir posiciones nuevas sin algún enlace de red.

## Orientación tipo Maps

La posición y la orientación se calculan como datos independientes:

- el punto azul queda anclado a la coordenada GPS;
- el halo azul representa la precisión reportada por el GPS;
- el cono usa `rumbo físico del teléfono + rotación visual del mapa`;
- las aeronaves usan `track ADS-B + rotación visual del mapa` y nunca leen el
  giroscopio del usuario;
- la brújula conserva el icono original y sigue el norte con la convención
  visual de `leaflet-rotate`.

`leaflet-rotate` aplica `map.getBearing()` directamente como rotación visual de
su `rotatePane`; no usa el mismo signo que el bearing de cámara de MapLibre.
Por eso el giro manual con dos dedos no modifica el rumbo real ni se cancela
cuando el teléfono gira físicamente: ambos movimientos se suman visualmente. Los
sensores de orientación y la geolocalización requieren HTTPS en el móvil. En
iPhone/iPad, el permiso de orientación se solicita al tocar el botón de GPS o
la brújula, porque Safari exige que la solicitud provenga de un gesto.

## Desarrollo local

```bash
npm install
npm start
```

Abre `http://localhost:3001`. Para probar el radar, inicia el servidor con un
`RADAR_BRIDGE_TOKEN` y apunta el puente a esa URL.

## Pruebas

```bash
npm test
```

Las pruebas cubren la combinación rumbo/bearing, el cruce 0°/360°, el motor A*,
rutas por rodajes, selección exclusiva de estructuras, rechazo de áreas verdes,
deltas del radar, autenticación del puente, archivos locales y recursos
necesarios para el modo sin conexión.
