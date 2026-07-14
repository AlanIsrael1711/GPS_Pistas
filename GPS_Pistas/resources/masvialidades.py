import json

def unificar_y_reemplazar(ruta_unificadas, ruta_corregidas, ruta_salida):
    # Cargar ambos archivos
    with open(ruta_unificadas, 'r', encoding='utf-8') as f:
        unificadas = json.load(f)
    
    with open(ruta_corregidas, 'r', encoding='utf-8') as f:
        corregidas = json.load(f)

    # Extraer los segmentos corregidos (los 5 fragmentos)
    segmentos_corregidos = corregidas.get("features", [])
    
    if not segmentos_corregidos:
        print("El archivo de líneas corregidas está vacío.")
        return

    # Obtener las coordenadas de los extremos (el inicio del segmento 1 y el final del segmento 5)
    primer_nodo = segmentos_corregidos[0]["geometry"]["coordinates"][0]
    ultimo_nodo = segmentos_corregidos[-1]["geometry"]["coordinates"][-1]

    features_finales = []
    linea_reemplazada = False

    # Recorrer el archivo unificado original
    for feat in unificadas.get("features", []):
        geom = feat.get("geometry", {})
        
        if geom and geom.get("type") == "LineString":
            coords = geom.get("coordinates", [])
            
            # Verificar si esta es la línea original que abarca desde el primer nodo hasta el último
            if len(coords) > 1 and (
                (coords[0] == primer_nodo and coords[-1] == ultimo_nodo) or 
                (coords[-1] == primer_nodo and coords[0] == ultimo_nodo)
            ):
                # Es la línea original completa: NO la agregamos a features_finales (la eliminamos)
                linea_reemplazada = True
                continue 

        # Si no es la línea original, la conservamos en el mapa
        features_finales.append(feat)

    # Inyectar los 5 segmentos nuevos y corregidos al mapa final
    features_finales.extend(segmentos_corregidos)

    # Construir el GeoJSON final
    geojson_final = {
        "type": "FeatureCollection",
        "features": features_finales
    }

    # Guardar el nuevo archivo unificado
    with open(ruta_salida, 'w', encoding='utf-8') as f:
        json.dump(geojson_final, f, ensure_ascii=False, indent=2)

    # Resumen de la operación
    if linea_reemplazada:
        print(f"¡Éxito! La vialidad original fue encontrada, eliminada y reemplazada por los {len(segmentos_corregidos)} nuevos segmentos.")
    else:
        print(f"Se añadieron {len(segmentos_corregidos)} segmentos, pero no se encontró la línea original para borrarla.")
    print(f"Archivo guardado en: {ruta_salida}")

# --- Ejecución del Script ---
unificar_y_reemplazar('vialidades_unificadas.geojson', 'mapa_corregido_final.geojson', 'vialidades_final_completo.geojson')