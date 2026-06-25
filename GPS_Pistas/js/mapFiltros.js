// =======================================================
// mapFiltros.js - Control de Interfaz, Buscador y Filtros
// =======================================================

const styleSeguridad = document.createElement('style');
styleSeguridad.innerHTML = `
    #map.ocultar-etiquetas-edificios .tipo-edificio { display: none !important; opacity: 0 !important; visibility: hidden !important; }
    #map.ocultar-etiquetas-pistas .tipo-pista { display: none !important; opacity: 0 !important; visibility: hidden !important; }
    /* Capa de seguridad para ocultar señalizaciones */
    #map.ocultar-senalizaciones .tipo-senalizacion { display: none !important; opacity: 0 !important; visibility: hidden !important; }
`;
document.head.appendChild(styleSeguridad);

document.addEventListener('DOMContentLoaded', () => {
    const mapContainer = document.getElementById('map');

    /* ==========================================================================
       1. FILTROS DE VISIBILIDAD DE ETIQUETAS Y SEÑALES
       ========================================================================== */
    const chkEtiquetasEdificios = document.getElementById('chkEtiquetasEdificios');
    const chkEtiquetasPistas = document.getElementById('chkEtiquetasPistas');
    const chkSenalizaciones = document.getElementById('chkSenalizaciones');

    if (chkEtiquetasEdificios && mapContainer) {
        chkEtiquetasEdificios.addEventListener('change', function(e) {
            if (e.target.checked) mapContainer.classList.remove('ocultar-etiquetas-edificios');
            else mapContainer.classList.add('ocultar-etiquetas-edificios');
        });
    }

    if (chkEtiquetasPistas && mapContainer) {
        chkEtiquetasPistas.addEventListener('change', function(e) {
            if (e.target.checked) mapContainer.classList.remove('ocultar-etiquetas-pistas');
            else mapContainer.classList.add('ocultar-etiquetas-pistas');
        });
    }

    if (chkSenalizaciones && mapContainer) {
        chkSenalizaciones.addEventListener('change', function(e) {
            if (e.target.checked) mapContainer.classList.remove('ocultar-senalizaciones');
            else mapContainer.classList.add('ocultar-senalizaciones');
        });
    }

    /* ==========================================================================
       2. LÓGICA DEL BUSCADOR PREDICTIVO Y MÁQUINA DE ESTADO
       ========================================================================== */
    const inputBuscador = document.getElementById('buscadorMapa');
    const listaResultados = document.getElementById('resultadosBusqueda');
    const btnLimpiar = document.getElementById('btnLimpiarBusqueda');
    const searchBackdrop = document.getElementById('searchBackdrop');
    const btnCerrarBuscador = document.getElementById('btnCerrarBuscador');

    if (inputBuscador && listaResultados) {
        let isSearchOpen = false;

        function abrirBuscadorUI() {
            if (isSearchOpen) return;
            isSearchOpen = true;
            searchBackdrop.classList.remove('d-none');
            if (btnCerrarBuscador) btnCerrarBuscador.classList.remove('d-none');
            history.pushState({ searchOpen: true }, '');
        }

        function cerrarBuscadorUI(fromPopState = false) {
            if (!isSearchOpen) return;
            isSearchOpen = false;
            
            searchBackdrop.classList.add('d-none');
            if (btnCerrarBuscador) btnCerrarBuscador.classList.add('d-none');
            listaResultados.classList.add('d-none');
            
            inputBuscador.blur(); 
            
            if (!fromPopState) {
                history.back(); 
            }
        }

        window.addEventListener('popstate', (e) => {
            if (isSearchOpen) cerrarBuscadorUI(true); 
        });

        if (searchBackdrop) searchBackdrop.addEventListener('click', () => { cerrarBuscadorUI(); });
        if (btnCerrarBuscador) btnCerrarBuscador.addEventListener('click', () => { cerrarBuscadorUI(); });

        function obtenerHistorial() {
            return JSON.parse(localStorage.getItem('historialGPS_Aeropuerto')) || [];
        }

        function agregarAlHistorial(nombre, lat, lng, feature) {
            let historial = obtenerHistorial();
            historial = historial.filter(item => item.nombre !== nombre);
            historial.unshift({ nombre, lat, lng, feature });
            if (historial.length > 5) historial.pop();
            localStorage.setItem('historialGPS_Aeropuerto', JSON.stringify(historial));
        }

        function mostrarHistorial() {
            const historial = obtenerHistorial();
            listaResultados.innerHTML = '';
            
            if (historial.length === 0) {
                listaResultados.classList.add('d-none');
                return;
            }

            listaResultados.innerHTML = '<li class="p-2 text-muted small fw-bold bg-light border-bottom">Búsquedas recientes</li>';
            
            historial.forEach(item => {
                const li = document.createElement('li');
                li.className = 'list-group-item list-group-item-action resultado-item fw-bold text-dark d-flex align-items-center';
                li.innerHTML = `<i class="bi bi-clock-history me-2 text-muted"></i> ${item.nombre}`;
                li.style.cursor = 'pointer';
                li.addEventListener('click', () => seleccionarResultado(item));
                listaResultados.appendChild(li);
            });
            
            listaResultados.classList.remove('d-none');
        }

        function seleccionarResultado(lugar) {
            cerrarBuscadorUI(); 
            inputBuscador.value = lugar.nombre; 
            if (btnLimpiar) btnLimpiar.classList.remove('d-none');

            agregarAlHistorial(lugar.nombre, lugar.lat, lugar.lng, lugar.feature);

            if (window.map) {
                window.map.flyTo([lugar.lat, lugar.lng], 18, { animate: true, duration: 1.5 });
            }

            // [SOLUCIÓN HISTORIAL] Forza el permiso temporal para evitar rechazos
            window.zonaPermitidaTemporal = lugar.feature || true;
            
            if (typeof window.irHacia === 'function') {
                window.irHacia(lugar.lat, lugar.lng, lugar.nombre);
            }
        }

        inputBuscador.addEventListener('focus', () => {
            abrirBuscadorUI();
            if (inputBuscador.value.trim() === '') mostrarHistorial();
        });

        inputBuscador.addEventListener('input', function() {
            const texto = this.value.toLowerCase().trim();
            listaResultados.innerHTML = '';
            
            if (texto.length > 0) {
                if (btnLimpiar) btnLimpiar.classList.remove('d-none');
            } else {
                if (btnLimpiar) btnLimpiar.classList.add('d-none');
                mostrarHistorial();
                return;
            }

            if (texto.length < 2) {
                listaResultados.classList.add('d-none');
                return;
            }

            const directorio = window.directorioLugares || [];
            
            const coincidencias = directorio.filter(lugar => 
                lugar && lugar.nombre && lugar.nombre.toLowerCase().includes(texto)
            ).slice(0, 5); 

            if (coincidencias.length > 0) {
                listaResultados.innerHTML = '<li class="p-2 text-muted small fw-bold bg-light border-bottom">Resultados</li>';
                listaResultados.classList.remove('d-none');
                
                coincidencias.forEach(lugar => {
                    const li = document.createElement('li');
                    li.className = 'list-group-item list-group-item-action resultado-item fw-bold text-dark d-flex align-items-center';
                    li.innerHTML = `<i class="bi bi-geo-alt-fill me-2 text-primary"></i> ${lugar.nombre}`;
                    li.style.cursor = 'pointer';
                    
                    li.addEventListener('click', () => {
                        const coordenadaLat = lugar.centro ? lugar.centro.lat : lugar.lat;
                        const coordenadaLng = lugar.centro ? lugar.centro.lng : lugar.lng;

                        seleccionarResultado({
                            nombre: lugar.nombre,
                            lat: coordenadaLat,
                            lng: coordenadaLng,
                            feature: lugar.feature || null
                        });
                    });
                    listaResultados.appendChild(li);
                });
            } else {
                listaResultados.classList.add('d-none');
            }
        });

        if (btnLimpiar) {
            btnLimpiar.addEventListener('click', () => {
                inputBuscador.value = '';
                btnLimpiar.classList.add('d-none');
                mostrarHistorial(); 
                inputBuscador.focus(); 
            });
        }
    }
});