import json
from shapely.geometry import shape, mapping, LineString, Point

def conectar_lineas_por_id(input_file, output_file, ids_nuevas_lineas):
    # 1. Cargar el archivo GeoJSON
    with open(input_file, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)
    
    features = geojson_data.get('features', [])
    
    # 2. Separar las líneas usando tu lista de IDs
    lineas_existentes = []
    lineas_nuevas = []
    
    for feat in features:
        # Extraer el ID: Revisar primero la raíz del Feature, y si no, buscar en 'properties'
        feat_id = feat.get('id')
        if not feat_id and 'properties' in feat:
            feat_id = feat['properties'].get('id')
            
        # Si el ID está en nuestra lista de "nuevas líneas", lo separamos
        if feat_id in ids_nuevas_lineas:
            lineas_nuevas.append(feat)
        else:
            lineas_existentes.append(feat)
            
    if not lineas_nuevas:
        print("Error: No se encontró ninguna línea en el GeoJSON que coincida con los IDs proporcionados.")
        return

    # 3. Extraer todos los nodos de la red base (red existente)
    nodos_existentes = []
    for feat in lineas_existentes:
        geom = shape(feat['geometry'])
        if isinstance(geom, LineString):
            for coord in geom.coords:
                nodos_existentes.append(Point(coord))
                
    if not nodos_existentes:
        print("Error: No se encontraron nodos de referencia en la red existente.")
        return

    # 4. Modificar solo los extremos de tus líneas con ID específico
    lineas_nuevas_modificadas = []
    for feat in lineas_nuevas:
        geom = shape(feat['geometry'])
        
        if not isinstance(geom, LineString):
            lineas_nuevas_modificadas.append(feat)
            continue
            
        coords = list(geom.coords)
        puntos_extremos = [coords[0], coords[-1]] # Inicio y fin
        nuevas_coords = coords.copy()
        
        # Evaluar inicio (index 0) y fin (index -1)
        for idx, extremo_coord in zip([0, -1], puntos_extremos):
            punto_extremo = Point(extremo_coord)
            
            # Buscar el nodo de la red existente que esté a la distancia mínima
            distancia_minima = float('inf')
            nodo_mas_cercano = None
            
            for nodo in nodos_existentes:
                dist = punto_extremo.distance(nodo)
                if dist < distancia_minima:
                    distancia_minima = dist
                    nodo_mas_cercano = nodo
            
            # Reemplazar la coordenada con la del nodo más cercano para "imantarla"
            if nodo_mas_cercano:
                coord_cercana = list(nodo_mas_cercano.coords)[0]
                nuevas_coords[idx] = coord_cercana
        
        # Guardar la nueva geometría en el Feature
        linea_conectada = LineString(nuevas_coords)
        feat['geometry'] = mapping(linea_conectada)
        lineas_nuevas_modificadas.append(feat)
        
    # 5. Volver a unir todo y guardar el archivo
    geojson_data['features'] = lineas_existentes + lineas_nuevas_modificadas
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, indent=2, ensure_ascii=False)
    
    print(f"¡Éxito! Se han conectado {len(lineas_nuevas_modificadas)} línea(s) a la red. Archivo: '{output_file}'")


# --- EJECUCIÓN DEL SCRIPT ---
# Define aquí exactamente los IDs que asignaste en tu archivo.
# Si tus IDs son números, ponlos sin comillas (ej: [1, 2, 3]). 
# Si son texto, ponlos con comillas (ej: ["pista_nueva_1", "pista_nueva_2"]).
mis_ids = [2]

conectar_lineas_por_id(
    input_file='mapa_conectado.geojson', 
    output_file='mapa_conectado_completo.geojson', 
    ids_nuevas_lineas=mis_ids
)