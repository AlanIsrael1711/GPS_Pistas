import json
from shapely.geometry import shape, mapping, LineString, Point

def conectar_topologia_ramificada(input_file, output_file, id_central, ids_secundarios):
    # 1. Cargar el archivo GeoJSON
    with open(input_file, 'r', encoding='utf-8') as f:
        geojson_data = json.load(f)
    
    features = geojson_data.get('features', [])
    
    linea_central = None
    lineas_secundarias = []
    lineas_existentes = []
    
    # 2. Clasificar las líneas por ID
    for feat in features:
        feat_id = feat.get('id')
        if not feat_id and 'properties' in feat:
            feat_id = feat['properties'].get('id')
            
        # Convertir a string para evitar errores de tipo (por si en JSON es 1 y en script "1")
        feat_id_str = str(feat_id) if feat_id is not None else None
        
        if feat_id_str == str(id_central):
            linea_central = feat
        elif feat_id_str in [str(i) for i in ids_secundarios]:
            lineas_secundarias.append(feat)
        else:
            lineas_existentes.append(feat)
            
    if not linea_central:
        print(f"Error: No se encontró la línea central con ID '{id_central}'. Revisa tu GeoJSON.")
        return
    if not lineas_secundarias:
        print(f"Error: No se encontraron las líneas secundarias con IDs {ids_secundarios}.")
        return

    # 3. Extraer los nodos de la línea central (ID 1)
    geom_central = shape(linea_central['geometry'])
    nodos_centrales = [Point(c) for c in geom_central.coords]
    
    # 4. Extraer los nodos del RESTO de la red existente
    nodos_existentes = []
    for feat in lineas_existentes:
        geom = shape(feat['geometry'])
        if isinstance(geom, LineString):
            for coord in geom.coords:
                nodos_existentes.append(Point(coord))

    # 5. Procesar las líneas secundarias (IDs 2 y 3)
    lineas_modificadas = []
    
    for feat in lineas_secundarias:
        geom = shape(feat['geometry'])
        if not isinstance(geom, LineString):
            lineas_modificadas.append(feat)
            continue
            
        coords = list(geom.coords)
        punto_inicio = Point(coords[0])
        punto_fin = Point(coords[-1])
        
        # Calcular qué punta está más cerca de la línea central
        dist_inicio_a_central = min([punto_inicio.distance(n) for n in nodos_centrales])
        dist_fin_a_central = min([punto_fin.distance(n) for n in nodos_centrales])
        
        nuevas_coords = coords.copy()
        
        # Determinar el índice de la coordenada que va a la línea 1 y la que va a la red
        if dist_inicio_a_central < dist_fin_a_central:
            idx_a_central = 0
            idx_a_red = -1
            punto_hacia_central = punto_inicio
            punto_hacia_red = punto_fin
        else:
            idx_a_central = -1
            idx_a_red = 0
            punto_hacia_central = punto_fin
            punto_hacia_red = punto_inicio
            
        # A) Conectar a la Línea Central (ID 1)
        nodo_cercano_central = min(nodos_centrales, key=lambda n: punto_hacia_central.distance(n))
        nuevas_coords[idx_a_central] = list(nodo_cercano_central.coords)[0]
        
        # B) Conectar la punta restante a la red existente
        if nodos_existentes:
            nodo_cercano_red = min(nodos_existentes, key=lambda n: punto_hacia_red.distance(n))
            nuevas_coords[idx_a_red] = list(nodo_cercano_red.coords)[0]
            
        # Guardar la nueva geometría
        feat['geometry'] = mapping(LineString(nuevas_coords))
        lineas_modificadas.append(feat)
        
    # 6. Reconstruir y guardar el archivo
    geojson_data['features'] = lineas_existentes + [linea_central] + lineas_modificadas
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(geojson_data, f, indent=2, ensure_ascii=False)
        
    print(f"¡Éxito! Topología conectada y guardada en '{output_file}'.")

# --- EJECUCIÓN DEL SCRIPT ---
# Define la línea principal (ej: 1) y las líneas que se unirán a ella (ej: 2 y 3)
ID_PRINCIPAL = 1
IDS_RAMAS = [2, 3]

conectar_topologia_ramificada(
    input_file='red_vascular_unida_con_peso.geojson', 
    output_file='mapa_conectado.geojson', 
    id_central=ID_PRINCIPAL, 
    ids_secundarios=IDS_RAMAS
)